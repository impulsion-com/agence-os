// Test de sécurité des fonctions portal_* et des routes /api/portal/* (portail client).
//
// Pour chaque fonction : le compte client (rattaché à Maison Lumen) doit être refusé sur une autre
// entreprise (Kalia), sur une fonctionnalité non ouverte, sur un objet d'une autre entreprise passé
// avec p_company = Maison Lumen, sur une tâche non visible ; un commentaire interne ne doit jamais
// sortir ; un compte inconnu n'obtient rien ; un membre en aperçu ne peut rien écrire.
// Puis : audit des fonctions security definer existantes avec un compte client (non membre).
//
// Usage : node --env-file=.env.local scripts/test-portal-rpc.mjs      (espace de démo studio-demo requis)
//   PORTAL_TEST_URL=http://localhost:3000  application à tester pour les routes (ignorées si injoignable)
//   SUPABASE_ACCESS_TOKEN=…                facultatif : vérifie qu'aucune fonction security definer n'a échappé à l'audit
// Le script crée ses propres données ([test-portail] …) et les supprime en fin de course.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = (process.env.PORTAL_TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mk = () => createClient(url, anon, { auth: { persistSession: false } });

const CLIENT = { email: "client@agence-os.dev", password: "Client-agence-2026!", name: "Claire Dubois" };
const INTRUS = { email: "intrus@agence-os.dev", password: "Demo-agence-2026!", name: "Intrus" };
const AGENCE = { email: "demo@agence-os.dev", password: "Demo-agence-2026!", name: "Agence" };
const TAG = "[test-portail]";
const SECRET = "SECRET-INTERNE-7f3a";
const ALL = ["reporting", "tasks", "creatives", "files", "documents", "onboarding", "booking"];
const NIL = "00000000-0000-4000-8000-000000000000";

let failed = 0;
let count = 0;
const check = (name, ok, detail = "") => {
  count++;
  if (!ok) failed++;
  console.log(`${ok ? "  ok " : "ECHEC"}  ${name}${detail ? "  " + String(detail).slice(0, 160) : ""}`);
};
const section = (t) => console.log(`\n${t}`);
const must = (r, what) => {
  if (r.error) throw new Error(`${what} : ${r.error.message}`);
  return r.data;
};
/** Refus attendu : une erreur (accès refusé 42501 ou introuvable P0002), jamais de donnée. */
const denied = (r) => !!r.error && r.data == null;
const why = (r) => (r.error ? `${r.error.code} ${r.error.message}` : `DONNÉE : ${JSON.stringify(r.data)}`);

async function signIn(acc) {
  const sb = mk();
  let r = await sb.auth.signInWithPassword({ email: acc.email, password: acc.password });
  if (r.error) r = await sb.auth.signUp({ email: acc.email, password: acc.password, options: { data: { full_name: acc.name } } });
  if (r.error) throw r.error;
  return sb;
}

/** En-tête Cookie d'une session, au format de @supabase/ssr (celui que lit l'application). */
async function cookieFor(acc) {
  const jar = new Map();
  const sb = createServerClient(url, anon, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
  });
  const r = await sb.auth.signInWithPassword({ email: acc.email, password: acc.password });
  if (r.error) throw r.error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ---------------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------------
const ws = must(await admin.from("workspaces").select("id, slug").eq("slug", "studio-demo").single(), "espace studio-demo");
const cos = must(await admin.from("companies").select("id, name").eq("workspace_id", ws.id), "entreprises");
const lumen = cos.find((c) => c.name === "Maison Lumen");
const kalia = cos.find((c) => c.name === "Kalia Cosmetics");
if (!lumen || !kalia) throw new Error("Données de démo absentes : charge-les depuis l'espace studio-demo (Réglages > Espace).");
const projects = must(await admin.from("projects").select("id, key").eq("workspace_id", ws.id).in("key", ["LUM", "KAL"]), "projets");
const LUM = projects.find((p) => p.key === "LUM");
const KAL = projects.find((p) => p.key === "KAL");

const client = await signIn(CLIENT);
const intrus = await signIn(INTRUS);
const agence = await signIn(AGENCE);
const anonyme = mk();
const me = (await client.auth.getUser()).data.user;
const agenceId = (await agence.auth.getUser()).data.user.id;

const before = {
  portal: (await admin.from("client_portals").select("*").eq("company_id", lumen.id).maybeSingle()).data,
  kalia: (await admin.from("client_portals").select("*").eq("company_id", kalia.id).maybeSingle()).data,
  projects: must(await admin.from("projects").select("id, portal_mode").in("id", [LUM.id, KAL.id]), "projets"),
};
const tempSlug = `test-portail-${randomUUID().slice(0, 8)}`;
const objects = [];

async function cleanup() {
  const tasks = (await admin.from("tasks").select("id").eq("workspace_id", ws.id).like("title", `${TAG}%`)).data ?? [];
  if (tasks.length) await admin.from("tasks").delete().in("id", tasks.map((t) => t.id));
  await admin.from("attachments").delete().eq("workspace_id", ws.id).like("name", "test-portail-%");
  await admin.from("creative_concepts").delete().eq("workspace_id", ws.id).like("title", `${TAG}%`);
  await admin.from("reports").delete().eq("workspace_id", ws.id).like("title", `${TAG}%`);
  await admin.from("activity").delete().eq("workspace_id", ws.id).like("meta->>title", `${TAG}%`);
  await admin.from("activity").delete().eq("workspace_id", ws.id).eq("verb", "file.uploaded").like("meta->>name", "test-portail-%");
  await admin.from("notifications").delete().eq("workspace_id", ws.id).like("body", `%${TAG}%`);
  await admin.from("notifications").delete().eq("workspace_id", ws.id).like("body", "%test-portail-%");
  const old = (await admin.from("workspaces").select("id").like("slug", "test-portail-%")).data ?? [];
  if (old.length) await admin.from("workspaces").delete().in("id", old.map((w) => w.id));
  const { data: left } = await admin.storage.from("attachments").list(`${ws.id}/${LUM.id}/portal`, { limit: 200 });
  const stray = (left ?? []).filter((o) => o.name.includes("test-portail-")).map((o) => `${ws.id}/${LUM.id}/portal/${o.name}`);
  if (objects.length || stray.length) await admin.storage.from("attachments").remove([...objects, ...stray]);
}

async function restore() {
  if (before.portal) await admin.from("client_portals").update({ enabled: before.portal.enabled, features: before.portal.features }).eq("company_id", lumen.id);
  if (before.kalia) await admin.from("client_portals").update({ enabled: before.kalia.enabled, features: before.kalia.features }).eq("company_id", kalia.id);
  for (const p of before.projects) await admin.from("projects").update({ portal_mode: p.portal_mode }).eq("id", p.id);
  await admin.from("client_users").update({ features: null }).eq("company_id", lumen.id).eq("user_id", me.id);
}

const put = async (path, text) => {
  must(await admin.storage.from("attachments").upload(path, Buffer.from(text), { contentType: "text/plain", upsert: true }), `envoi ${path}`);
  objects.push(path);
  return path;
};
const insert = async (table, row) => must(await admin.from(table).insert(row).select("*").single(), `création ${table}`);
const setFeatures = (features) => admin.from("client_portals").update({ enabled: true, features }).eq("company_id", lumen.id);

