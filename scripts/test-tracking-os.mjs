// Parcours du module Tracking dans un Chrome sans fenêtre, sur un site créé puis supprimé :
// gabarit d'entonnoir, clé d'envoi, conversion par l'API, étapes modifiées, révocation.
// Usage : node scripts/test-tracking-os.mjs   (serveur de dev sur BASE, compte de démo). Captures dans .snaps/.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const WS = `${BASE}/w/studio-demo`;
const b = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const ok = (t) => console.log("ok   " + t);
const fail = (t) => {
  throw new Error(t);
};
const send = async (key, body) => {
  const r = await fetch(`${BASE}/api/t/conversion`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const rowOf = async (label) => {
  const tr = p.locator("table.trk-funnel tbody tr", { hasText: label });
  return { people: (await tr.locator("td").nth(1).innerText()).trim(), value: (await tr.locator("td").nth(5).innerText()).trim() };
};

let siteUrl = null;
try {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90000 });
  await p.fill("#email", "demo@agence-os.dev");
  await p.fill("#password", "Demo-agence-2026!");
  await p.click("button[type=submit], .btn-primary");
  await p.waitForURL(/\/w\//, { timeout: 90000 });

  // 1. Création d'un site avec le gabarit « Vente par appel »
  await p.goto(`${WS}/tracking`, { waitUntil: "networkidle", timeout: 120000 });
  await p.getByRole("button", { name: /Nouveau site|Suivre un site|Ajouter un site/ }).first().click();
  await p.fill("#trk-name", "Recette Tracking OS");
  await p.selectOption("#trk-template", "appel");
  await p.screenshot({ path: ".snaps/tos-1-nouveau-site.png" });
  await p.getByRole("button", { name: "Créer le site" }).click();
  await p.waitForURL(/\/tracking\/[0-9a-f-]{36}\?tab=install/, { timeout: 60000 });
  siteUrl = p.url().split("?")[0];
  ok("site créé");

  await p.goto(`${siteUrl}?tab=funnel`, { waitUntil: "networkidle", timeout: 120000 });
  const labels = await p.locator("table.trk-funnel tbody tr td:first-child span").allInnerTexts();
  if (labels.join("|") !== "Prospects|Rendez-vous pris|Rendez-vous honorés|Prospects qualifiés|Ventes") fail("gabarit appel : " + labels.join("|"));
  ok("gabarit « Vente par appel » : 5 étapes dans l'ordre");

  // 2. Clé d'envoi
  await p.goto(`${siteUrl}?tab=api`, { waitUntil: "networkidle", timeout: 120000 });
  await p.fill('input[aria-label="Nom de la nouvelle clé"]', "Recette");
  await p.getByRole("button", { name: "Créer une clé" }).click();
  const input = p.locator('input[aria-label="Nouvelle clé d\'envoi"]');
  await input.waitFor({ timeout: 30000 });
  const key = await input.inputValue();
  if (!/^sk_[0-9a-f]{48}$/.test(key)) fail("format de clé inattendu");
  await p.screenshot({ path: ".snaps/tos-2-cle.png" });
  ok("clé créée, affichée une fois");

  // 3. Conversions par l'API
  const who = { email: "recette@tracking-os.dev" };
  const r1 = await send(key, { ...who, type: "booking", order_id: "rdv-1" });
  const r2 = await send(key, { ...who, type: "booking", order_id: "rdv-1" });
  const r3 = await send(key, { ...who, type: "purchase", value: 1200, currency: "EUR", order_id: "cmd-1" });
  const r4 = await send(key, { ...who, type: "webinaire", order_id: "w-1" });
  const bad = await send("sk_" + "0".repeat(48), { ...who, type: "purchase" });
  if (r1.status !== 201 || r2.status !== 200 || !r2.body.duplicate || r3.status !== 201 || r4.status !== 201) fail("API : " + JSON.stringify([r1, r2, r3, r4]));
  if (bad.status !== 401) fail("une clé inconnue doit être refusée : " + bad.status);
  ok("API : 201 créée, 200 doublon, 401 clé inconnue");

  // 4. L'entonnoir compte ces conversions
  await p.goto(`${siteUrl}?tab=funnel`, { waitUntil: "networkidle", timeout: 120000 });
  const lead = await rowOf("Prospects");
  const rdv = await rowOf("Rendez-vous pris");
  const vente = await rowOf("Ventes");
  if (lead.people !== "1" || rdv.people !== "1" || vente.people !== "1" || !/1\s?200/.test(vente.value)) fail("entonnoir : " + JSON.stringify({ lead, rdv, vente }));
  if (!(await p.locator(".trk-other li", { hasText: "webinaire" }).count())) fail("« webinaire » devrait être listé hors entonnoir");
  await p.screenshot({ path: ".snaps/tos-3-entonnoir.png", fullPage: true });
  ok("entonnoir : prospect automatique, rendez-vous, vente à 1 200 €, « webinaire » hors entonnoir");

  // 5. Ajout d'une étape pour cet évènement
  await p.getByRole("button", { name: "Modifier les étapes" }).click();
  await p.getByRole("button", { name: "Ajouter une étape" }).click();
  await p.locator(".trk-stage").last().locator("input").first().fill("Webinaire");
  await p.screenshot({ path: ".snaps/tos-4-etapes.png" });
  await p.getByRole("button", { name: "Enregistrer" }).click();
  await p.locator("table.trk-funnel tbody tr", { hasText: "Webinaire" }).waitFor({ timeout: 30000 });
  if ((await rowOf("Webinaire")).people !== "1") fail("la nouvelle étape devrait compter 1 personne");
  if (await p.locator(".trk-other li").count()) fail("plus aucun évènement hors entonnoir attendu");
  ok("étape ajoutée : l'évènement déjà reçu s'y range");

  // 6. Révocation
  await p.goto(`${siteUrl}?tab=api`, { waitUntil: "networkidle", timeout: 120000 });
  if (await p.locator('input[aria-label="Nouvelle clé d\'envoi"]').count()) fail("la clé ne doit plus être affichée après rechargement");
  await p.getByRole("button", { name: "Révoquer" }).click();
  await p.locator(".modal").getByRole("button", { name: "Révoquer" }).click();
  await p.getByText(/Révoquée/).first().waitFor({ timeout: 30000 });
  const after = await send(key, { ...who, type: "purchase", order_id: "cmd-2" });
  if (after.status !== 401) fail("une clé révoquée doit être refusée : " + after.status);
  ok("clé révoquée : refusée immédiatement, et jamais réaffichée");
} finally {
  // Rend la base propre : supprimer le site supprime ses étapes, ses clés et ses conversions
  if (siteUrl) {
    await p.goto(siteUrl, { waitUntil: "networkidle", timeout: 120000 });
    await p.getByRole("button", { name: /Réglages/ }).click();
    await p.locator(".modal").getByRole("button", { name: "Supprimer" }).click();
    await p.getByRole("button", { name: "Supprimer le site" }).click();
    await p.waitForURL(/\/tracking$/, { timeout: 60000 });
    ok("site de recette supprimé");
  }
  console.log(errors.length ? "ERREURS :\n" + [...new Set(errors)].slice(0, 10).join("\n") : "aucune erreur de page");
  await b.close();
}
