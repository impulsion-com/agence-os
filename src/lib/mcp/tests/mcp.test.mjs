// Test de bout en bout du serveur MCP (/api/mcp) contre le serveur de dev et la base de dev.
// Prérequis : `npm run dev` (http://localhost:3000), .env.local rempli, compte démo et espace studio-demo.
// Usage : node src/lib/mcp/tests/mcp.test.mjs            (MCP_URL=… pour viser une autre instance)
// Le script crée ses propres jetons et données de test, puis les supprime.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const MCP = process.env.MCP_URL || "http://localhost:3000/api/mcp";
const DEMO = { email: "demo@agence-os.dev", password: "Demo-agence-2026!" };
const SLUG = "studio-demo";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const check = (cond, label, extra) => {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  ÉCHEC ${label}${extra ? `\n       ${String(extra).slice(0, 400)}` : ""}`);
  }
};

let rid = 0;
async function rpc(token, method, params, { path = false } = {}) {
  const res = await fetch(path ? `${MCP}/${token}` : MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(path ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
async function tool(token, name, args = {}) {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  const result = r.body?.result;
  return { status: r.status, error: r.body?.error, isError: !!result?.isError, text: result?.content?.[0]?.text ?? "", data: result?.structuredContent };
}

const created = { companies: [], contacts: [], deals: [], tasks: [], projects: [], proposals: [], links: [], tokens: [], workspaces: [], users: [] };

async function main() {
  // ------------------------------------------------------------------
  console.log("Préparation");
  const demo = anon();
  const { data: auth, error: authErr } = await demo.auth.signInWithPassword(DEMO);
  if (authErr) throw new Error(`Connexion démo : ${authErr.message}`);
  const demoId = auth.user.id;
  const { data: ws } = await admin.from("workspaces").select("id, name").eq("slug", SLUG).single();
  const mk = async (sb, name, scope, expires = null) => {
    const { data, error } = await sb.rpc("create_api_token", { p_ws: ws.id, p_name: name, p_scope: scope, p_expires_at: expires });
    if (error) throw new Error(`create_api_token : ${error.message}`);
    created.tokens.push(data.id);
    return data;
  };
  const W = await mk(demo, "test-mcp écriture", "write");
  const R = await mk(demo, "test-mcp lecture", "read");
  check(/^aos_[A-Za-z0-9_-]{40}$/.test(W.token) && W.scope === "write", "création d'un jeton lecture+écriture (RPC, jeton complet renvoyé une fois)");
  const { data: stored } = await admin.from("api_tokens").select("token_hash, prefix").eq("id", W.id).single();
  check(stored.token_hash === createHash("sha256").update(W.token).digest("hex") && stored.prefix === W.token.slice(0, 12), "seul le hash SHA-256 est stocké, avec le préfixe visible");
  const { data: leak, error: leakErr } = await demo.from("api_tokens").select("token_hash").limit(1);
  check(!!leakErr || !leak?.length, "le hash n'est pas lisible depuis le navigateur (privilège par colonne)", leakErr?.message);

  // ------------------------------------------------------------------
  console.log("Protocole");
  const init = await rpc(W.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  check(init.status === 200 && init.body.result?.protocolVersion === "2025-06-18" && init.body.result?.serverInfo?.name === "agence-os", "initialize", JSON.stringify(init.body).slice(0, 300));
  check(/Studio/.test(init.body.result?.instructions ?? ""), "initialize : instructions en français avec le nom de l'espace");
  const notif = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${W.token}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  check(notif.status === 202, "notification : 202 sans corps");
  const get = await fetch(MCP, { headers: { Authorization: `Bearer ${W.token}` } });
  check(get.status === 405, "GET : 405 (serveur sans état, pas de flux SSE)");
  const ping = await rpc(W.token, "ping");
  check(ping.body.result && !ping.body.error, "ping");
  const unknown = await rpc(W.token, "foo/bar");
  check(unknown.body.error?.code === -32601, "méthode inconnue : -32601");
  const listW = await rpc(W.token, "tools/list");
  const namesW = listW.body.result.tools.map((t) => t.name);
  check(namesW.length >= 25 && namesW.includes("create_task") && namesW.includes("get_attribution"), `tools/list (lecture+écriture) : ${namesW.length} outils`);
  check(listW.body.result.tools.every((t) => t.inputSchema?.type === "object" && t.description), "chaque outil a un schéma d'entrée objet et une description");
  const listR = await rpc(R.token, "tools/list");
  const namesR = listR.body.result.tools.map((t) => t.name);
  check(!namesR.some((n) => /^(create|update|add)_/.test(n)) && namesR.includes("list_tasks"), `tools/list (lecture seule) : ${namesR.length} outils, aucun d'écriture`);
  const viaPath = await rpc(R.token, "tools/list", null, { path: true });
  check(viaPath.status === 200 && viaPath.body.result?.tools?.length === namesR.length, "URL secrète /api/mcp/<jeton> (connecteurs sans en-tête)");
  const noAuth = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  check(noAuth.status === 401 && noAuth.headers.get("www-authenticate")?.startsWith("Bearer"), "sans jeton : 401 JSON (pas de redirection vers /login)");
  const unknownTool = await rpc(W.token, "tools/call", { name: "nope", arguments: {} });
  check(unknownTool.body.error?.code === -32602, "outil inconnu : -32602");
  const badArgs = await tool(W.token, "list_tasks", { limit: 9999 });
  check(badArgs.isError && /Arguments invalides/.test(badArgs.text), "arguments invalides : erreur lisible (isError)");

  // ------------------------------------------------------------------
  console.log("Lecture");
  const who = await tool(R.token, "whoami");
  check(!who.isError && who.data?.workspace?.id === ws.id && who.data?.can_write === false, "whoami (lecture seule)", who.text);
  const projects = await tool(R.token, "list_projects");
  const pkey = projects.data?.projects?.[0]?.key;
  check(!projects.isError && !!pkey, `list_projects (${projects.data?.projects?.length} projets)`, projects.text);
  const proj = await tool(R.token, "get_project", { project: pkey });
  check(!proj.isError && proj.data?.project?.key === pkey, `get_project ${pkey}`, proj.text);
  const late = await tool(R.token, "list_tasks", { due: "overdue" });
  check(!late.isError && Array.isArray(late.data?.tasks) && late.data.tasks.every((t) => t.overdue), `list_tasks en retard (${late.data?.tasks?.length})`, late.text);
  const mine = await tool(R.token, "list_tasks", { assignee: "me", sort: "priority", limit: 5 });
  check(!mine.isError, "list_tasks responsable = me, tri par priorité", mine.text);
  const anyTask = (await tool(R.token, "list_tasks", { limit: 1, include_done: true })).data?.tasks?.[0];
  const task = await tool(R.token, "get_task", { task: anyTask.key });
  check(!task.isError && task.data?.key === anyTask.key, `get_task ${anyTask.key}`, task.text);
  const search = await tool(R.token, "search", { query: "Lumen" });
  check(!search.isError && /Lumen/.test(search.text), "search « Lumen »", search.text);
  const deals = await tool(R.token, "list_deals", { status: "all" });
  check(!deals.isError && deals.data?.deals?.length > 0, `list_deals (${deals.data?.deals?.length})`, deals.text);
  const deal = await tool(R.token, "get_deal", { deal: deals.data.deals[0].id });
  check(!deal.isError, "get_deal", deal.text);
  const companies = await tool(R.token, "list_companies");
  check(!companies.isError && companies.data?.companies?.length > 0, `list_companies (${companies.data?.companies?.length})`, companies.text);
  const company = await tool(R.token, "get_company", { company: "Maison Lumen" });
  check(!company.isError && /Maison Lumen/.test(company.text), "get_company « Maison Lumen » (par nom)", company.text);
  const contacts = await tool(R.token, "list_contacts", { limit: 5 });
  check(!contacts.isError, "list_contacts", contacts.text);
  const props = await tool(R.token, "list_proposals");
  check(!props.isError, `list_proposals (${props.data?.proposals?.length ?? 0})`, props.text);
  if (props.data?.proposals?.length) {
    const p = await tool(R.token, "get_proposal", { proposal: String(props.data.proposals[0].number) });
    check(!p.isError && p.data?.totals, `get_proposal #${props.data.proposals[0].number}`, p.text);
  }
  const perf = await tool(R.token, "get_performance", { period: "30d" });
  check(!perf.isError && perf.data?.current, "get_performance tous clients (30 jours)", perf.text);
  const perfC = await tool(R.token, "get_performance", { company: "Maison Lumen", period: "lastmonth" });
  check(!perfC.isError, "get_performance d'un client (mois dernier)", perfC.text);
  const camps = await tool(R.token, "get_campaigns", { sort_by: "roas", limit: 5 });
  check(!camps.isError, "get_campaigns triées par ROAS", camps.text);
  const attr = await tool(R.token, "get_attribution", { company: "Maison Lumen", goal: "sales", model: "linear" });
  check(!attr.isError && attr.data?.channels, `get_attribution (${attr.data?.totals?.conversions ?? 0} ventes)`, attr.text);
  const links = await tool(R.token, "list_links", { limit: 5 });
  check(!links.isError, "list_links", links.text);

  // ------------------------------------------------------------------
  console.log("Écriture");
  const denied = await tool(R.token, "create_task", { project: pkey, title: "Ne doit pas exister" });
  check(denied.isError && /lecture seule/.test(denied.text), "jeton lecture seule : écriture refusée");
  const co = await tool(W.token, "create_company", { name: "Test MCP SAS", industry: "SaaS" });
  check(!co.isError && co.data?.id, "create_company", co.text);
  if (co.data?.id) created.companies.push(co.data.id);
  const dup = await tool(W.token, "create_company", { name: "test mcp sas" });
  check(dup.isError && /existe déjà/.test(dup.text), "create_company refuse un doublon");
  const ct = await tool(W.token, "create_contact", { first_name: "Camille", last_name: "Testeur", email: "camille.mcp-test@exemple.fr", company: "Test MCP SAS" });
  check(!ct.isError, "create_contact", ct.text);
  if (ct.data?.id) created.contacts.push(ct.data.id);
  const dl = await tool(W.token, "create_deal", { title: "Deal test MCP", company: "Test MCP SAS", contact: "camille.mcp-test@exemple.fr", value: 1500, expected_close: "+14" });
  check(!dl.isError, "create_deal", dl.text);
  if (dl.data?.id) created.deals.push(dl.data.id);
  const noReason = await tool(W.token, "update_deal", { deal: "Deal test MCP", stage: "lost" });
  check(noReason.isError && /raison/.test(noReason.text), "update_deal perdu sans raison : refusé");
  const moved = await tool(W.token, "update_deal", { deal: "Deal test MCP", stage: "won", value: 1800 });
  check(!moved.isError && /Gagné|gagn/i.test(moved.text), "update_deal → gagné", moved.text);
  const { data: coAfter } = await admin.from("companies").select("status").eq("id", co.data.id).single();
  check(coAfter.status === "client", "deal gagné : le client passe au statut Client");
  const act = await tool(W.token, "add_crm_activity", { kind: "task", body: "Relancer Camille", deal: "Deal test MCP", due_date: "demain" });
  check(!act.isError, "add_crm_activity (relance)", act.text);
  const nt = await tool(W.token, "create_task", { project: pkey, title: "Tâche test MCP", description: "Créée par le test", priority: "high", assignee: "me", due_date: "+3", labels: ["Média"], subtasks: ["Étape 1", "Étape 2"] });
  check(!nt.isError && nt.data?.key, `create_task ${nt.data?.key}`, nt.text);
  if (nt.data?.id) created.tasks.push(nt.data.id);
  const ut = await tool(W.token, "update_task", { task: nt.data.key, status: "progress", add_labels: ["Tracking"], due_date: null });
  check(!ut.isError && /En cours/.test(ut.text), "update_task (statut, étiquettes, échéance effacée)", ut.text);
  const cm = await tool(W.token, "add_comment", { task: nt.data.key, body: "Commentaire du test MCP" });
  check(!cm.isError, "add_comment", cm.text);
  const np = await tool(W.token, "create_project", { name: "Projet test MCP", key: "TMCP", template: "google-audit", company: "Test MCP SAS", lead: "me" });
  check(!np.isError && np.data?.tasks_created === 6, "create_project avec le modèle « Audit Google Ads » (6 tâches)", np.text);
  if (np.data?.id) created.projects.push(np.data.id);
  const pr = await tool(W.token, "create_proposal", { template: "meta", deal: "Deal test MCP", items: [{ service: "Gestion Meta Ads" }, { service: "Setup tracking" }, { service: "Production de créas", optional: true }], discount_pct: 10 });
  check(!pr.isError && pr.data?.totals, "create_proposal (catalogue + modèle, remise)", pr.text);
  if (pr.data?.id) created.proposals.push(pr.data.id);
  const lk = await tool(W.token, "create_tracked_link", { destination: "https://maison-lumen.fr/collection?ref=x&utm_source=old", utm_source: "Facebook", utm_medium: "paid social", utm_campaign: "Soldes Été", company: "Maison Lumen" });
  check(!lk.isError && lk.data?.short_url && /utm_source=facebook/.test(lk.data.final_url) && /utm_campaign=soldes_ete/.test(lk.data.final_url), "create_tracked_link (UTM normalisées, lien court)", lk.text);
  if (lk.data?.id) created.links.push(lk.data.id);
  const { data: acts } = await admin.from("activity").select("verb, actor_id, meta").eq("workspace_id", ws.id).contains("meta", { via: "mcp" }).gte("created_at", new Date(Date.now() - 10 * 60e3).toISOString());
  check(acts?.length >= 5 && acts.every((a) => a.actor_id === demoId), `écritures journalisées dans activity avec l'utilisateur du jeton (${acts?.length} lignes : ${[...new Set(acts?.map((a) => a.verb))].join(", ")})`);

  // ------------------------------------------------------------------
  console.log("Cloisonnement");
  const { data: collegue } = await admin.from("profiles").select("id").eq("email", "collegue@agence-os.dev").single();
  const { data: other } = await admin.from("workspaces").insert({ name: "Espace test MCP", slug: "mcp-test-autre", created_by: collegue.id }).select("id").single();
  created.workspaces.push(other.id);
  await admin.from("workspace_members").insert({ workspace_id: other.id, user_id: collegue.id, role: "owner" });
  const { data: secretCo } = await admin.from("companies").insert({ workspace_id: other.id, name: "Société Secrète Zeta" }).select("id").single();
  const { data: secretPj } = await admin.from("projects").insert({ workspace_id: other.id, key: "SECR", name: "Projet Secret Zeta" }).select("id").single();
  const { data: secretTask } = await admin.from("tasks").insert({ workspace_id: other.id, project_id: secretPj.id, title: "Tâche secrète Zeta" }).select("id").single();
  const s1 = await tool(W.token, "search", { query: "Zeta" });
  check(!s1.isError && /Aucun résultat/.test(s1.text), "search ne voit pas un autre espace");
  const s2 = await tool(W.token, "get_task", { task: secretTask.id });
  check(s2.isError, "get_task d'un autre espace (par identifiant) : introuvable");
  const s3 = await tool(W.token, "get_company", { company: secretCo.id });
  check(s3.isError, "get_company d'un autre espace : introuvable");
  const s4 = await tool(W.token, "get_task", { task: "SECR-1" });
  check(s4.isError, "clé de tâche d'un autre espace : introuvable");
  const s5 = await tool(W.token, "create_task", { project: secretPj.id, title: "Intrusion" });
  check(s5.isError, "create_task dans un projet d'un autre espace : refusé");
  // Même si l'utilisateur est aussi membre de l'autre espace, le jeton reste borné au sien
  await admin.from("workspace_members").insert({ workspace_id: other.id, user_id: demoId, role: "member" });
  const s6 = await tool(W.token, "list_tasks", { query: "Zeta", include_done: true });
  check(!s6.isError && s6.data?.tasks?.length === 0, "membre des deux espaces : le jeton ne voit que son espace");

  // ------------------------------------------------------------------
  console.log("Révocation, expiration, rôle");
  await demo.rpc("revoke_api_token", { p_id: R.id });
  const revoked = await rpc(R.token, "tools/list");
  check(revoked.status === 401 && /révoqué/.test(revoked.body.error?.message ?? ""), "jeton révoqué : 401");
  const expiredToken = "aos_" + "e".repeat(40);
  const { data: exp } = await admin
    .from("api_tokens")
    .insert({ workspace_id: ws.id, user_id: demoId, name: "test-mcp expiré", prefix: expiredToken.slice(0, 12), token_hash: createHash("sha256").update(expiredToken).digest("hex"), scope: "read", expires_at: new Date(Date.now() - 60e3).toISOString() })
    .select("id")
    .single();
  created.tokens.push(exp.id);
  const expired = await rpc(expiredToken, "ping");
  check(expired.status === 401 && /expiré/.test(expired.body.error?.message ?? ""), "jeton expiré : 401");

  const guestEmail = `mcp-test-invite-${Date.now()}@agence-os.dev`;
  const { data: gu, error: guErr } = await admin.auth.admin.createUser({ email: guestEmail, password: "Invite-test-2026!", email_confirm: true });
  if (guErr) throw new Error(guErr.message);
  created.users.push(gu.user.id);
  await admin.from("workspace_members").insert({ workspace_id: ws.id, user_id: gu.user.id, role: "guest" });
  const guest = anon();
  await guest.auth.signInWithPassword({ email: guestEmail, password: "Invite-test-2026!" });
  const G = await mk(guest, "test-mcp invité", "write");
  check(G.scope === "read", "invité : un jeton demandé en écriture est créé en lecture seule");
  const gList = await rpc(G.token, "tools/list");
  check(!gList.body.result.tools.some((t) => /^(create|update|add)_/.test(t.name)), "invité : aucun outil d'écriture listé");
  // Jeton en écriture d'un membre ensuite passé invité : l'écriture est refusée au prochain appel
  await admin.from("api_tokens").update({ scope: "write" }).eq("id", G.id);
  const gWrite = await tool(G.token, "create_company", { name: "Invité intrus" });
  check(gWrite.isError && /Invité/.test(gWrite.text), "rôle invité revérifié à chaque appel : écriture refusée même avec un jeton en écriture");
  await admin.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", gu.user.id);
  const removed = await rpc(G.token, "tools/list");
  check(removed.status === 403, "membre retiré de l'espace : 403");
}

async function cleanup() {
  const del = (t, ids) => (ids.length ? admin.from(t).delete().in("id", ids) : null);
  await del("proposals", created.proposals);
  await del("links", created.links);
  await del("projects", created.projects);
  await del("tasks", created.tasks);
  await del("deals", created.deals);
  await del("contacts", created.contacts);
  await del("companies", created.companies);
  await del("api_tokens", created.tokens);
  await del("workspaces", created.workspaces);
  for (const u of created.users) await admin.auth.admin.deleteUser(u);
  // Activités de test orphelines (entreprise, relance) et journal
  await admin.from("crm_activities").delete().eq("body", "Relancer Camille");
}

try {
  await main();
} catch (e) {
  failed++;
  console.error("Erreur :", e);
} finally {
  await cleanup();
  console.log(`\n${passed} vérifications réussies, ${failed} en échec.`);
  process.exit(failed ? 1 : 0);
}