let exitCode = 1;
try {
  await cleanup();
  // Portails ouverts des deux côtés, le client rattaché à Maison Lumen seulement
  must(await admin.from("client_portals").upsert({ company_id: lumen.id, workspace_id: ws.id, enabled: true, features: ALL }), "portail Lumen");
  must(await admin.from("client_portals").upsert({ company_id: kalia.id, workspace_id: ws.id, enabled: true, features: ALL }), "portail Kalia");
  await admin.from("projects").update({ portal_mode: "selected" }).in("id", [LUM.id, KAL.id]);
  await admin.from("client_users").delete().eq("user_id", me.id).neq("company_id", lumen.id);
  must(await admin.from("client_users").upsert({ workspace_id: ws.id, company_id: lumen.id, user_id: me.id, features: null }, { onConflict: "company_id,user_id" }), "rattachement du client");

  // Maison Lumen : une tâche visible à valider, une tâche interne, commentaires, fichiers, créas, rapports
  const tVis = await insert("tasks", { workspace_id: ws.id, project_id: LUM.id, title: `${TAG} tâche visible`, status: "review", client_visible: true, assignee_id: agenceId, description: "Description partagée" });
  const tHid = await insert("tasks", { workspace_id: ws.id, project_id: LUM.id, title: `${TAG} tâche interne ${SECRET}`, status: "review", client_visible: false });
  await insert("comments", { workspace_id: ws.id, task_id: tVis.id, author_id: agenceId, body: `${TAG} note interne ${SECRET}`, visibility: "internal" });
  await insert("comments", { workspace_id: ws.id, task_id: tVis.id, author_id: agenceId, body: `${TAG} message partagé`, visibility: "client" });
  const aVis = await insert("attachments", { workspace_id: ws.id, project_id: LUM.id, task_id: tVis.id, name: "test-portail-visible.txt", path: await put(`${ws.id}/${LUM.id}/test-portail-visible.txt`, "visible"), size: 7, mime: "text/plain", client_visible: true, uploaded_by: agenceId });
  const aInt = await insert("attachments", { workspace_id: ws.id, project_id: LUM.id, name: "test-portail-interne.txt", path: await put(`${ws.id}/${LUM.id}/test-portail-interne.txt`, SECRET), size: 19, mime: "text/plain", client_visible: false, uploaded_by: agenceId });
  const aHid = await insert("attachments", { workspace_id: ws.id, project_id: LUM.id, task_id: tHid.id, name: "test-portail-tache-interne.txt", path: await put(`${ws.id}/${LUM.id}/test-portail-tache-interne.txt`, SECRET), size: 19, mime: "text/plain", client_visible: false, uploaded_by: agenceId });
  const concept = { workspace_id: ws.id, format: "static", verdict: `verdict ${SECRET}`, persona: `persona ${SECRET}`, tags: [SECRET], brief: { script: "Script partagé", context: `contexte ${SECRET}`, instructions: `consignes ${SECRET}` } };
  const cVis = await insert("creative_concepts", { ...concept, company_id: lumen.id, project_id: LUM.id, title: `${TAG} créa soumise`, hook: "Accroche", angle: "Angle", client_review: "pending" });
  const cInt = await insert("creative_concepts", { ...concept, company_id: lumen.id, project_id: LUM.id, title: `${TAG} créa interne ${SECRET}`, client_review: null });
  await insert("creative_variants", { workspace_id: ws.id, concept_id: cVis.id, name: "Variante", hook: "Autre accroche", notes: `notes ${SECRET}` });
  const sVis = await insert("creative_assets", { workspace_id: ws.id, concept_id: cVis.id, name: "test-portail-crea.txt", path: await put(`${ws.id}/creatives/${cVis.id}/test-portail-crea.txt`, "crea"), size: 4, mime: "text/plain" });
  const sInt = await insert("creative_assets", { workspace_id: ws.id, concept_id: cInt.id, name: "test-portail-crea-interne.txt", path: await put(`${ws.id}/creatives/${cInt.id}/test-portail-crea-interne.txt`, SECRET), size: 19, mime: "text/plain" });
  const rep = { workspace_id: ws.id, period_start: "2026-08-01", period_end: "2026-08-31" };
  const rVis = await insert("reports", { ...rep, company_id: lumen.id, title: `${TAG} rapport publié`, commentary: "Commentaire publié", shared: true, sections: ["site"] });
  const rInt = await insert("reports", { ...rep, company_id: lumen.id, title: `${TAG} brouillon ${SECRET}`, commentary: SECRET, shared: false });
  // Kalia : mêmes objets, tous partagés avec SON client (pas le nôtre)
  const kTask = await insert("tasks", { workspace_id: ws.id, project_id: KAL.id, title: `${TAG} tâche Kalia ${SECRET}`, status: "review", client_visible: true });
  const kAtt = await insert("attachments", { workspace_id: ws.id, project_id: KAL.id, task_id: kTask.id, name: "test-portail-kalia.txt", path: await put(`${ws.id}/${KAL.id}/test-portail-kalia.txt`, SECRET), size: 19, mime: "text/plain", client_visible: true, uploaded_by: agenceId });
  const kConcept = await insert("creative_concepts", { ...concept, company_id: kalia.id, project_id: KAL.id, title: `${TAG} créa Kalia ${SECRET}`, client_review: "pending" });
  const kAsset = await insert("creative_assets", { workspace_id: ws.id, concept_id: kConcept.id, name: "test-portail-crea-kalia.txt", path: await put(`${ws.id}/creatives/${kConcept.id}/test-portail-crea-kalia.txt`, SECRET), size: 19, mime: "text/plain" });
  const kReport = await insert("reports", { ...rep, company_id: kalia.id, title: `${TAG} rapport Kalia ${SECRET}`, shared: true });

  const L = lumen.id;
  const K = kalia.id;
  const portalPath = `${ws.id}/${LUM.id}/portal/${randomUUID()}-test-portail-depot.txt`;

  // Tous les appels possibles, par fonctionnalité : (session, entreprise, objets) => requête
  const CALLS = {
    reporting: {
      portal_reporting: (sb, c) => sb.rpc("portal_reporting", { p_company: c, p_start: "2026-09-01", p_end: "2026-09-30" }),
      portal_report: (sb, c, o) => sb.rpc("portal_report", { p_company: c, p_report: o.report }),
      portal_site_analytics: (sb, c) => sb.rpc("portal_site_analytics", { p_company: c, p_start: "2026-09-01", p_end: "2026-09-30" }),
    },
    tasks: {
      portal_tasks: (sb, c) => sb.rpc("portal_tasks", { p_company: c }),
      portal_task: (sb, c, o) => sb.rpc("portal_task", { p_company: c, p_task: o.task }),
      portal_task_comment: (sb, c, o) => sb.rpc("portal_task_comment", { p_company: c, p_task: o.task, p_body: `${TAG} tentative` }),
      portal_task_review: (sb, c, o) => sb.rpc("portal_task_review", { p_company: c, p_task: o.task, p_approve: true, p_comment: "" }),
      portal_task_file_path: (sb, c, o) => sb.rpc("portal_task_file_path", { p_company: c, p_task: o.task, p_file: o.file }),
    },
    creatives: {
      portal_creatives: (sb, c) => sb.rpc("portal_creatives", { p_company: c }),
      portal_creative: (sb, c, o) => sb.rpc("portal_creative", { p_company: c, p_concept: o.concept }),
      portal_creative_review: (sb, c, o) => sb.rpc("portal_creative_review", { p_company: c, p_concept: o.concept, p_approve: true, p_feedback: "" }),
      portal_asset_path: (sb, c, o) => sb.rpc("portal_asset_path", { p_company: c, p_asset: o.asset }),
    },
    files: {
      portal_files: (sb, c) => sb.rpc("portal_files", { p_company: c }),
      portal_file_path: (sb, c, o) => sb.rpc("portal_file_path", { p_company: c, p_file: o.file }),
      portal_upload_target: (sb, c, o) => sb.rpc("portal_upload_target", { p_company: c, p_project: o.project }),
      portal_file_add: (sb, c, o) => sb.rpc("portal_file_add", { p_company: c, p_project: o.project, p_path: o.path, p_name: "test-portail-depot.txt", p_mime: "text/plain" }),
      portal_file_remove: (sb, c, o) => sb.rpc("portal_file_remove", { p_company: c, p_file: o.file }),
    },
    documents: { portal_documents: (sb, c) => sb.rpc("portal_documents", { p_company: c }) },
    onboarding: { portal_onboarding: (sb, c) => sb.rpc("portal_onboarding", { p_company: c }) },
    booking: { portal_booking: (sb, c) => sb.rpc("portal_booking", { p_company: c }) },
  };
  const OWN = { task: tVis.id, file: aVis.id, concept: cVis.id, asset: sVis.id, report: rVis.id, project: LUM.id, path: portalPath };
  const KAL_OBJ = { task: kTask.id, file: kAtt.id, concept: kConcept.id, asset: kAsset.id, report: kReport.id, project: KAL.id, path: `${ws.id}/${KAL.id}/portal/${randomUUID()}-test-portail-depot.txt` };
  const everyCall = Object.values(CALLS).flatMap((g) => Object.entries(g));
  // portal_report renvoie null (et non une erreur) quand le rapport n'est pas lisible : les deux sont un refus
  const refused = (r) => denied(r) || (r.data === null && !r.error);

  // -------------------------------------------------------------------
  section("1. Une autre entreprise (Kalia) est refusée, pour chaque fonction");
  for (const [name, call] of [["portal_home", (sb, c) => sb.rpc("portal_home", { p_company: c })], ...everyCall]) {
    const r = await call(client, K, KAL_OBJ);
    check(`${name}(Kalia)`, denied(r) && r.error.code === "42501", why(r));
  }
  check("portal_effective_features(Kalia) vide", ((await client.rpc("portal_effective_features", { p_company: K })).data ?? []).length === 0);

  // -------------------------------------------------------------------
  section("2. Objet d'une autre entreprise passé avec p_company = Maison Lumen");
  const x = { ...OWN };
  const cross = [
    ["portal_task(tâche Kalia)", CALLS.tasks.portal_task(client, L, { ...x, task: kTask.id })],
    ["portal_task_comment(tâche Kalia)", CALLS.tasks.portal_task_comment(client, L, { ...x, task: kTask.id })],
    ["portal_task_review(tâche Kalia)", CALLS.tasks.portal_task_review(client, L, { ...x, task: kTask.id })],
    ["portal_task_file_path(tâche Kalia, fichier Kalia)", CALLS.tasks.portal_task_file_path(client, L, { task: kTask.id, file: kAtt.id })],
    ["portal_task_file_path(tâche Lumen, fichier Kalia)", CALLS.tasks.portal_task_file_path(client, L, { task: tVis.id, file: kAtt.id })],
    ["portal_creative(créa Kalia)", CALLS.creatives.portal_creative(client, L, { concept: kConcept.id })],
    ["portal_creative_review(créa Kalia)", CALLS.creatives.portal_creative_review(client, L, { concept: kConcept.id })],
    ["portal_asset_path(fichier de créa Kalia)", CALLS.creatives.portal_asset_path(client, L, { asset: kAsset.id })],
    ["portal_file_path(fichier Kalia)", CALLS.files.portal_file_path(client, L, { file: kAtt.id })],
    ["portal_file_remove(fichier Kalia)", CALLS.files.portal_file_remove(client, L, { file: kAtt.id })],
    ["portal_upload_target(projet Kalia)", CALLS.files.portal_upload_target(client, L, { project: KAL.id })],
    ["portal_file_add(projet Kalia)", CALLS.files.portal_file_add(client, L, KAL_OBJ)],
    ["portal_report(rapport Kalia)", CALLS.reporting.portal_report(client, L, { report: kReport.id })],
  ];
  for (const [name, p] of cross) {
    const r = await p;
    check(name, refused(r), why(r));
  }
  const kAfter = must(await admin.from("tasks").select("status, comments(count)").eq("id", kTask.id).single(), "tâche Kalia");
  check("la tâche Kalia n'a pas bougé (statut, commentaires)", kAfter.status === "review" && kAfter.comments[0].count === 0);
  const kcAfter = must(await admin.from("creative_concepts").select("client_review").eq("id", kConcept.id).single(), "créa Kalia");
  check("la créa Kalia est toujours en attente", kcAfter.client_review === "pending");

  // -------------------------------------------------------------------
  section("3. Ce qui n'est pas partagé reste invisible, même dans sa propre entreprise");
  const hidden = [
    ["portal_task(tâche non visible)", CALLS.tasks.portal_task(client, L, { task: tHid.id })],
    ["portal_task_comment(tâche non visible)", CALLS.tasks.portal_task_comment(client, L, { task: tHid.id })],
    ["portal_task_review(tâche non visible)", CALLS.tasks.portal_task_review(client, L, { task: tHid.id })],
    ["portal_task_file_path(tâche non visible)", CALLS.tasks.portal_task_file_path(client, L, { task: tHid.id, file: aHid.id })],
    ["portal_task_file_path(fichier d'une autre tâche)", CALLS.tasks.portal_task_file_path(client, L, { task: tVis.id, file: aHid.id })],
    ["portal_file_path(fichier non partagé)", CALLS.files.portal_file_path(client, L, { file: aInt.id })],
    ["portal_file_remove(fichier de l'agence)", CALLS.files.portal_file_remove(client, L, { file: aVis.id })],
    ["portal_creative(créa non soumise)", CALLS.creatives.portal_creative(client, L, { concept: cInt.id })],
    ["portal_creative_review(créa non soumise)", CALLS.creatives.portal_creative_review(client, L, { concept: cInt.id })],
    ["portal_asset_path(fichier d'une créa non soumise)", CALLS.creatives.portal_asset_path(client, L, { asset: sInt.id })],
    ["portal_report(rapport non publié)", CALLS.reporting.portal_report(client, L, { report: rInt.id })],
    ["portal_task(identifiant inexistant)", CALLS.tasks.portal_task(client, L, { task: NIL })],
    ["portal_file_add(chemin d'un fichier interne)", CALLS.files.portal_file_add(client, L, { project: LUM.id, path: aInt.path })],
    ["portal_file_add(chemin d'un fichier Kalia)", CALLS.files.portal_file_add(client, L, { project: LUM.id, path: kAtt.path })],
    ["portal_file_add(chemin avec ..)", CALLS.files.portal_file_add(client, L, { project: LUM.id, path: `${ws.id}/${LUM.id}/portal/../test-portail-interne.txt` })],
    ["portal_file_add(dépôt jamais envoyé)", CALLS.files.portal_file_add(client, L, { project: LUM.id, path: portalPath })],
  ];
  for (const [name, p] of hidden) {
    const r = await p;
    check(name, refused(r), why(r));
  }
  check("le fichier de l'agence existe toujours", !!(await admin.from("attachments").select("id").eq("id", aVis.id).maybeSingle()).data);
  check("aucune pièce jointe ne pointe vers le fichier interne", ((await admin.from("attachments").select("id").eq("path", aInt.path)).data ?? []).length === 1);

  // Lectures autorisées : on garde tout ce qui est renvoyé pour chercher une fuite
  const payloads = {};
  const read = async (name, p) => {
    const r = await p;
    payloads[name] = JSON.stringify(r.data ?? null);
    return r;
  };
  const ctx = await read("portal_context", client.rpc("portal_context", { p_slug: "studio-demo" }));
  check("portal_context : seulement Maison Lumen, pas en aperçu", ctx.data?.portals?.length === 1 && ctx.data.portals[0].company_id === L && ctx.data.preview === false);
  const home = await read("portal_home", client.rpc("portal_home", { p_company: L }));
  check("portal_home : la tâche visible est à valider, pas la tâche interne", home.data?.review_tasks?.some((t) => t.id === tVis.id) && !home.data.review_tasks.some((t) => t.id === tHid.id), why(home));
  const tasks = await read("portal_tasks", CALLS.tasks.portal_tasks(client, L));
  check("portal_tasks : tâche visible listée, tâche interne absente", tasks.data?.tasks?.some((t) => t.id === tVis.id) && !tasks.data.tasks.some((t) => t.id === tHid.id), why(tasks));
  check("portal_tasks : prénom du responsable seulement", tasks.data?.tasks?.find((t) => t.id === tVis.id)?.assignee?.includes(" ") === false);
  const task = await read("portal_task", CALLS.tasks.portal_task(client, L, OWN));
  check("portal_task : le commentaire partagé est là, le commentaire interne jamais", task.data?.comments?.length === 1 && task.data.comments[0].body.includes("message partagé"), `${task.data?.comments?.length} commentaire(s)`);
  check("portal_task : seul le fichier partagé de la tâche", task.data?.files?.length === 1 && task.data.files[0].id === aVis.id);
  const creas = await read("portal_creatives", CALLS.creatives.portal_creatives(client, L));
  check("portal_creatives : créa soumise listée, créa non soumise absente", creas.data?.some((c) => c.id === cVis.id) && !creas.data.some((c) => c.id === cInt.id), why(creas));
  const crea = await read("portal_creative", CALLS.creatives.portal_creative(client, L, OWN));
  check("portal_creative : titre, accroche, script et fichiers", crea.data?.script === "Script partagé" && crea.data.assets?.length === 1, why(crea));
  const files = await read("portal_files", CALLS.files.portal_files(client, L));
  check("portal_files : fichier partagé listé, fichiers internes absents", files.data?.files?.some((f) => f.id === aVis.id) && !files.data.files.some((f) => [aInt.id, aHid.id].includes(f.id)), why(files));
  const reporting = await read("portal_reporting", CALLS.reporting.portal_reporting(client, L));
  check("portal_reporting : rapport publié listé, brouillon absent", reporting.data?.reports?.some((r) => r.id === rVis.id) && !reporting.data.reports.some((r) => r.id === rInt.id), why(reporting));
  const lumenAccounts = (must(await admin.from("ad_accounts").select("id").eq("company_id", L), "comptes pub") ?? []).map((a) => a.id);
  check("portal_reporting : uniquement les comptes publicitaires de l'entreprise", (reporting.data?.accounts ?? []).every((a) => lumenAccounts.includes(a.id)) && (reporting.data?.metrics ?? []).every((m) => lumenAccounts.includes(m.account)), `${reporting.data?.accounts?.length} compte(s), ${reporting.data?.metrics?.length} ligne(s)`);
  const report = await read("portal_report", CALLS.reporting.portal_report(client, L, OWN));
  check("portal_report : rapport publié lisible, au format de public_report", report.data?.report?.id === rVis.id && Array.isArray(report.data.metrics) && !("public_token" in report.data.report) && !("created_by" in report.data.report), why(report));
  // Analytics de site (GA4, Clarity) : agrégats de l'entreprise seulement, version « client »
  const siteA = await read("portal_site_analytics", CALLS.reporting.portal_site_analytics(client, L));
  const lumenRows = must(await admin.from("analytics_sources").select("id, kind").eq("company_id", L), "sources d'analytics") ?? [];
  const lumenSources = lumenRows.map((x) => x.id);
  const hasGa4 = lumenRows.some((x) => x.kind === "ga4");
  const siteSources = [...(siteA.data?.ga4?.sources ?? []), ...(siteA.data?.clarity?.sources ?? [])];
  check("portal_site_analytics : uniquement les sources de l'entreprise", !siteA.error && siteSources.every((x) => lumenSources.includes(x.id)) && siteSources.length === lumenSources.length, `${siteSources.length} source(s) sur ${lumenSources.length}`);
  check("portal_site_analytics : ni identifiant externe, ni erreur de synchro, ni tracking first-party", siteSources.every((x) => !("external_id" in x) && !("sync_error" in x) && !("connected" in x)) && siteA.data?.first_party === null, why(siteA));
  check("portal_report : la section cochée (trafic du site) est jointe, pas l'autre", (hasGa4 ? !!report.data?.analytics?.ga4 : report.data?.analytics?.ga4 === null) && report.data?.analytics?.clarity === null && JSON.stringify(report.data?.report?.sections) === '["site"]', JSON.stringify(report.data?.report?.sections));
  const pub = await anonyme.rpc("public_report", { p_token: rVis.public_token });
  payloads.public_report = JSON.stringify(pub.data ?? null);
  check("public_report : sections en version client, sans jeton public", !pub.error && (hasGa4 ? !!pub.data?.analytics?.ga4 : pub.data?.analytics?.ga4 === null) && pub.data?.analytics?.clarity === null && pub.data.analytics.first_party === null && !("public_token" in pub.data.report) && !/external_id|sync_error/.test(payloads.public_report), why(pub));
  const pubK = await anonyme.rpc("public_report", { p_token: kReport.public_token });
  check("public_report sans section cochée : aucune donnée de site", !pubK.error && pubK.data?.analytics === null, why(pubK));
  const pubInt = await anonyme.rpc("public_report", { p_token: rInt.public_token });
  check("public_report d'un rapport non publié : rien", pubInt.data === null);
  await read("portal_documents", CALLS.documents.portal_documents(client, L));
  await read("portal_onboarding", CALLS.onboarding.portal_onboarding(client, L));
  await read("portal_booking", CALLS.booking.portal_booking(client, L));
  const fp = await read("portal_file_path", CALLS.files.portal_file_path(client, L, OWN));
  check("portal_file_path : chemin du fichier partagé", fp.data?.path === aVis.path, why(fp));
  const tfp = await CALLS.tasks.portal_task_file_path(client, L, OWN);
  check("portal_task_file_path : chemin du fichier de la tâche", tfp.data?.path === aVis.path, why(tfp));
  const ap = await CALLS.creatives.portal_asset_path(client, L, OWN);
  check("portal_asset_path : chemin du fichier de la créa soumise", ap.data?.path === sVis.path, why(ap));

  const team = must(await admin.from("workspace_members").select("profile:profiles(email, full_name)").eq("workspace_id", ws.id), "membres");
  const lumenRow = must(await admin.from("companies").select("notes, monthly_retainer").eq("id", L).single(), "client");
  const leaks = [SECRET, ...team.map((m) => m.profile.email), ...team.map((m) => m.profile.full_name).filter((n) => n.includes(" "))];
  if (lumenRow.notes?.trim().length > 12) leaks.push(lumenRow.notes.trim().slice(0, 40));
  const KEYS = ["monthly_retainer", "notes", "verdict", "persona", "ai_tags", "brief", "owner_id", "assignee_id", "created_by", "public_token", "access_token", "answers", "ip_hash"];
  for (const [name, json] of Object.entries(payloads)) {
    const hit = leaks.find((l) => l && json.includes(l));
    // le nom du responsable de la page de rendez-vous est public (page /b/<slug>) : seul cas où un nom complet sort
    const okName = name === "portal_booking" && hit && !hit.includes("@") && hit !== SECRET;
    const key = KEYS.find((k) => json.includes(`"${k}"`));
    check(`${name} : ni donnée interne, ni email ou nom complet de l'équipe`, (!hit || okName) && !key, hit && !okName ? `fuite : ${hit}` : key ? `clé interne : ${key}` : "");
  }

  // -------------------------------------------------------------------
  section("4. Fonctionnalité non ouverte (portail, puis personne)");
  for (const [feature, group] of Object.entries(CALLS)) {
    await setFeatures(ALL.filter((f) => f !== feature));
    for (const [name, call] of Object.entries(group)) {
      const r = await call(client, L, OWN);
      check(`${name} sans « ${feature} »`, denied(r) && r.error.code === "42501", why(r));
    }
    const h = await client.rpc("portal_home", { p_company: L });
    const gone = { reporting: ["performance", "last_report"], tasks: ["review_tasks"], creatives: ["review_creatives"], documents: ["review_proposals"], onboarding: ["onboarding"], booking: ["booking"], files: [] }[feature];
    check(`portal_home sans « ${feature} » : bloc absent`, !h.error && gone.every((k) => !(k in h.data)) && !h.data.features.includes(feature), why(h));
  }
  await setFeatures(ALL);
  await admin.from("client_users").update({ features: ["reporting"] }).eq("company_id", L).eq("user_id", me.id);
  const pu = await CALLS.tasks.portal_tasks(client, L);
  check("droits réduits de la personne : tâches refusées", denied(pu), why(pu));
  const pr = await CALLS.reporting.portal_reporting(client, L);
  check("droits réduits de la personne : reporting autorisé", !pr.error && !!pr.data);
  await admin.from("client_users").update({ features: null }).eq("company_id", L).eq("user_id", me.id);
  await admin.from("client_portals").update({ enabled: false }).eq("company_id", L);
  const off = await client.rpc("portal_home", { p_company: L });
  check("portail désactivé : accueil refusé", denied(off), why(off));
  const offCtx = await client.rpc("portal_context", { p_slug: "studio-demo" });
  check("portail désactivé : aucun portail dans le contexte", (offCtx.data?.portals ?? []).length === 0);
  await setFeatures(ALL);

  await admin.from("projects").update({ portal_mode: "none" }).eq("id", LUM.id);
  const none = await Promise.all([CALLS.tasks.portal_task(client, L, OWN), CALLS.files.portal_file_path(client, L, OWN), CALLS.files.portal_upload_target(client, L, OWN)]);
  check("projet masqué (portal_mode = none) : tâche, fichier et dépôt refusés", none.every(denied), none.map(why).join(" | "));
  await admin.from("projects").update({ portal_mode: "all" }).eq("id", LUM.id);
  const allMode = await CALLS.tasks.portal_task(client, L, { task: tHid.id });
  check("projet entièrement partagé (portal_mode = all) : toutes ses tâches deviennent visibles", !allMode.error && allMode.data?.id === tHid.id, why(allMode));
  await admin.from("projects").update({ portal_mode: "selected" }).eq("id", LUM.id);

  // -------------------------------------------------------------------
  section("5. Module de l'espace désactivé (espace temporaire)");
  const tw = await insert("workspaces", { name: "Test portail", slug: tempSlug, modules: ["crm"] });
  const tc = await insert("companies", { workspace_id: tw.id, name: "Client test", status: "client" });
  await insert("client_portals", { company_id: tc.id, workspace_id: tw.id, enabled: true, features: ALL });
  await insert("client_users", { workspace_id: tw.id, company_id: tc.id, user_id: me.id });
  const m1 = await client.rpc("portal_context", { p_slug: tempSlug });
  check("modules = [crm] : aucune fonctionnalité dans le contexte", m1.data?.portals?.[0]?.features?.length === 0, JSON.stringify(m1.data?.portals?.[0]?.features));
  for (const [name, call] of [["portal_tasks", CALLS.tasks.portal_tasks], ["portal_reporting", CALLS.reporting.portal_reporting], ["portal_site_analytics", CALLS.reporting.portal_site_analytics], ["portal_creatives", CALLS.creatives.portal_creatives], ["portal_files", CALLS.files.portal_files], ["portal_documents", CALLS.documents.portal_documents], ["portal_onboarding", CALLS.onboarding.portal_onboarding], ["portal_booking", CALLS.booking.portal_booking]]) {
    const r = await call(client, tc.id, OWN);
    check(`${name} : refusé, module désactivé`, denied(r) && r.error.code === "42501", why(r));
  }
  await admin.from("workspaces").update({ modules: ["reporting", "projects"] }).eq("id", tw.id);
  const m2 = await client.rpc("portal_context", { p_slug: tempSlug });
  check("modules = [reporting, projects] : reporting, tasks et files seulement", JSON.stringify(m2.data?.portals?.[0]?.features) === '["reporting","tasks","files"]', JSON.stringify(m2.data?.portals?.[0]?.features));
  const m3 = await CALLS.tasks.portal_tasks(client, tc.id);
  check("portal_tasks : autorisé une fois le module activé", !m3.error, why(m3));

  // -------------------------------------------------------------------
  section("6. Audit des fonctions security definer existantes, avec le compte client (non membre)");
  const tp = (await admin.from("proposals").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
  const site = (await admin.from("tracking_sites").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
  const link = (await admin.from("links").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
  const bp = (await admin.from("booking_profiles").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
  const D = { p_start: "2026-01-01", p_end: "2026-12-31" };
  const empty = (r) => !r.error && (r.data === null || r.data === false || (Array.isArray(r.data) && r.data.length === 0));
  const zero = (r) => empty(r) || !!r.error;
  const audit = [
    ["is_member", client.rpc("is_member", { ws: ws.id }), empty],
    ["can_write", client.rpc("can_write", { ws: ws.id }), empty],
    ["is_admin", client.rpc("is_admin", { ws: ws.id }), empty],
    ["has_role", client.rpc("has_role", { ws: ws.id, roles: ["owner", "admin", "member", "guest"] }), empty],
    ["shares_workspace", client.rpc("shares_workspace", { other: agenceId }), empty],
    ["task_ws (tâche Kalia)", client.rpc("task_ws", { t: kTask.id }), empty],
    ["task_ws (sa propre tâche visible)", client.rpc("task_ws", { t: tVis.id }), empty],
    ["project_ws", client.rpc("project_ws", { p: LUM.id }), empty],
    ["proposal_ws", tp ? client.rpc("proposal_ws", { p: tp.id }) : Promise.resolve({ data: null, error: null }), empty],
    ["portal_task_visible (tâche Kalia, sans accès à Kalia)", client.rpc("portal_task_visible", { p_task: kTask.id, p_company: K }), empty],
    ["booking_my_profile", client.rpc("booking_my_profile", { ws: ws.id }), empty],
    ["booking_profile_editable", bp ? client.rpc("booking_profile_editable", { p: bp.id, ws: ws.id }) : Promise.resolve({ data: false, error: null }), empty],
    ["creative_ad_attribution", client.rpc("creative_ad_attribution", { p_ws: ws.id, ...D }), empty],
    ["creative_intel_status", client.rpc("creative_intel_status", { ws: ws.id }), empty],
    ["tracking_conversions", site ? client.rpc("tracking_conversions", { p_site: site.id, ...D }) : Promise.resolve({ data: [], error: null }), empty],
    ["tracking_people", site ? client.rpc("tracking_people", { p_site: site.id }) : Promise.resolve({ data: [], error: null }), empty],
    ["tracking_stats", site ? client.rpc("tracking_stats", { p_site: site.id, ...D }) : Promise.resolve({ data: null, error: null }), empty],
    ["tracking_site_secret", site ? client.rpc("tracking_site_secret", { p_site: site.id }) : Promise.resolve({ data: null, error: null }), empty],
    ["create_api_token", client.rpc("create_api_token", { p_ws: ws.id, p_name: "test" }), denied],
    ["revoke_api_token", client.rpc("revoke_api_token", { p_id: NIL }), denied],
    ["accept_invitation (jeton inconnu)", client.rpc("accept_invitation", { p_token: "inconnu" }), denied],
    // security invoker : la RLS s'applique
    ["ad_daily", client.rpc("ad_daily", { p_ws: ws.id, ...D }), empty],
    ["ad_campaigns", client.rpc("ad_campaigns", { p_ws: ws.id, ...D, p_company: L }), empty],
    ["creative_ad_daily", client.rpc("creative_ad_daily", { p_ws: ws.id, ...D }), empty],
    ["analytics_overview", client.rpc("analytics_overview", { p_ws: ws.id, ...D }), empty],
    // analytics de site : réservée aux membres (null pour un client, même sur sa propre entreprise)
    ["site_analytics (sa propre entreprise)", client.rpc("site_analytics", { p_company: L, ...D }), empty],
    ["site_analytics (Kalia)", client.rpc("site_analytics", { p_company: K, ...D }), empty],
    ["link_attribution", client.rpc("link_attribution", { p_ws: ws.id, p_link: link?.id ?? NIL, p_from: "2026-01-01", p_to: "2026-12-31" }), zero],
    // fonctions internes : jamais appelables par un client
    ["_site_analytics (interne)", client.rpc("_site_analytics", { p_company: L, ...D }), denied],
    ["_report_analytics (interne)", client.rpc("_report_analytics", { p_company: L, ...D, p_sections: ["site", "behavior"] }), denied],
    ["_demo_analytics (interne)", client.rpc("_demo_analytics", { ws: ws.id }), denied],
    ["portal_company_tasks (interne)", client.rpc("portal_company_tasks", { p_company: L }), denied],
    ["portal_company_files (interne)", client.rpc("portal_company_files", { p_company: L }), denied],
    ["portal_person (interne)", client.rpc("portal_person", { p_user: agenceId, p_company: L }), denied],
    ["portal_has_access (interne)", client.rpc("portal_has_access", { p_company: L }), denied],
    ["portal_require_write (interne)", client.rpc("portal_require_write", { p_company: L }), denied],
    ["portal_module_require (interne)", client.rpc("portal_module_require", { p_company: L, p_feature: "tasks" }), denied],
    ["notify_portal_clients (interne)", client.rpc("notify_portal_clients", { p_company: K, p_feature: "tasks", p_body: "x", p_link: "tasks" }), denied],
  ];
  for (const [name, p, ok] of audit) {
    const r = await p;
    check(name, ok(r), why(r));
  }
  const sum = await client.rpc("spend_summary", { ws: ws.id, days: 30 });
  check("spend_summary : aucune dépense, aucun compte", !sum.error && Number(sum.data?.spend ?? 0) === 0 && Number(sum.data?.accounts ?? 0) === 0, why(sum));
  // Fonctions de démo et de remise à zéro : essayées sur l'espace temporaire (où le client a un portail mais n'est pas membre)
  for (const fn of ["load_demo_data", "clear_demo_data", "load_demo_tracking", "clear_demo_tracking", "load_demo_links", "clear_demo_links", "load_demo_onboarding", "clear_demo_onboarding", "load_demo_creatives", "clear_demo_creatives", "load_demo_booking", "clear_demo_booking", "load_demo_intel", "clear_demo_intel", "load_demo_portal", "clear_demo_portal", "load_demo_analytics", "clear_demo_analytics", "restore_onboarding_templates"]) {
    const r = await client.rpc(fn, { ws: tw.id });
    check(`${fn} : réservé aux membres`, !!r.error, why(r));
  }
  check("les données de démo de l'espace temporaire n'ont pas été chargées", ((await admin.from("companies").select("id").eq("workspace_id", tw.id)).data ?? []).length === 1);

  // Écritures directes sur ce dont le client est l'auteur
  const posted = await client.rpc("portal_task_comment", { p_company: L, p_task: tVis.id, p_body: `${TAG} bonjour` });
  check("portal_task_comment : le client répond dans le fil partagé", !posted.error && !!posted.data?.id, why(posted));
  const up1 = await client.from("comments").update({ task_id: kTask.id, visibility: "internal", body: "détourné" }).eq("id", posted.data?.id ?? NIL).select("id");
  const up2 = await client.from("comments").update({ body: "détourné" }).eq("author_id", me.id);
  const cm = must(await admin.from("comments").select("task_id, visibility, body, author_id").eq("id", posted.data?.id ?? NIL).single(), "commentaire");
  check("un client ne modifie pas son commentaire en direct (déplacement, visibilité)", (up1.data ?? []).length === 0 && cm.task_id === tVis.id && cm.visibility === "client" && cm.body.includes("bonjour"), up2.error?.message ?? "");
  check("le commentaire porte l'auteur et la visibilité « client »", cm.author_id === me.id && cm.visibility === "client");
  const notif = await client.from("notifications").insert({ workspace_id: ws.id, user_id: agenceId, kind: "status", body: "spam" }).select("id");
  check("un client n'émet pas de notification", !!notif.error);
  const dl = await client.storage.from("attachments").download(aInt.path);
  check("Storage : téléchargement direct refusé", !!dl.error);
  const sg = await client.storage.from("attachments").createSignedUrl(aVis.path, 60);
  check("Storage : URL signée directe refusée (même pour un fichier partagé)", !!sg.error);
  const ls = await client.storage.from("attachments").list(`${ws.id}/${LUM.id}`);
  check("Storage : liste directe vide", (ls.data ?? []).length === 0);
  const wr = await client.storage.from("attachments").upload(`${ws.id}/${LUM.id}/portal/${randomUUID()}-test-portail-direct.txt`, Buffer.from("x"));
  check("Storage : écriture directe refusée", !!wr.error);

  // -------------------------------------------------------------------
  section("7. Actions du client");
  const after = await CALLS.tasks.portal_task(client, L, OWN);
  check("la réponse du client apparaît dans la fiche, marquée comme la sienne", after.data?.comments?.some((c) => c.author.mine && c.author.client && c.body.includes("bonjour")), why(after));
  const noWhy = await client.rpc("portal_task_review", { p_company: L, p_task: tVis.id, p_approve: false, p_comment: "  " });
  check("demande de modifications sans commentaire : refusée", denied(noWhy) && noWhy.error.code === "22023", why(noWhy));
  const chg = await client.rpc("portal_task_review", { p_company: L, p_task: tVis.id, p_approve: false, p_comment: `${TAG} merci de revoir le titre` });
  const t1 = must(await admin.from("tasks").select("status").eq("id", tVis.id).single(), "tâche");
  check("demande de modifications : la tâche repasse en cours", !chg.error && t1.status === "progress", why(chg));
  const again = await client.rpc("portal_task_review", { p_company: L, p_task: tVis.id, p_approve: true });
  check("valider une tâche qui n'est plus en validation : refusé", denied(again), why(again));
  await admin.from("tasks").update({ status: "review" }).eq("id", tVis.id);
  const okv = await client.rpc("portal_task_review", { p_company: L, p_task: tVis.id, p_approve: true });
  const t2 = must(await admin.from("tasks").select("status, completed_at").eq("id", tVis.id).single(), "tâche");
  check("validation : la tâche est terminée", !okv.error && t2.status === "done" && !!t2.completed_at, why(okv));
  const acts = must(await admin.from("activity").select("verb, meta, actor_id").eq("task_id", tVis.id).eq("verb", "task.status"), "journal");
  check("journal : task.status avec via = portal, de la part du client", acts.length === 2 && acts.every((a) => a.meta.via === "portal" && a.actor_id === me.id) && acts.some((a) => a.meta.to === "done") && acts.some((a) => a.meta.to === "progress"), JSON.stringify(acts.map((a) => a.meta.to)));

  const cNo = await client.rpc("portal_creative_review", { p_company: L, p_concept: cVis.id, p_approve: false, p_feedback: "" });
  check("créa : modifications sans commentaire refusées", denied(cNo) && cNo.error.code === "22023", why(cNo));
  const cOk = await client.rpc("portal_creative_review", { p_company: L, p_concept: cVis.id, p_approve: false, p_feedback: `${TAG} logo plus grand` });
  const c1 = must(await admin.from("creative_concepts").select("client_review, client_feedback, client_reviewed_by, client_reviewed_at, status, verdict").eq("id", cVis.id).single(), "créa");
  check("créa : décision enregistrée (statut client, commentaire, auteur, date)", !cOk.error && c1.client_review === "changes" && c1.client_feedback.includes("logo") && c1.client_reviewed_by === me.id && !!c1.client_reviewed_at, why(cOk));
  check("créa : le reste du concept est intact (statut interne, verdict)", c1.status === cVis.status && c1.verdict === cVis.verdict);
  const cTwice = await client.rpc("portal_creative_review", { p_company: L, p_concept: cVis.id, p_approve: true });
  check("créa déjà traitée : nouvelle décision refusée", denied(cTwice), why(cTwice));
  const hist = await CALLS.creatives.portal_creative(client, L, OWN);
  check("créa : la décision figure dans l'historique", hist.data?.history?.length === 1 && hist.data.history[0].decision === "changes", why(hist));

  // -------------------------------------------------------------------
  section("8. Aperçu par un membre de l'agence : lecture seule");
  const pctx = await agence.rpc("portal_context", { p_slug: "studio-demo" });
  check("portal_context : aperçu, toutes les entreprises de l'espace", pctx.data?.preview === true && pctx.data.portals.length === cos.length, `${pctx.data?.portals?.length} entreprise(s)`);
  const pread = await Promise.all([agence.rpc("portal_home", { p_company: L }), CALLS.tasks.portal_tasks(agence, L), CALLS.tasks.portal_task(agence, L, { task: tHid.id })]);
  check("le membre lit l'accueil et les tâches partagées", !pread[0].error && !pread[1].error);
  check("même en aperçu, une tâche non partagée reste hors du portail", denied(pread[2]), why(pread[2]));
  await admin.from("tasks").update({ status: "review" }).eq("id", tVis.id);
  await admin.from("creative_concepts").update({ client_review: "pending" }).eq("id", cVis.id);
  const writes = [
    ["portal_task_comment", CALLS.tasks.portal_task_comment(agence, L, OWN)],
    ["portal_task_review", CALLS.tasks.portal_task_review(agence, L, OWN)],
    ["portal_creative_review", CALLS.creatives.portal_creative_review(agence, L, OWN)],
    ["portal_upload_target", CALLS.files.portal_upload_target(agence, L, OWN)],
    ["portal_file_add", CALLS.files.portal_file_add(agence, L, OWN)],
    ["portal_file_remove", CALLS.files.portal_file_remove(agence, L, OWN)],
  ];
  for (const [name, p] of writes) {
    const r = await p;
    check(`${name} en aperçu : refusé avec explication`, denied(r) && r.error.code === "42501" && r.error.message.startsWith("Aperçu"), why(r));
  }
  const t3 = must(await admin.from("tasks").select("status").eq("id", tVis.id).single(), "tâche");
  check("la tâche n'a pas été validée par l'aperçu", t3.status === "review");

  // -------------------------------------------------------------------
  section("9. Compte inconnu et visiteur non connecté");
  const ictx = await intrus.rpc("portal_context", { p_slug: "studio-demo" });
  check("inconnu : portal_context ne dit rien de l'espace", ictx.data === null && !ictx.error, why(ictx));
  for (const [name, call] of [["portal_home", (sb, c) => sb.rpc("portal_home", { p_company: c })], ...everyCall]) {
    const r = await call(intrus, L, OWN);
    check(`inconnu : ${name} refusé`, denied(r), why(r));
  }
  check("inconnu : portal_task_visible répond faux", (await intrus.rpc("portal_task_visible", { p_task: tVis.id, p_company: L })).data === false);
  check("inconnu : aucune fonctionnalité effective", ((await intrus.rpc("portal_effective_features", { p_company: L })).data ?? []).length === 0);
  for (const [name, call] of [["portal_context", (sb) => sb.rpc("portal_context", { p_slug: "studio-demo" })], ["portal_home", (sb, c) => sb.rpc("portal_home", { p_company: c })], ...everyCall]) {
    const r = await call(anonyme, L, OWN);
    check(`non connecté : ${name} non exécutable`, !!r.error, why(r));
  }

  // -------------------------------------------------------------------
  section(`10. Routes /api/portal/* (${APP})`);
  const up = await fetch(`${APP}/api/portal/file`, { redirect: "manual" }).catch(() => null);
  if (!up) console.log("  (application injoignable : routes non testées, lance `npm run dev` ou renseigne PORTAL_TEST_URL)");
  else {
    const ck = { client: await cookieFor(CLIENT), intrus: await cookieFor(INTRUS), agence: await cookieFor(AGENCE) };
    const get = (who, q) => fetch(`${APP}/api/portal/file?${new URLSearchParams(q)}`, { redirect: "manual", headers: who ? { Cookie: ck[who] } : {} });
    const api = (who, method, body) => fetch(`${APP}/api/portal/upload`, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(who ? { Cookie: ck[who] } : {}) }, body: JSON.stringify(body) });
    const sup = new URL(url).host;

    check("fichier sans session : 401", (await get(null, { company: L, kind: "file", id: aVis.id })).status === 401);
    const g1 = await get("client", { company: L, kind: "file", id: aVis.id });
    const loc = g1.headers.get("location") ?? "";
    check("fichier partagé : redirection vers une URL signée du Storage", g1.status === 302 && loc.includes(sup) && loc.includes("/object/sign/attachments/") && loc.includes("token="), `${g1.status} ${loc.slice(0, 60)}`);
    const body = loc ? await (await fetch(loc)).text() : "";
    check("l'URL signée délivre bien le fichier partagé", body === "visible", body.slice(0, 30));
    const g2 = await get("client", { company: L, kind: "task", id: aVis.id, task: tVis.id });
    check("fichier d'une tâche visible : délivré", g2.status === 302);
    const g3 = await get("client", { company: L, kind: "asset", id: sVis.id });
    check("fichier d'une créa soumise : délivré", g3.status === 302);
    const no = [
      ["fichier interne", "client", { company: L, kind: "file", id: aInt.id }],
      ["fichier Kalia avec company = Lumen", "client", { company: L, kind: "file", id: kAtt.id }],
      ["fichier Kalia avec company = Kalia", "client", { company: K, kind: "file", id: kAtt.id }],
      ["fichier d'une tâche non visible", "client", { company: L, kind: "task", id: aHid.id, task: tHid.id }],
      ["fichier de tâche Kalia", "client", { company: L, kind: "task", id: kAtt.id, task: kTask.id }],
      ["fichier d'une créa non soumise", "client", { company: L, kind: "asset", id: sInt.id }],
      ["fichier d'une créa Kalia", "client", { company: L, kind: "asset", id: kAsset.id }],
      ["identifiant d'une pièce passé comme fichier de créa", "client", { company: L, kind: "asset", id: aVis.id }],
      ["identifiant mal formé", "client", { company: L, kind: "file", id: "../../x" }],
      ["compte inconnu", "intrus", { company: L, kind: "file", id: aVis.id }],
    ];
    for (const [name, who, q] of no) {
      const r = await get(who, q);
      check(`${name} : 404, aucune URL`, r.status === 404 && !r.headers.get("location"), String(r.status));
    }

    check("dépôt sans session : 401", (await api(null, "POST", { company: L, project: LUM.id, name: "a.txt", size: 3 })).status === 401);
    check("dépôt sur un projet Kalia : 403", (await api("client", "POST", { company: L, project: KAL.id, name: "a.txt", size: 3 })).status === 403);
    check("dépôt avec company = Kalia : 403", (await api("client", "POST", { company: K, project: KAL.id, name: "a.txt", size: 3 })).status === 403);
    check("dépôt par un inconnu : 403", (await api("intrus", "POST", { company: L, project: LUM.id, name: "a.txt", size: 3 })).status === 403);
    const pv = await api("agence", "POST", { company: L, project: LUM.id, name: "a.txt", size: 3 });
    check("dépôt en aperçu : 403 avec explication", pv.status === 403 && ((await pv.json()).error ?? "").startsWith("Aperçu"));
    check("fichier de plus de 50 Mo : 413", (await api("client", "POST", { company: L, project: LUM.id, name: "gros.mp4", size: 50 * 1048576 + 1 })).status === 413);
    const s1 = await api("client", "POST", { company: L, project: LUM.id, name: "test-portail dépôt été.txt", size: 5 });
    const j1 = await s1.json();
    check("dépôt : URL signée d'envoi, chemin <espace>/<projet>/portal/<uuid>-<nom>", s1.status === 200 && new RegExp(`^${ws.id}/${LUM.id}/portal/[0-9a-f-]{36}-test-portail-depot-ete\\.txt$`).test(j1.path ?? ""), j1.path ?? j1.error);
    if (j1.path) {
      objects.push(j1.path);
      const sent = await client.storage.from("attachments").uploadToSignedUrl(j1.path, j1.token, Buffer.from("depot"), { contentType: "text/plain" });
      check("envoi direct au Storage avec le jeton", !sent.error, sent.error?.message ?? "");
      const bad = await api("client", "PUT", { company: L, project: LUM.id, path: aInt.path, name: "vol.txt" });
      check("confirmation avec le chemin d'un fichier interne : 400", bad.status === 400);
      check("le fichier interne est toujours dans le Storage", !(await admin.storage.from("attachments").download(aInt.path)).error);
      const conf = await api("client", "PUT", { company: L, project: LUM.id, path: j1.path, name: "test-portail-depot.txt", mime: "text/plain" });
      const jc = await conf.json();
      const row = jc.file?.id ? (await admin.from("attachments").select("*").eq("id", jc.file.id).maybeSingle()).data : null;
      check("confirmation : pièce créée, visible par le client, au nom du client, taille lue dans le Storage", conf.status === 200 && row?.client_visible === true && row.uploaded_by === me.id && row.project_id === LUM.id && Number(row.size) === 5 && row.path === j1.path, jc.error ?? "");
      const twice = await api("client", "PUT", { company: L, project: LUM.id, path: j1.path, name: "test-portail-depot.txt" });
      check("même fichier confirmé deux fois : refusé, sans supprimer l'objet", twice.status === 400 && !(await admin.storage.from("attachments").download(j1.path)).error);
      const mine = await get("client", { company: L, kind: "file", id: row?.id ?? NIL });
      check("le client retrouve son dépôt", mine.status === 302);
      check("retrait par un inconnu : 404", (await api("intrus", "DELETE", { company: L, file: row?.id ?? NIL })).status === 404);
      check("retrait d'un fichier de l'agence : 404", (await api("client", "DELETE", { company: L, file: aVis.id })).status === 404);
      const del = await api("client", "DELETE", { company: L, file: row?.id ?? NIL });
      const rowGone = !(await admin.from("attachments").select("id").eq("id", row?.id ?? NIL).maybeSingle()).data;
      const objGone = !(await admin.storage.from("attachments").exists(j1.path)).data;
      check("retrait de son propre dépôt : pièce et objet supprimés", del.status === 200 && rowGone && objGone, `statut ${del.status}, pièce ${rowGone ? "supprimée" : "présente"}, objet ${objGone ? "supprimé" : "présent"}`);
    }
    // Routes internes de l'application (service role derrière un contrôle d'appartenance) avec la session du client
    console.log("  Routes internes de l'application, avec la session du client");
    const post = (path, body) => fetch(`${APP}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: ck.client }, body: JSON.stringify(body) });
    const bk = (await admin.from("bookings").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
    const form = (await admin.from("onboarding_forms").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
    const invit = (await admin.from("client_invitations").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle()).data;
    const blocked = [
      ["/api/reporting/sync", post("/api/reporting/sync", { workspace_id: ws.id })],
      // espace temporaire : le client y a un portail sans en être membre (aucun risque pour les données de démo)
      ["/api/demo", post("/api/demo", { workspace_id: tw.id, action: "clear" })],
      ["/api/creatives/intel", post("/api/creatives/intel", { action: "sync", workspace_id: ws.id })],
      ["/api/booking/manage", post("/api/booking/manage", { id: bk?.id ?? NIL, action: "test-portail" })],
      ["/api/onboarding/send", post("/api/onboarding/send", { form_id: form?.id ?? NIL })],
      ["/api/onboarding/automate", post("/api/onboarding/automate", { form_id: form?.id ?? NIL })],
      ["/api/portal-admin/invite", post("/api/portal-admin/invite", { invitation_id: invit?.id ?? NIL })],
      ["/api/booking/google/calendars", fetch(`${APP}/api/booking/google/calendars?ws=${ws.id}`, { headers: { Cookie: ck.client } })],
    ];
    for (const [name, p] of blocked) {
      const r = await p;
      check(`${name} : refusé`, [401, 403, 404].includes(r.status), String(r.status));
    }
    const nt = await post("/api/portal-admin/notify", { kind: "task", ids: [tVis.id] });
    const jn = await nt.json().catch(() => ({}));
    check("/api/portal-admin/notify : aucun envoi", !jn.sent, JSON.stringify(jn).slice(0, 80));
    const oa = await fetch(`${APP}/api/integrations/meta/start?ws=studio-demo`, { redirect: "manual", headers: { Cookie: ck.client } });
    check("/api/integrations/meta/start : pas de départ OAuth", !/facebook\.com/.test(oa.headers.get("location") ?? ""), oa.headers.get("location")?.slice(0, 60) ?? String(oa.status));
  }

  // -------------------------------------------------------------------
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    section("11. Inventaire des fonctions security definer exécutables par authenticated");
    // Chaque fonction listée a été relue : contrôle d'appartenance (is_member, can_write, is_admin, portal_require…),
    // jeton secret, ou réponse limitée à l'appelant. Une fonction absente d'ici doit être auditée avant d'être ajoutée.
    const REVIEWED = new Set([
      "accept_client_invitation", "accept_invitation", "client_invitation_info", "public_proposal", "public_report", "respond_proposal",
      "is_member", "has_role", "can_write", "is_admin", "shares_workspace", "task_ws", "project_ws", "proposal_ws",
      "create_workspace", "create_api_token", "revoke_api_token", "booking_my_profile", "booking_profile_editable",
      "creative_ad_attribution", "creative_intel_status", "link_code_available", "restore_onboarding_templates",
      "tracking_conversions", "tracking_people", "tracking_site_secret", "tracking_stats",
      "load_demo_data", "clear_demo_data", "load_demo_tracking", "clear_demo_tracking", "load_demo_links", "clear_demo_links",
      "load_demo_onboarding", "clear_demo_onboarding", "load_demo_creatives", "clear_demo_creatives", "load_demo_booking", "clear_demo_booking",
      "load_demo_intel", "clear_demo_intel", "load_demo_portal", "clear_demo_portal", "load_demo_analytics", "clear_demo_analytics",
      "site_analytics", "portal_site_analytics",
      "portal_features", "portal_can", "portal_is_preview", "portal_require", "portal_task_visible", "portal_me", "portal_touch",
      "portal_effective_features", "portal_context", "portal_home", "portal_reporting", "portal_report", "portal_tasks", "portal_task",
      "portal_task_comment", "portal_task_review", "portal_creatives", "portal_creative", "portal_creative_review", "portal_files",
      "portal_file_path", "portal_task_file_path", "portal_asset_path", "portal_upload_target", "portal_file_add", "portal_file_remove",
      "portal_documents", "portal_onboarding", "portal_booking",
    ]);
    const ref = new URL(url).host.split(".")[0];
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and pg_get_function_result(p.oid) <> 'trigger'
                  and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
      }),
    });
    if (!res.ok) console.log(`  (inventaire impossible : ${res.status})`);
    else {
      const rows = await res.json();
      const unknown = rows.filter((r) => !REVIEWED.has(r.proname)).map((r) => r.proname);
      check(`${rows.length} fonctions, toutes relues`, unknown.length === 0, unknown.length ? `à auditer : ${unknown.join(", ")}` : "");
      const ANON_OK = ["client_invitation_info", "public_proposal", "public_report", "respond_proposal"];
      const open = rows.filter((r) => r.anon && !ANON_OK.includes(r.proname)).map((r) => r.proname);
      check("aucune n'est exécutable sans connexion, hors pages publiques à jeton", open.length === 0, open.join(", "));
    }
  }

  exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(`\nErreur pendant le test : ${e instanceof Error ? e.message : e}`);
  exitCode = 1;
} finally {
  await restore().catch((e) => console.error("remise en état :", e.message));
  await cleanup().catch((e) => console.error("nettoyage :", e.message));
}

console.log(failed ? `\n${failed} vérification(s) en échec sur ${count}` : exitCode ? "\nTest interrompu" : `\nLes ${count} vérifications passent`);
process.exit(exitCode);
