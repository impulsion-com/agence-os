// Recette de l'étape 3 du tracking : webhook générique et import CSV, sur un site créé puis supprimé.
// Usage : node --env-file=.env.local scripts/test-tracking-sources.mjs   (serveur de dev sur BASE). Captures dans .snaps/.
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
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

must(await user.auth.signInWithPassword({ email: "demo@agence-os.dev", password: "Demo-agence-2026!" }));
const ws = must(await user.from("workspaces").select("id").eq("slug", "studio-demo").single());
const site = must(await user.from("tracking_sites").insert({ workspace_id: ws.id, name: "[recette] sources", settings: { template: "appel" } }).select("id").single());
const key = must(await user.rpc("create_tracking_key", { p_site: site.id, p_name: "recette" })).key;
const day = "2026-09-12";
const funnel = async () => {
  const stages = must(await user.from("tracking_stages").select("id, key").eq("site_id", site.id));
  const rows = must(await user.rpc("tracking_funnel", { p_site: site.id, p_start: "2026-09-01", p_end: new Date().toISOString().slice(0, 10) }));
  return Object.fromEntries(stages.map((s) => [s.key, rows.find((r) => r.stage_id === s.id) ?? { people: 0, value: 0 }]));
};
const hook = async (query, body, headers = { "Content-Type": "application/json" }) => {
  const r = await fetch(`${BASE}/api/t/webhooks/in?${query}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

let browser;
try {
  // -------------------------------------------------------------------
  // 1. Webhook générique
  // -------------------------------------------------------------------
  const calcom = { triggerEvent: "BOOKING_CREATED", createdAt: `${day}T08:00:00Z`, payload: { uid: "bk_1", organizer: { email: "agence@exemple.fr" }, attendees: [{ email: "claire@exemple.fr", name: "Claire Martin" }] } };
  const paths = "email=payload.attendees.0.email&name=payload.attendees.0.name&id=payload.uid&date=createdAt";
  const r1 = await hook(`key=${key}&type=booking&${paths}`, calcom);
  const r2 = await hook(`key=${key}&type=booking&${paths}`, calcom);
  check("webhook d'agenda : rendez-vous enregistré", r1.status === 200 && r1.body.ok && r1.body.duplicate === false, r1);
  check("le même envoi une seconde fois est ignoré", r2.body.duplicate === true, r2);
  const who = must(await user.rpc("tracking_people", { p_site: site.id }));
  check("la personne est le participant, pas l'organisateur", who.length === 1 && who[0].email === "claire@exemple.fr" && who[0].name === "Claire Martin", who.map((p) => p.email));

  const deal = { event: "deal.won", data: { id: 981, amount: "4 500,00", currency: "eur", person: { Email: "Claire@Exemple.fr", phone: "06 12 34 56 78" } } };
  const r3 = await hook(`key=${key}&type=purchase`, deal);
  check("webhook d'un CRM sans chemin : champs trouvés par leur nom", r3.status === 200 && r3.body.ok && r3.body.duplicate === false, r3);
  const r4 = await hook("type=show", "phone=%2B33612345678&id=rdv-9", { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${key}` });
  check("formulaire encodé, clé dans l'en-tête, téléphone seul", r4.status === 200 && r4.body.ok && r4.body.duplicate === false, r4);
  let f = await funnel();
  check("entonnoir : une seule personne sur les trois étapes, vente à 4 500", f.booking.people === 1 && f.show.people === 1 && f.purchase.people === 1 && Number(f.purchase.value) === 4500, f);
  check("une personne en tout (email et téléphone reliés)", must(await user.rpc("tracking_people", { p_site: site.id })).length === 1);

  const r5 = await hook(`key=${key}&type=lead`, { event: "ping" });
  check("données sans email ni téléphone : 200 et rien d'écrit", r5.status === 200 && !!r5.body.ignored, r5);
  check("clé inconnue : 401", (await hook(`key=sk_${"0".repeat(48)}&type=lead`, calcom)).status === 401);
  check("type manquant : 400", (await hook(`key=${key}`, calcom)).status === 400);

  // -------------------------------------------------------------------
  // 2. Import CSV
  // -------------------------------------------------------------------
  const noSession = await fetch(`${BASE}/api/tracking/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_id: site.id, rows: [{ email: "x@y.fr", type: "lead" }] }) });
  check("import sans session : refusé", noSession.status === 401, noSession.status);

  const dir = join(tmpdir(), "agence-os-recette");
  mkdirSync(dir, { recursive: true });
  const csv = join(dir, "ventes.csv");
  writeFileSync(
    csv,
    "Email;Téléphone;Type;Montant;Date;Référence\n" +
      "claire@exemple.fr;;purchase;1 490,50 €;14/09/2026;FAC-1\n" +
      "david@exemple.fr;07 11 22 33 44;purchase;900;15/09/2026;FAC-2\n" +
      ";07 11 22 33 44;show;;13/09/2026;\n" +
      "pas-un-email;;purchase;10;15/09/2026;FAC-3\n" +
      "erin@exemple.fr;;atelier;;15/09/2026;\n",
  );

  browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90000 });
  await p.fill("#email", "demo@agence-os.dev");
  await p.fill("#password", "Demo-agence-2026!");
  await p.click("button[type=submit], .btn-primary");
  await p.waitForURL(/\/w\//, { timeout: 90000 });
  await p.goto(`${BASE}/w/studio-demo/tracking/${site.id}?tab=api`, { waitUntil: "networkidle", timeout: 120000 });

  const url = await p.locator(".trk-code", { hasText: "/api/t/webhooks/in" }).locator("code").innerText();
  check("l'onglet Sources propose l'adresse Cal.com sur l'étape « Rendez-vous pris »", url.includes("type=booking") && url.includes("email=payload.attendees.0.email") && url.includes("key=sk_VOTRE_CLE"), url);
  await p.screenshot({ path: ".snaps/tos-5-sources.png", fullPage: true });

  await p.getByRole("button", { name: "Importer un fichier CSV" }).click();
  await p.setInputFiles('.modal input[type="file"]', csv);
  await p.getByText("4 lignes prêtes").waitFor({ timeout: 15000 });
  const modal = await p.locator(".modal").innerText();
  check("aperçu : 4 lignes prêtes, la ligne illisible est signalée", /Ligne 5 : email illisible/.test(modal), modal.slice(0, 400));
  check("aperçu : le type sans étape est annoncé", /atelier.*aucune étape ne porte ce nom/s.test(modal));
  await p.screenshot({ path: ".snaps/tos-6-import.png" });
  await p.getByRole("button", { name: "Importer 4 lignes" }).click();
  await p.getByText("Import terminé").waitFor({ timeout: 60000 });
  check("rapport : 4 conversions ajoutées", /4 conversions ajoutées/.test(await p.locator(".modal").innerText()), await p.locator(".modal").innerText());
  await p.locator(".modal-f").getByRole("button", { name: "Fermer" }).click();

  f = await funnel();
  check("entonnoir après import : 2 acheteurs, 6 890,50 de ventes", f.purchase.people === 2 && Number(f.purchase.value) === 6890.5, f.purchase);
  check("le rendez-vous honoré par téléphone revient à David", f.show.people === 2, f.show);
  const people = must(await user.rpc("tracking_people", { p_site: site.id }));
  check("trois personnes : Claire, David, Erin", people.length === 3, people.map((x) => x.email));
  const ev = must(await user.from("tracking_events").select("ts, source").eq("site_id", site.id).eq("order_id", "FAC-1").single());
  check("la date du fichier est respectée, la source est « import »", ev.ts.startsWith("2026-09-14") && ev.source === "import", ev);

  await p.getByRole("button", { name: "Importer un fichier CSV" }).click();
  await p.setInputFiles('.modal input[type="file"]', csv);
  await p.getByRole("button", { name: "Importer 4 lignes" }).click();
  await p.getByText("Import terminé").waitFor({ timeout: 60000 });
  check("réimporter le même fichier ne double rien", /0 conversion ajoutée, 4 déjà présentes ignorées/.test(await p.locator(".modal").innerText()), await p.locator(".modal").innerText());
  check("entonnoir inchangé", Number((await funnel()).purchase.value) === 6890.5);
} catch (e) {
  ko++;
  console.error("Erreur :", e.message ?? e);
} finally {
  await browser?.close();
  await user.from("tracking_sites").delete().eq("id", site.id);
  check("site de recette supprimé", ((await user.from("tracking_sites").select("id").eq("id", site.id)).data ?? []).length === 0);
}
console.log(`\n${ok} vérifications passées, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
