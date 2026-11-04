// Recette des Docs & process (migration 0122) : parcours réel dans le navigateur, serveur de dev lancé.
// Usage : node --env-file=.env.local scripts/test-docs.mjs [dossier des captures]
// Compte demo@agence-os.dev et espace studio-demo avec la démo chargée (voir CLAUDE.md).
// Vérifie : accueil et arbre, enregistrement automatique, refus d'écraser (AO409), sous-page,
// historique, corbeille et restauration, recherche ⌘K, import d'un export Notion (.zip).
// Tout ce que la recette crée est supprimé à la fin.
import { createClient } from "@supabase/supabase-js";
import { strToU8, zipSync } from "fflate";
import { chromium } from "playwright";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const SHOTS = process.argv[2] || null;
const SLUG = "studio-demo";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: ws } = await admin.from("workspaces").select("id").eq("slug", SLUG).single();
const MARK = `Recette docs ${Date.now().toString(36)}`;

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
};
const shot = (p, name) => (SHOTS ? p.screenshot({ path: `${SHOTS}/docs-${name}.png`, fullPage: false }) : null);

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));

try {
  await p.goto(`${BASE}/login?next=/w/${SLUG}/docs`, { waitUntil: "networkidle" });
  await p.fill("#email", "demo@agence-os.dev");
  await p.fill("#password", "Demo-agence-2026!");
  await p.locator("form .btn-primary").last().click();
  await p.waitForURL(`**/w/${SLUG}/docs`, { timeout: 20000 });
  await p.waitForSelector(".docs-tree");

  // Accueil
  ok(await p.locator(".docs-space-card", { hasText: "Process" }).count() === 1, "accueil : espace Process");
  ok(await p.locator(".docs-tree", { hasText: "Lancement d'une campagne Meta" }).count() === 1, "arbre : pages de démo");
  ok(await p.locator(".side-sec", { hasText: "Production" }).filter({ hasText: "Docs & process" }).count() === 1, "barre latérale : Docs & process dans la section Production");
  await shot(p, "1-accueil");

  // Page de démo, lien interne vers la sous-page
  await p.locator(".docs-tree a", { hasText: "Onboarding d'un nouveau client" }).click();
  await p.waitForSelector(".docs-editable");
  ok(await p.locator(".docs-editable", { hasText: "Semaine 1" }).count() === 1, "page : contenu de démo affiché");
  ok(await p.locator(".docs-editable ul[data-type=taskList]").count() >= 1, "page : cases à cocher");
  await shot(p, "2-page");

  // Nouvelle page depuis l'accueil, titre et contenu enregistrés automatiquement
  await p.goto(`${BASE}/w/${SLUG}/docs`, { waitUntil: "networkidle" });
  await p.locator(".docs-space-card", { hasText: "Process" }).getByRole("button", { name: "Nouvelle page" }).click();
  await p.waitForURL(/\/docs\/[0-9a-f-]{36}$/);
  const pageId = p.url().split("/").pop();
  await p.waitForSelector(".docs-editable");
  await p.fill(".docs-title", MARK);
  await p.click(".docs-editable");
  await p.keyboard.type("## Étapes\n[] Vérifier le pixel\nPremier jet du process.");
  await p.waitForSelector(".docs-status:has-text('Enregistré')", { timeout: 8000 });
  await p.waitForTimeout(400);
  const { data: saved } = await admin.from("doc_pages").select("title, plain, content").eq("id", pageId).single();
  ok(saved?.title === MARK, "enregistrement : titre");
  ok(saved?.plain.includes("Vérifier le pixel") && saved.content.includes('data-type="taskList"'), "enregistrement : contenu, texte brut et case à cocher (raccourci [])");
  ok(await p.locator(".docs-tree", { hasText: MARK }).count() === 1, "arbre : titre retouché pendant la frappe");
  const { count: v1 } = await admin.from("doc_versions").select("id", { count: "exact", head: true }).eq("page_id", pageId);
  ok(v1 === 1, `historique : une seule version pour la séance (${v1})`);
  await shot(p, "3-nouvelle-page");

  // Quelqu'un d'autre enregistre entre-temps : la base refuse d'écraser
  await admin.from("doc_versions").insert({ workspace_id: ws.id, page_id: pageId, title: MARK, content: "<p>Version d'un collègue</p>", author_id: null });
  await p.click(".docs-editable");
  await p.keyboard.press("End");
  await p.keyboard.type(" Suite.");
  await p.waitForSelector(".docs-banner.warn", { timeout: 8000 });
  ok(await p.locator(".docs-banner.warn", { hasText: "a modifié cette page entre-temps" }).count() === 1, "conflit : écriture refusée, bandeau affiché");
  await shot(p, "4-conflit");
  await p.getByRole("button", { name: /Recharger/ }).click();
  await p.waitForSelector(".docs-banner.warn", { state: "detached" });
  ok(true, "conflit : rechargement");

  // Historique
  await p.getByRole("button", { name: "Historique des versions" }).first().click();
  await p.waitForSelector(".docs-history-item");
  ok(await p.locator(".docs-history-item").count() >= 2, "historique : versions listées");
  await p.locator(".docs-history-item").last().click();
  await p.waitForSelector(".docs-history-preview .docs-prose");
  await shot(p, "5-historique");
  await p.keyboard.press("Escape");

  // Sous-page par l'API (glisser-déposer vérifié par doc_move_page)
  const { data: child } = await admin.from("doc_pages").insert({ workspace_id: ws.id, space_id: (await admin.from("doc_pages").select("space_id").eq("id", pageId).single()).data.space_id, title: `${MARK} enfant`, position: 99 }).select("id").single();
  await p.reload({ waitUntil: "networkidle" });
  const row = p.locator(".docs-tree .docs-row", { hasText: `${MARK} enfant` });
  const target = p.locator(".docs-tree .docs-row", { hasText: MARK }).first();
  await row.dragTo(target);
  await p.waitForTimeout(1500);
  const { data: moved } = await admin.from("doc_pages").select("parent_id").eq("id", child.id).single();
  ok(moved?.parent_id === pageId, "glisser-déposer : devient une sous-page");

  // Corbeille : la page part avec sa sous-page, revient avec elle
  await p.goto(`${BASE}/w/${SLUG}/docs/${pageId}`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Actions de la page" }).last().click();
  await p.getByRole("menuitem", { name: "Mettre à la corbeille" }).or(p.locator(".mi", { hasText: "Mettre à la corbeille" })).first().click();
  await p.waitForURL(`**/w/${SLUG}/docs`);
  const { data: trashed } = await admin.from("doc_pages").select("deleted_at").in("id", [pageId, child.id]);
  ok(trashed.every((r) => r.deleted_at), "corbeille : page et sous-page");
  await p.goto(`${BASE}/w/${SLUG}/docs/trash`, { waitUntil: "networkidle" });
  ok(await p.locator(".docs-recent-row", { hasText: `${MARK} enfant` }).count() === 0 && (await p.locator(".docs-recent-row", { hasText: MARK }).count()) === 1, "corbeille : seule la page supprimée apparaît");
  await shot(p, "6-corbeille");
  await p.locator(".docs-recent-row", { hasText: MARK }).getByRole("button", { name: "Restaurer" }).click();
  await p.waitForTimeout(1500);
  const { data: back } = await admin.from("doc_pages").select("deleted_at").in("id", [pageId, child.id]);
  ok(back.every((r) => !r.deleted_at), "corbeille : restauration avec la sous-page");

  // Palette ⌘K
  await p.keyboard.press("Meta+k");
  await p.keyboard.type("Nomenclature");
  await p.waitForSelector(".palette :text('Nomenclature des campagnes')", { timeout: 6000 });
  ok(true, "palette : recherche dans les docs");
  await p.keyboard.press("Escape");

  // Import Notion : page, sous-page, image, lien entre pages, case à cocher
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
  const root = `${MARK} notion 0123456789abcdef0123456789abcdef`;
  const sub = `Sous page fedcba9876543210fedcba9876543210`;
  const zip = zipSync({
    [`${root}.md`]: strToU8(`# ${MARK} notion\n\nVoir [la sous-page](${encodeURIComponent(root)}/${encodeURIComponent(sub)}.md).\n\n- [x] Fait\n- [ ] À faire\n\n![capture](${encodeURIComponent(root)}/capture.png)\n`),
    [`${root}/${sub}.md`]: strToU8("# Sous page\n\nTexte de la sous-page.\n"),
    [`${root}/capture.png`]: png,
  });
  await p.goto(`${BASE}/w/${SLUG}/docs`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Importer depuis Notion" }).first().click();
  await p.setInputFiles(".docs-drop input[type=file]", { name: "Export.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await shot(p, "7-import");
  await p.locator(".modal").getByRole("button", { name: "Importer" }).click();
  await p.waitForSelector(".modal :text('pages importées')", { timeout: 20000 });
  ok(await p.locator(".modal", { hasText: "2 pages importées, 1 image" }).count() === 1, "import : 2 pages et 1 image");
  await p.getByRole("button", { name: "Ouvrir la page importée" }).click();
  await p.waitForSelector(".docs-editable img");
  const href = await p.locator(".docs-editable a", { hasText: "la sous-page" }).getAttribute("href");
  ok(/\/docs\/[0-9a-f-]{36}$/.test(href ?? ""), "import : lien vers la sous-page réécrit");
  const loaded = await p.locator(".docs-editable img").evaluate((img) => new Promise((r) => (img.complete ? r(img.naturalWidth) : (img.onload = () => r(img.naturalWidth)))));
  ok(loaded === 1, "import : image servie par /api/docs/file");
  ok(await p.locator(".docs-editable li[data-checked=true]").count() === 1, "import : cases à cocher");
  await shot(p, "8-page-importee");
  // Réimport : aucun doublon
  await p.goto(`${BASE}/w/${SLUG}/docs`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Importer depuis Notion" }).first().click();
  await p.setInputFiles(".docs-drop input[type=file]", { name: "Export.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await p.locator(".modal").getByRole("button", { name: "Importer" }).click();
  await p.waitForSelector(".modal :text('importée')", { timeout: 20000 });
  ok(await p.locator(".modal", { hasText: "2 déjà présentes" }).count() === 1, "import : relancé sans doublon");

  // Vue mobile
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/w/${SLUG}/docs/${pageId}`, { waitUntil: "networkidle" });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile : pas de défilement horizontal");
  await shot(p, "9-mobile");

  ok(!errors.length, `aucune erreur JavaScript${errors.length ? " : " + errors.join(" | ") : ""}`);
} catch (e) {
  failed++;
  console.error("✗ interrompu :", e.message);
  await shot(p, "erreur");
} finally {
  // Ménage : tout ce qui porte la marque de la recette
  const { data: mine } = await admin
    .from("doc_pages")
    .select("id, content")
    .eq("workspace_id", ws.id)
    .or(`title.ilike.${MARK}%,notion_id.in.(0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210)`);
  const ids = (mine ?? []).map((r) => r.id);
  if (ids.length) {
    await admin.from("doc_pages").update({ deleted_at: new Date().toISOString() }).in("id", ids);
    await admin.from("doc_pages").delete().in("id", ids);
  }
  const files = (mine ?? []).flatMap((r) => [...r.content.matchAll(/p=([^"&]+)/g)].map((m) => decodeURIComponent(m[1])));
  if (files.length) await admin.storage.from("attachments").remove(files);
  await browser.close();
}
console.log(failed ? `\n${failed} échec(s)` : "\nTout passe.");
process.exit(failed ? 1 : 0);
