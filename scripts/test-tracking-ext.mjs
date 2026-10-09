// Recette de l'étape 5 du tracking : API /api/ext/v1 lue par l'extension Chrome.
// Crée un client, un compte publicitaire, un site et un jeton de recette dans l'espace de démo, puis supprime tout.
// Usage : node --env-file=.env.local scripts/test-tracking-ext.mjs   (serveur de dev sur BASE)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE || "http://localhost:3000";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);

let ok = 0;
let ko = 0;
const check = (label, cond, detail) => {
  if (cond) ok++;
  else ko++;
  console.log(`${cond ? "ok   " : "ÉCHEC"} ${label}${cond || detail === undefined ? "" : " : " + JSON.stringify(detail)}`);
};
const must = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 11) + "10:00:00Z";
const dayOf = (daysAgo) => iso(daysAgo).slice(0, 10);

must(await user.auth.signInWithPassword({ email: "demo@agence-os.dev", password: "Demo-agence-2026!" }));
const ws = must(await user.from("workspaces").select("id").eq("slug", "studio-demo").single()).id;
const tag = `[recette] ${Date.now()}`;
const ext = `9${Date.now()}`;
const company = must(await user.from("companies").insert({ workspace_id: ws, name: tag, status: "client" }).select("id").single()).id;
const site = must(await user.from("tracking_sites").insert({ workspace_id: ws, company_id: company, name: `${tag} site`, settings: { template: "appel", window_days: 30, model: "last_click" } }).select("id").single()).id;
const account = must(await admin.from("ad_accounts").insert({ workspace_id: ws, company_id: company, platform: "meta", external_id: `act_${ext}`, name: tag }).select("id").single()).id;
const tokens = [];
const mkToken = async (scope) => {
  const t = must(await user.rpc("create_api_token", { p_ws: ws, p_name: `${tag} ${scope}`, p_scope: scope }));
  tokens.push(t.id);
  return t.token;
};
const api = async (path, token, init = {}) => {
  const r = await fetch(`${BASE}/api/ext/v1/${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body, headers: r.headers };
};

try {
  must(await admin.from("ad_metrics_daily").insert([
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c1", campaign_name: "Prospection froide", spend: 300, conversions: 9, conversion_value: 2000 },
    { ad_account_id: account, workspace_id: ws, date: dayOf(200), campaign_id: "c3", campaign_name: "Ancienne campagne", spend: 80, conversions: 0, conversion_value: 0 },
  ]));
  must(await admin.from("ad_ads").insert([
    { ad_account_id: account, workspace_id: ws, ad_id: "a1", name: "Vidéo A", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s1", adset_name: "Audience large" },
    { ad_account_id: account, workspace_id: ws, ad_id: "a2", name: "Image B", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s1", adset_name: "Audience large" },
    { ad_account_id: account, workspace_id: ws, ad_id: "a3", name: "Image B", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s2", adset_name: "Retargeting" },
  ]));
  must(await admin.from("ad_metrics_ad_daily").insert([
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c1", adset_id: "s1", ad_id: "a1", ad_name: "Vidéo A", spend: 200 },
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c1", adset_id: "s1", ad_id: "a2", ad_name: "Image B", spend: 100 },
  ]));
  const key = must(await user.rpc("create_tracking_key", { p_site: site, p_name: "recette" })).key;
  const send = async (body) => (await fetch(`${BASE}/api/t/conversion`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).status;
  const v = must(await admin.from("visitors").insert({ site_id: site, workspace_id: ws, anon_id: "recette_ext_0001", first_seen: iso(6), last_seen: iso(6) }).select("id").single());
  must(await admin.from("touchpoints").insert({ site_id: site, workspace_id: ws, visitor_id: v.id, ts: iso(6), landing_url: "https://exemple.fr/", channel: "paid_meta", platform: "meta", utm_campaign: "Prospection froide", utm_id: "c1", campaign_key: "c1", adset_key: "s1", ad_key: "a1" }));
  await send({ anon_id: "recette_ext_0001", email: "claire@exemple.fr", name: "Claire Martin", type: "booking", order_id: "b1", ts: iso(4) });
  await send({ anon_id: "recette_ext_0001", email: "claire@exemple.fr", type: "purchase", value: 1000, order_id: "v1", ts: iso(2) });
  await send({ email: "organique@exemple.fr", type: "purchase", value: 400, order_id: "v2", ts: iso(2) });

  const token = await mkToken("ext");

  // -------------------------------------------------------------------
  // 1. Accès
  // -------------------------------------------------------------------
  check("sans jeton : 401 cle_absente", ((r) => r.status === 401 && r.body.code === "cle_absente")(await api("ping", null)));
  check("jeton inconnu : 401 cle_invalide", ((r) => r.status === 401 && r.body.code === "cle_invalide")(await api("ping", "aos_" + "x".repeat(40))));
  const mcp = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  check("un jeton d'extension n'ouvre pas le serveur MCP", mcp.status === 403 || mcp.status === 401, mcp.status);
  const closed = [];
  for (const path of ["/api/demo", "/api/tracking/import"]) closed.push((await fetch(`${BASE}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" })).status);
  check("ni les routes de l'application", closed.every((s) => s === 401), closed);
  const verbs = [];
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) verbs.push((await api("metrics", token, { method: m })).status);
  check("aucune méthode d'écriture sous /api/ext", verbs.every((s) => s === 405), verbs);
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const writers = walk("src/app/api/ext").filter((f) => /export\s+(async\s+)?(function|const)\s+(POST|PUT|PATCH|DELETE)\b/.test(readFileSync(f, "utf8")));
  check("aucun handler d'écriture dans src/app/api/ext", writers.length === 0, writers);

  // -------------------------------------------------------------------
  // 2. ping
  // -------------------------------------------------------------------
  const ping = (await api(`ping?compte=${ext}&plateforme=meta`, token)).body;
  check("ping : contrat v1, produit, site résolu par le compte (sans « act_ »)", ping.ok && ping.api === 1 && ping.produit === "agence-os" && ping.site?.id === site, [ping.api, ping.produit, ping.site]);
  check("ping : catalogue de l'entonnoir « vente par appel »", JSON.stringify(ping.colonnes.map((c) => c.cle)) === JSON.stringify(["depense", "leads", "etape_booking", "etape_show", "etape_qualified", "ventes", "cpl", "caSigne", "roas", "cac", "conversionsPlateforme"]), ping.colonnes.map((c) => c.cle));
  const mine = ping.comptes.find((c) => c.externalId === `act_${ext}`);
  check("ping : le compte est annoncé avec son site", mine?.site === site && mine.plateforme === "meta", mine);
  check("ping : référentiel compté", ping.entites.campagnes === 2 && ping.entites.adsets === 2 && ping.entites.pubs === 3, ping.entites);
  check("ping : modèles du serveur, un seul par défaut", ping.modeles.filter((m) => m.defaut).length === 1 && ping.modeles.find((m) => m.defaut).cle === "last_click", ping.modeles.map((m) => m.cle));

  // -------------------------------------------------------------------
  // 3. metrics
  // -------------------------------------------------------------------
  const q = `compte=act_${ext}&plateforme=meta&p=perso&du=${dayOf(29)}&au=${dayOf(0)}&m=first_paid_click&f=180`;
  const all = (await api(`metrics?${q}&niveau=tout`, token)).body;
  const E = all.entites;
  check("metrics : clés composites aux trois niveaux", ["meta:campagne:c1", "meta:adset:s1", "meta:pub:a1", "meta:pub:a2"].every((k) => k in E), Object.keys(E));
  const c1 = E["meta:campagne:c1"].m;
  check("campagne : dépense, rendez-vous, vente, CA, ROAS, coût par vente", c1.depense === 300 && c1.etape_booking === 1 && c1.ventes === 1 && c1.caSigne === 1000 && Math.abs(c1.roas - 1000 / 300) < 1e-9 && c1.cac === 300 && c1.conversionsPlateforme === 9, c1);
  check("publicité A : sa dépense et la vente ; publicité B : sa dépense, rien d'autre", E["meta:pub:a1"].m.depense === 200 && E["meta:pub:a1"].m.caSigne === 1000 && E["meta:pub:a2"].m.depense === 100 && E["meta:pub:a2"].m.ventes === 0 && E["meta:pub:a2"].m.roas === 0, [E["meta:pub:a1"].m, E["meta:pub:a2"].m]);
  check("parents et niveau de dépense", E["meta:pub:a1"].parentExternalId === "s1" && E["meta:adset:s1"].parentExternalId === "c1" && E["meta:campagne:c1"].niveauDepense === "ad", [E["meta:pub:a1"].parentExternalId, E["meta:campagne:c1"].niveauDepense]);
  const zero = E["meta:campagne:c3"];
  check("campagne connue sans activité sur la période : présente, à zéro, ratios nuls", !!zero && zero.m.depense === 0 && zero.m.ventes === 0 && zero.m.roas === null && zero.m.cac === null, zero);
  check("publicité connue jamais diffusée : présente, à zéro", E["meta:pub:a3"]?.m.depense === 0 && E["meta:pub:a3"].parentExternalId === "s2", E["meta:pub:a3"]);
  check("modèle inconnu du serveur : celui du site, et la réponse le dit", all.modele === "last_click", all.modele);
  check("fenêtre demandée 180, effective 90", all.fenetreDemandee === 180 && all.fenetreEffective === 90, [all.fenetreDemandee, all.fenetreEffective]);
  check("totaux : publicité 1 vente, hors publicité 1 vente, compte 2 ventes", all.totaux.ventes === 1 && all.nonRattachee.ventes === 1 && all.totalCompte.ventes === 2 && all.totalCompte.caSigne === 1400, [all.totaux, all.nonRattachee, all.totalCompte]);

  const some = (await api(`metrics?${q}&niveau=pub&ids=a1,a3,inconnue`, token)).body;
  check("ids : seulement les lignes demandées, l'inconnue est déclarée introuvable", JSON.stringify(Object.keys(some.entites).sort()) === JSON.stringify(["meta:pub:a1", "meta:pub:a3"]) && JSON.stringify(some.compteur.introuvables) === JSON.stringify(["inconnue"]), [Object.keys(some.entites), some.compteur]);
  check("niveau inconnu : 400", (await api(`metrics?${q}&niveau=annonce`, token)).status === 400);
  check("compte non connecté : 404 compte_inconnu", ((r) => r.status === 404 && r.body.code === "compte_inconnu")(await api("metrics?compte=act_1&plateforme=meta", token)));
  check("sans compte ni site, plusieurs sites : 400 site_requis", ((r) => r.status === 400 && r.body.code === "site_requis")(await api("metrics?plateforme=meta", token)));

  // -------------------------------------------------------------------
  // 4. prospects et index
  // -------------------------------------------------------------------
  const pr = (await api(`prospects?${q}&niveau=pub&id=a1`, token)).body;
  check("prospects : la personne, son étape la plus avancée, le montant attribué, un lien vers sa fiche", pr.prospects.length === 1 && pr.prospects[0].nom === "Claire Martin" && pr.prospects[0].etape === "Ventes" && pr.prospects[0].credit === 1000 && /\/tracking\/[0-9a-f-]{36}\?tab=people&person=[0-9a-f-]{36}$/.test(pr.prospects[0].lien), pr.prospects);
  check("prospects : entité connue sans personne : liste vide", ((r) => r.status === 200 && r.body.prospects.length === 0)(await api(`prospects?${q}&niveau=pub&id=a3`, token)));
  check("prospects : entité inconnue : 404", ((r) => r.status === 404 && r.body.code === "entite_inconnue")(await api(`prospects?${q}&niveau=pub&id=zzz`, token)));
  const ix = (await api(`index?compte=act_${ext}&plateforme=meta&niveau=pub`, token)).body;
  check("index : 3 publicités, le nom porté deux fois est déclaré ambigu", ix.entites.length === 3 && JSON.stringify(ix.nomsAmbigus) === JSON.stringify(["meta:pub:image b"]), [ix.entites.length, ix.nomsAmbigus]);

  // -------------------------------------------------------------------
  // 5. Révocation
  // -------------------------------------------------------------------
  must(await user.rpc("revoke_api_token", { p_id: tokens[0] }));
  check("jeton révoqué : 401 cle_revoquee", ((r) => r.status === 401 && r.body.code === "cle_revoquee")(await api("ping", token)));
} catch (e) {
  ko++;
  console.error("Erreur :", e.message ?? e);
} finally {
  for (const id of tokens) await user.from("api_tokens").delete().eq("id", id);
  await user.from("tracking_sites").delete().eq("id", site);
  await admin.from("ad_accounts").delete().eq("id", account);
  await user.from("companies").delete().eq("id", company);
  const left = [(await admin.from("tracking_sites").select("id").eq("id", site)).data?.length, (await admin.from("ad_accounts").select("id").eq("id", account)).data?.length, (await admin.from("companies").select("id").eq("id", company)).data?.length, (await admin.from("api_tokens").select("id").in("id", tokens.length ? tokens : ["00000000-0000-4000-8000-000000000000"])).data?.length];
  check("client, compte, site et jeton de recette supprimés", left.every((n) => n === 0), left);
}
console.log(`\n${ok} vérifications passées, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
