// Recette de l'étape 2 du tracking : identité par email et téléphone, signaux pour les régies.
// Crée deux sites de recette dans l'espace de démo, puis les supprime.
// Usage : node --env-file=.env.local scripts/test-tracking-identity.mjs   (serveur de dev sur BASE)
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

must(await user.auth.signInWithPassword({ email: "demo@agence-os.dev", password: "Demo-agence-2026!" }));
const ws = must(await user.from("workspaces").select("id").eq("slug", "studio-demo").single());
const mkSite = async (name, consent) =>
  must(await user.from("tracking_sites").insert({ workspace_id: ws.id, name, settings: { consent, template: "appel" } }).select("id, public_key").single());
const sites = [];
const today = new Date().toISOString().slice(0, 10);

try {
  // -------------------------------------------------------------------
  // 1. Identité, par l'API serveur
  // -------------------------------------------------------------------
  const site = await mkSite("[recette] identité", "none");
  sites.push(site.id);
  const key = must(await user.rpc("create_tracking_key", { p_site: site.id, p_name: "recette" })).key;
  const send = async (body) => {
    const r = await fetch(`${BASE}/api/t/conversion`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const people = async () => must(await user.rpc("tracking_people", { p_site: site.id }));
  const funnel = async () => {
    const stages = must(await user.from("tracking_stages").select("id, key").eq("site_id", site.id));
    const rows = must(await user.rpc("tracking_funnel", { p_site: site.id, p_start: today, p_end: today }));
    return Object.fromEntries(stages.map((s) => [s.key, rows.find((r) => r.stage_id === s.id)?.people ?? 0]));
  };

  check("conversion avec email et téléphone", (await send({ email: "Alice@Exemple.fr", phone: "06 12 34 56 78", type: "booking", order_id: "r1" })).status === 201);
  check("autre email, même téléphone écrit autrement", (await send({ email: "alice.pro@exemple.fr", phone: "+33 6 12 34 56 78", type: "show", order_id: "r2" })).status === 201);
  check("téléphone seul, sans email", (await send({ phone: "0612345678", type: "purchase", value: 900, order_id: "v1" })).status === 201);
  let p = await people();
  check("une seule personne pour les trois envois", p.length === 1, p.map((x) => [x.email, x.phone, x.visitors]));
  check("ses deux emails sont conservés (deux visiteurs reliés)", p[0]?.visitors === 2, p[0]);
  check("la vente envoyée par téléphone seul lui revient", p[0]?.purchases === 1 && Number(p[0]?.revenue) === 900, p[0]);
  let f = await funnel();
  check("entonnoir : 1 prospect, 1 rendez-vous pris, 1 honoré, 1 vente", f.lead === 1 && f.booking === 1 && f.show === 1 && f.purchase === 1, f);
  const leads = must(await admin.from("tracking_events").select("id").eq("site_id", site.id).eq("type", "lead"));
  check("un seul prospect automatique, pas un par email", leads.length === 1, leads.length);

  check("une autre personne reste distincte", (await send({ email: "bob@exemple.fr", phone: "07 98 76 54 32", type: "booking", order_id: "r3" })).status === 201 && (await people()).length === 2);
  check("téléphone seul d'une personne inconnue : elle est créée", (await send({ phone: "+32 475 12 34 56", type: "lead", order_id: "l1" })).status === 201 && (await people()).length === 3);
  check("deux personnes fusionnent quand un envoi porte l'email de l'une et le téléphone de l'autre", (await send({ email: "bob@exemple.fr", phone: "+32475123456", type: "show", order_id: "r4" })).status === 201 && (await people()).length === 2);
  check("téléphone inexploitable sans email : 400", (await send({ phone: "12", type: "lead" })).status === 400);
  check("ni email, ni téléphone, ni anon_id : 400", (await send({ type: "lead" })).status === 400);

  const conv = must(await user.rpc("tracking_conversions", { p_site: site.id, p_start: today, p_end: today, p_window: 30, p_types: ["booking", "show", "purchase"] }));
  const alice = conv.filter((c) => (c.email ?? "").startsWith("alice"));
  check("les conversions d'Alice portent la même personne", alice.length === 3 && new Set(alice.map((c) => c.person)).size === 1, conv.map((c) => [c.type, c.person, c.email]));

  p = await people();
  const a = p.find((x) => (x.email ?? "").startsWith("alice"));
  must(await user.from("visitors").delete().eq("site_id", site.id).eq("person_id", a.person_id));
  check("supprimer une personne efface tous ses visiteurs", (await people()).length === 1);

  // -------------------------------------------------------------------
  // 2. Signaux pour les régies, par le vrai script dans un navigateur
  // -------------------------------------------------------------------
  // La page de test (servie par interception) appelle le serveur de dev sur localhost : Chrome le refuse
  // sans cette option, qui ne concerne que ce banc.
  const b = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"],
  });
  const visit = async (s) => {
    const ctx = await b.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "x-forwarded-for": "203.0.113.7" },
    });
    await ctx.addCookies([
      { name: "_fbp", value: "fb.1.1759900000000.123456789", domain: "localhost", path: "/" },
      { name: "_ga", value: "GA1.1.111222333.1759900000", domain: "localhost", path: "/" },
    ]);
    const page = await ctx.newPage();
    await page.route("http://localhost:4999/**", (r) =>
      r.fulfill({ contentType: "text/html", body: `<html><head><script async src="${BASE}/t.js" data-key="${s.public_key}"></script></head><body>Boutique</body></html>` }),
    );
    await page.goto("http://localhost:4999/produit?fbclid=IwAR0recette&utm_source=facebook&utm_medium=paid_social", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const before = must(await admin.from("visitors").select("id").eq("site_id", s.id)).length;
    await page.evaluate(() => window.aos("consent", true));
    await page.waitForTimeout(2500);
    const id = await page.evaluate(() => window.aos.id);
    await ctx.close();
    return { before, id };
  };

  const strict = await mkSite("[recette] consentement requis", "required");
  sites.push(strict.id);
  const v1 = await visit(strict);
  check("rien n'est envoyé avant le consentement", v1.before === 0, v1.before);
  await sleep(1500);
  const vis = must(await admin.from("visitors").select("id, anon_id").eq("site_id", strict.id));
  check("après consentement, le visiteur est créé", vis.length === 1 && vis[0].anon_id === v1.id, vis);
  const sig = must(await admin.from("visitor_signals").select("*").eq("site_id", strict.id));
  const s0 = sig[0] ?? {};
  check("_fbp et _ga sont captés", s0.fbp === "fb.1.1759900000000.123456789" && s0.ga_cid === "GA1.1.111222333.1759900000", s0);
  check("_fbc est construit depuis le fbclid de l'URL", /^fb\.1\.\d{13}\.IwAR0recette$/.test(s0.fbc ?? ""), s0.fbc);
  check("l'adresse IP et le navigateur de la visite sont conservés", s0.ip === "203.0.113.7" && /Chrome\/140/.test(s0.ua ?? ""), [s0.ip, s0.ua]);
  check("un membre connecté ne peut pas lire les signaux", ((await user.from("visitor_signals").select("visitor_id").eq("site_id", strict.id)).data ?? []).length === 0);

  must(await admin.from("visitor_signals").update({ seen_at: new Date(Date.now() - 31 * 864e5).toISOString() }).eq("site_id", strict.id));
  const purged = must(await admin.rpc("tracking_purge_signals"));
  const after = must(await admin.from("visitor_signals").select("ip, fbp").eq("site_id", strict.id))[0];
  check("après 30 jours l'IP est effacée, les cookies restent", purged >= 1 && after.ip === null && !!after.fbp, { purged, after });

  const v2 = await visit(site);
  await sleep(1500);
  const loose = must(await admin.from("visitor_signals").select("visitor_id").eq("site_id", site.id));
  check("site en suivi immédiat : aucun signal publicitaire conservé", !!v2.id && loose.length === 0, loose.length);
  await b.close();
} catch (e) {
  ko++;
  console.error("Erreur :", e.message ?? e);
} finally {
  for (const id of sites) await user.from("tracking_sites").delete().eq("id", id);
  const left = (await user.from("tracking_sites").select("id").like("name", "[recette]%")).data ?? [];
  check("sites de recette supprimés", left.length === 0, left.length);
}
console.log(`\n${ok} vérifications passées, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
