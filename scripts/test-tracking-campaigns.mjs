// Recette de l'étape 4 du tracking : tableau des campagnes, fiche d'une personne, couverture de l'attribution.
// Crée un client, un compte publicitaire et un site de recette dans l'espace de démo, puis supprime tout.
// Usage : node --env-file=.env.local scripts/test-tracking-campaigns.mjs   (serveur de dev sur BASE). Captures dans .snaps/.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

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
const iso = (daysAgo, h = 10) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 11) + `${String(h).padStart(2, "0")}:00:00Z`;
const dayOf = (daysAgo) => iso(daysAgo).slice(0, 10);
const norm = (s) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

must(await user.auth.signInWithPassword({ email: "demo@agence-os.dev", password: "Demo-agence-2026!" }));
const ws = must(await user.from("workspaces").select("id").eq("slug", "studio-demo").single()).id;
const tag = `[recette] ${Date.now()}`;
const company = must(await user.from("companies").insert({ workspace_id: ws, name: tag, status: "client" }).select("id").single()).id;
const site = must(await user.from("tracking_sites").insert({ workspace_id: ws, company_id: company, name: `${tag} site`, settings: { template: "appel", window_days: 30, model: "last_click" } }).select("id").single()).id;
const account = must(await admin.from("ad_accounts").insert({ workspace_id: ws, company_id: company, platform: "meta", external_id: `recette-${Date.now()}`, name: tag }).select("id").single()).id;

