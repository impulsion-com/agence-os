// Recette d'une installation neuve : le parcours d'un élève qui vient de coller supabase/setup.sql.
// Inscription, création d'un espace (profil « Agence complète »), données d'exemple, puis chaque page du menu.
// Vérifie aussi que la démo a rempli chaque module. Crée son compte et son espace, puis supprime tout.
// Usage : node --env-file=.env.local scripts/test-installation.mjs   (serveur de dev sur BASE). Captures dans .snaps/.
// Sur une base dont la confirmation d'email est active, le script confirme le compte par le service role.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE || "http://localhost:3000";
const ACCOUNT = { name: "Recette Installation", email: "installation@agence-os.dev", password: "Installation-2026!" };
const SLUG = "recette-installation";
const ROUTES = ["", "reporting", "tracking", "creatives", "links", "crm", "crm/contacts", "crm/companies", "proposals", "onboarding", "booking", "portal", "projects", "my-tasks", "calendar", "timeline", "settings/integrations", "settings/api", "settings/workspace"];
// Tables que la démo doit remplir, une ou deux par module
const DEMO_TABLES = ["companies", "deals", "contacts", "projects", "tasks", "proposals", "ad_accounts", "ad_metrics_daily", "ad_metrics_ad_daily", "tracking_sites", "tracking_events", "visitors", "links", "link_clicks", "creative_concepts", "competitor_ads", "onboarding_forms", "booking_types", "bookings", "client_portals", "analytics_sources"];

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);

let ok = 0;
let ko = 0;
const check = (label, cond, extra) => {
  if (cond) ok++;
  else ko++;
  console.log(`${cond ? "ok   " : "ÉCHEC"} ${label}${!cond && extra !== undefined ? ` -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
};

async function removeAccount() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = data?.users.find((x) => x.email === ACCOUNT.email);
  await admin.from("workspaces").delete().eq("slug", SLUG);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

await removeAccount();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("response", (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`));

  // 1. Inscription
  await p.goto(`${BASE}/signup`, { waitUntil: "networkidle", timeout: 120000 });
  await p.fill("#name", ACCOUNT.name);
  await p.fill("#email", ACCOUNT.email);
  await p.fill("#password", ACCOUNT.password);
  await p.locator("form .btn-primary").last().click();
  await p.waitForTimeout(3000);
  if (p.url().includes("/signup")) {
    // Confirmation d'email active : on confirme le compte puis on se connecte
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = data?.users.find((x) => x.email === ACCOUNT.email);
    check("compte créé par l'inscription", !!u);
    await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
    await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await p.fill("#email", ACCOUNT.email);
    await p.fill("#password", ACCOUNT.password);
    await p.locator("form .btn-primary").last().click();
  }
  await p.waitForURL(/\/onboarding/, { timeout: 60000 });
  check("inscription puis page de création d'espace", true);

  // 2. Espace et données d'exemple
  await p.fill("#ws-name", "Recette installation");
  await p.fill("#ws-slug", SLUG);
  await p.locator("form .btn-primary").last().click();
  await p.getByText("Agence complète", { exact: true }).click();
  const t0 = Date.now();
  await p.locator("form .btn-primary").last().click();
  await p.waitForURL(new RegExp(`/w/${SLUG}`), { timeout: 180000 });
  check(`espace et données d'exemple créés (${Math.round((Date.now() - t0) / 1000)} s)`, true);

  const { data: ws } = await admin.from("workspaces").select("id").eq("slug", SLUG).single();
  const empty = [];
  for (const t of DEMO_TABLES) {
    const { count } = await admin.from(t).select("*", { count: "exact", head: true }).eq("workspace_id", ws.id);
    if (!count) empty.push(t);
  }
  check("la démo remplit chaque module", !empty.length, empty);

  // 3. Chaque page du menu
  for (const r of ROUTES) {
    const before = errors.length;
    const res = await p.goto(`${BASE}/w/${SLUG}/${r}`, { waitUntil: "networkidle", timeout: 180000 });
    check(`/${r || "(accueil)"} s'affiche sans erreur`, res.status() === 200 && errors.length === before, { status: res.status(), errors: errors.slice(before) });
  }
  await p.goto(`${BASE}/w/${SLUG}`, { waitUntil: "networkidle" });
  await p.screenshot({ path: ".snaps/installation-accueil.png" });
} catch (e) {
  ko++;
  console.error("Erreur :", e.message ?? e);
} finally {
  await browser.close();
  await removeAccount();
  console.log("ok    compte et espace de recette supprimés");
}
console.log(`\n${ok} vérifications passées, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