let browser;
try {
  // Dépense : campagne c1 (300, deux publicités), campagne c2 (50, aucune conversion)
  must(await admin.from("ad_metrics_daily").insert([
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c1", campaign_name: "Prospection froide", spend: 300, conversions: 9, conversion_value: 2000 },
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c2", campaign_name: "Retargeting", spend: 50, conversions: 0, conversion_value: 0 },
  ]));
  must(await admin.from("ad_ads").insert([
    { ad_account_id: account, workspace_id: ws, ad_id: "a1", name: "Vidéo A", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s1", adset_name: "Audience large" },
    { ad_account_id: account, workspace_id: ws, ad_id: "a2", name: "Image B", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s1", adset_name: "Audience large" },
  ]));
  must(await admin.from("ad_metrics_ad_daily").insert([
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c1", adset_id: "s1", ad_id: "a1", ad_name: "Vidéo A", spend: 200 },
    { ad_account_id: account, workspace_id: ws, date: dayOf(5), campaign_id: "c1", adset_id: "s1", ad_id: "a2", ad_name: "Image B", spend: 100 },
  ]));

  // Quatre personnes : deux venues par une publicité, une par la recherche, une sans aucune visite
  const key = must(await user.rpc("create_tracking_key", { p_site: site, p_name: "recette" })).key;
  const send = async (body) => (await fetch(`${BASE}/api/t/conversion`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).status;
  const visit = async (anon, touch) => {
    const v = must(await admin.from("visitors").insert({ site_id: site, workspace_id: ws, anon_id: anon, first_seen: iso(6), last_seen: iso(6), device: "mobile", country: "FR" }).select("id").single());
    if (touch) must(await admin.from("touchpoints").insert({ site_id: site, workspace_id: ws, visitor_id: v.id, ts: iso(6), landing_url: "https://exemple.fr/", ...touch }));
  };
  const meta = (ad, content) => ({ channel: "paid_meta", platform: "meta", utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "Prospection froide", utm_content: content, utm_id: "c1", campaign_key: "c1", adset_key: "s1", ad_key: ad });
  await visit("recette_p1_0001", meta("a1", "Vidéo A"));
  await visit("recette_p2_0001", meta("a2", "Image B"));
  await visit("recette_p3_0001", { channel: "organic_search", platform: "google", utm_source: "google", utm_medium: "organic", referrer: "https://www.google.com/" });
  const sent = [
    await send({ anon_id: "recette_p1_0001", email: "p1@exemple.fr", type: "booking", order_id: "b1", ts: iso(4) }),
    await send({ anon_id: "recette_p1_0001", email: "p1@exemple.fr", type: "purchase", value: 1000, order_id: "v1", ts: iso(2) }),
    await send({ anon_id: "recette_p2_0001", email: "p2@exemple.fr", type: "lead", order_id: "l2", ts: iso(4) }),
    await send({ anon_id: "recette_p3_0001", email: "p3@exemple.fr", type: "purchase", value: 400, order_id: "v3", ts: iso(2) }),
    await send({ email: "p4@exemple.fr", type: "purchase", value: 100, order_id: "v4", ts: iso(2) }),
  ];
  check("jeu de données envoyé", sent.every((s) => s === 201), sent);

  browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90000 });
  await p.fill("#email", "demo@agence-os.dev");
  await p.fill("#password", "Demo-agence-2026!");
  await p.click("button[type=submit], .btn-primary");
  await p.waitForURL(/\/w\//, { timeout: 90000 });
  const siteUrl = `${BASE}/w/studio-demo/tracking/${site}`;

  // -------------------------------------------------------------------
  // 1. Tableau des campagnes
  // -------------------------------------------------------------------
  await p.goto(`${siteUrl}?tab=campaigns`, { waitUntil: "networkidle", timeout: 120000 });
  const head = (await p.locator("table.trk-tree thead th").allInnerTexts()).map(norm);
  check("colonnes : une par étape de l'entonnoir", ["Prospects", "Rendez-vous pris", "Rendez-vous honorés", "Prospects qualifiés", "Ventes"].every((h) => head.includes(h)), head);
  const col = (name) => head.indexOf(name);
  const row = async (label) => (await p.locator("table.trk-tree tr", { hasText: label }).first().locator("td").allInnerTexts()).map(norm);
  const c1 = await row("Prospection froide");
  check("campagne : dépense 300 €", /^300(,00)? €$/.test(c1[col("Dépense")]), c1);
  check("campagne : 2 prospects, 1 rendez-vous, 1 vente", c1[col("Prospects")] === "2" && c1[col("Rendez-vous pris")] === "1" && c1[col("Ventes")] === "1", c1);
  check("campagne : 1 000 € attribués, ROAS réel 3,33", /^1 000(,00)? €$/.test(c1[col("CA attribué")]) && /^3,33/.test(c1[col("ROAS réel")]), [c1[col("CA attribué")], c1[col("ROAS réel")]]);
  check("campagne : conversions déclarées par la régie", c1[col("Conv. régie")] === "9", c1[col("Conv. régie")]);
  const c2 = await row("Retargeting");
  check("campagne qui dépense sans rien produire : visible, à zéro", /^50(,00)? €$/.test(c2[col("Dépense")]) && c2[col("Ventes")] === "0" && /^0/.test(c2[col("ROAS réel")]), c2);

  await p.getByRole("button", { name: "Déplier Audience large" }).click().catch(() => {});
  if (!(await p.locator("table.trk-tree tr", { hasText: "Vidéo A" }).count())) {
    await p.getByRole("button", { name: "Déplier Prospection froide" }).click();
    await p.getByRole("button", { name: "Déplier Audience large" }).click();
  }
  const a1 = await row("Vidéo A");
  const a2 = await row("Image B");
  check("publicité A : 200 € dépensés, la vente de 1 000 €", /^200/.test(a1[col("Dépense")]) && a1[col("Ventes")] === "1" && /^1 000/.test(a1[col("CA attribué")]), a1);
  check("publicité B : 100 € dépensés, un prospect, aucune vente", /^100/.test(a2[col("Dépense")]) && a2[col("Prospects")] === "1" && a2[col("Ventes")] === "0", a2);
  const foot = (await p.locator("table.trk-tree tfoot tr").allInnerTexts()).map(norm);
  check("pied : publicité 1 vente, hors publicité 2 ventes (500 €), total 3 ventes (1 500 €)", /1 000/.test(foot[0]) && /500/.test(foot[1]) && /1 500/.test(foot[2]), foot);
  await p.screenshot({ path: ".snaps/tos-7-campagnes.png", fullPage: true });

  // -------------------------------------------------------------------
  // 2. Fiche d'une personne, depuis la ligne de la publicité
  // -------------------------------------------------------------------
  await p.locator("table.trk-tree tr", { hasText: "Vidéo A" }).getByRole("button", { name: /Personnes créditées/ }).click();
  await p.getByRole("menuitem").first().click().catch(async () => p.locator(".pop .mi").first().click());
  await p.locator(".drawer").waitFor({ timeout: 30000 });
  await p.locator(".trk-feed li").first().waitFor({ timeout: 30000 });
  const sheet = norm(await p.locator(".drawer").innerText());
  check("fiche : email, vente et montant", sheet.includes("p1@exemple.fr") && /Ventes 1 vente, 1 000/.test(sheet) && /Dernière activité il y a 2 j/.test(sheet), sheet.slice(0, 300));
  const feed = (await p.locator(".trk-feed li").allInnerTexts()).map(norm);
  check("fiche : le parcours va de la publicité à la vente, le plus récent d'abord", /Ventes/.test(feed[0]) && feed.some((f) => /Rendez-vous pris/.test(f)) && feed.some((f) => /Prospects via API/.test(f)) && /Meta Ads Prospection froide/.test(feed.at(-1)), feed);
  await p.screenshot({ path: ".snaps/tos-8-personne.png" });
  await p.locator(".drawer").getByRole("button", { name: "Fermer" }).click();
  await p.locator(".drawer").waitFor({ state: "detached", timeout: 15000 });
  check("fermer la fiche retire la personne de l'adresse", !p.url().includes("person="), p.url());

  // -------------------------------------------------------------------
  // 3. Couverture dans l'entonnoir
  // -------------------------------------------------------------------
  await p.goto(`${siteUrl}?tab=funnel`, { waitUntil: "networkidle", timeout: 120000 });
  const fh = (await p.locator("table.trk-funnel thead th").allInnerTexts()).map(norm);
  const ventes = (await p.locator("table.trk-funnel tbody tr", { hasText: "Ventes" }).locator("td").allInnerTexts()).map(norm);
  const rdv = (await p.locator("table.trk-funnel tbody tr", { hasText: "Rendez-vous pris" }).locator("td").allInnerTexts()).map(norm);
  check("ventes : 2 sur 3 ont une source (67 %)", ventes[fh.indexOf("Avec une source")] === "67 %", ventes);
  check("rendez-vous : tous ont une source (100 %)", rdv[fh.indexOf("Avec une source")] === "100 %", rdv);
  await p.screenshot({ path: ".snaps/tos-9-couverture.png", fullPage: true });

  // -------------------------------------------------------------------
  // 4. Accès
  // -------------------------------------------------------------------
  const stranger = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
  must(await stranger.auth.signInWithPassword({ email: "client@agence-os.dev", password: "Client-agence-2026!" }));
  const pid = must(await user.rpc("tracking_people", { p_site: site }))[0].person_id;
  check("un membre lit la fiche", !!must(await user.rpc("tracking_person", { p_site: site, p_person: pid })));
  check("un compte hors de l'espace n'obtient rien", (await stranger.rpc("tracking_person", { p_site: site, p_person: pid })).data === null);
} catch (e) {
  ko++;
  console.error("Erreur :", e.message ?? e);
} finally {
  await browser?.close();
  await user.from("tracking_sites").delete().eq("id", site);
  await admin.from("ad_accounts").delete().eq("id", account);
  await user.from("companies").delete().eq("id", company);
  const left = [
    (await admin.from("tracking_sites").select("id").eq("id", site)).data?.length,
    (await admin.from("ad_accounts").select("id").eq("id", account)).data?.length,
    (await admin.from("companies").select("id").eq("id", company)).data?.length,
  ];
  check("client, compte et site de recette supprimés", left.every((n) => n === 0), left);
}
console.log(`\n${ok} vérifications passées, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
