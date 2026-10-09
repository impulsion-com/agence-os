// Tests du moteur d'attribution et de la classification des canaux.
// Lancer : node --experimental-strip-types --test src/lib/tracking/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { attributeBy, attributeTree, credits, inWindow, linkCampaigns, DIMENSIONS } from "../attribution.ts";
import { classify, hostMatches } from "../channels.ts";
import { buildCampaignTable, ratio } from "../campaigns.ts";
import { aplatir, catalogue, cleCompte, creditesDe, entreeSansActivite, lirePeriode, mesures } from "../ext-contract.ts";
import { buildFunnel, stageKey } from "../funnel.ts";
import { normalizePhone } from "../phone.ts";
import { atPath, parseConversionsCsv, readWebhook, webhookUrl } from "../sources.ts";

const day = (n) => new Date(Date.UTC(2026, 8, 1 + n, 12)).toISOString();
const conv = (touches, value = 100, at = 30) => ({ id: "c", ts: day(at), type: "purchase", value, person: "p", touches });
const T = (at, channel, extra = {}) => ({ ts: day(at), channel, ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const sum = (cs) => cs.reduce((s, c) => s + c.weight, 0);

const journey = conv([T(10, "paid_meta"), T(20, "email"), T(28, "organic_search"), T(29, "direct")]);

test("dernier clic et premier clic", () => {
  assert.equal(credits(journey, "last_click", 30)[0].touch.channel, "direct");
  assert.equal(credits(journey, "first_click", 30)[0].touch.channel, "paid_meta");
});

test("dernier clic non direct ignore les visites directes", () => {
  assert.equal(credits(journey, "last_non_direct", 30)[0].touch.channel, "organic_search");
  const allDirect = conv([T(20, "direct"), T(25, "direct")]);
  assert.equal(credits(allDirect, "last_non_direct", 30)[0].touch.ts, day(25));
});

test("linéaire : parts égales", () => {
  const c = credits(journey, "linear", 30);
  assert.equal(c.length, 4);
  c.forEach((x) => near(x.weight, 0.25));
});

test("décroissance temporelle : demi-vie de 7 jours", () => {
  const c = credits(conv([T(16, "paid_meta"), T(23, "email"), T(30, "direct")]), "time_decay", 30);
  near(sum(c), 1);
  // poids relatifs 1/4, 1/2, 1 → 1/7, 2/7, 4/7
  near(c[0].weight, 1 / 7);
  near(c[1].weight, 2 / 7);
  near(c[2].weight, 4 / 7);
});

test("en U : 40/20/40", () => {
  const c = credits(journey, "position", 30);
  near(c[0].weight, 0.4);
  near(c[1].weight, 0.1);
  near(c[2].weight, 0.1);
  near(c[3].weight, 0.4);
  const two = credits(conv([T(20, "paid_meta"), T(25, "email")]), "position", 30);
  near(two[0].weight, 0.5);
  const one = credits(conv([T(20, "paid_meta")]), "position", 30);
  near(one[0].weight, 1);
});

test("fenêtre d'attribution", () => {
  assert.equal(inWindow(journey, 7).length, 2); // j28 et j29 (j20 est à 10 jours)
  assert.equal(inWindow(journey, 30).length, 4);
  const future = conv([T(31, "paid_meta")]);
  assert.equal(credits(future, "last_click", 30)[0].touch, null); // après la conversion : ignoré
  assert.equal(credits(conv([]), "linear", 30)[0].touch, null);
});

test("agrégation par canal : conversions et valeur conservées", () => {
  const convs = [journey, conv([T(29, "paid_meta")], 50)];
  for (const m of ["first_click", "last_click", "last_non_direct", "linear", "time_decay", "position"]) {
    const agg = attributeBy(convs, m, 30, DIMENSIONS.channel);
    const tot = [...agg.values()].reduce((s, a) => ({ c: s.c + a.conversions, v: s.v + a.value }), { c: 0, v: 0 });
    near(tot.c, 2);
    near(tot.v, 150);
  }
  const lin = attributeBy(convs, "linear", 30, DIMENSIONS.channel);
  near(lin.get("paid_meta").value, 25 + 50);
});

test("arbre canal → campagne → annonce", () => {
  const c = [
    conv([T(29, "paid_meta", { campaign_key: "A", ad_key: "a1" })], 100),
    conv([T(29, "paid_meta", { campaign_key: "A", ad_key: "a2" })], 60),
    conv([T(29, "paid_meta", { campaign_key: "B", ad_key: "b1" })], 30),
  ];
  const tree = attributeTree(c, "last_click", 30, [DIMENSIONS.channel, DIMENSIONS.campaign, DIMENSIONS.ad]);
  assert.equal(tree.length, 1);
  near(tree[0].value, 190);
  assert.deepEqual(tree[0].children.map((n) => n.key), ["A", "B"]);
  assert.equal(tree[0].children[0].children.length, 2);
});

test("rapprochement des campagnes par id puis par nom", () => {
  const c = [conv([T(29, "paid_meta", { campaign: "Advantage+ Shopping" }), T(29, "paid_google", { campaign_key: "123" })])];
  const out = linkCampaigns(c, [{ id: "abc", name: "Advantage+ Shopping", platform: "meta" }, { id: "123", name: "Search", platform: "google" }]);
  assert.equal(out[0].touches[0].campaign_key, "abc");
  assert.equal(out[0].touches[1].campaign_key, "123");
});

test("classification : UTM payantes Meta avec identifiants", () => {
  const a = classify("https://site.fr/?utm_source=facebook&utm_medium=paid_social&utm_campaign=Promo&utm_id=120&aos_ad=9&aos_adset=8&fbclid=x", "");
  assert.equal(a.channel, "paid_meta");
  assert.equal(a.campaign_key, "120");
  assert.equal(a.ad_key, "9");
  assert.equal(a.adset_key, "8");
  assert.equal(a.click_id_type, "fbclid");
});

test("classification : identifiants de clic, référents, lien court, direct", () => {
  assert.equal(classify("https://site.fr/?gclid=abc", "").channel, "paid_google");
  assert.equal(classify("https://site.fr/?fbclid=abc", "").channel, "organic_social");
  assert.equal(classify("https://site.fr/?ttclid=abc", "").channel, "paid_tiktok");
  assert.equal(classify("https://site.fr/", "https://www.google.fr/").channel, "organic_search");
  assert.equal(classify("https://site.fr/", "https://l.instagram.com/").channel, "organic_social");
  assert.equal(classify("https://site.fr/", "https://mail.google.com/").channel, "email");
  assert.equal(classify("https://site.fr/", "https://blog.exemple.org/article").channel, "referral");
  assert.equal(classify("https://site.fr/", "https://site.fr/autre").channel, "direct");
  assert.equal(classify("https://site.fr/", "https://checkout.site.fr/", ["site.fr"]).channel, "direct");
  assert.equal(classify("https://site.fr/?aos_lid=tok", "").channel, "short_link");
  assert.equal(classify("https://site.fr/?utm_source=newsletter&utm_medium=email", "").channel, "email");
  assert.equal(classify("https://site.fr/?utm_source=google&utm_medium=cpc&utm_campaign=12345678", "").campaign_key, "12345678");
  assert.equal(classify("https://site.fr/", "").sourced, false);
});

test("domaines déclarés et sous-domaines", () => {
  assert.ok(hostMatches("checkout.site.fr", ["site.fr"]));
  assert.ok(hostMatches("www.site.fr", ["https://site.fr/"]));
  assert.ok(!hostMatches("site.fr.evil.com", ["site.fr"]));
});

// ---------------------------------------------------------------------
// Entonnoir
// ---------------------------------------------------------------------
const stage = (id, key, position, extra = {}) => ({ id, key, label: key, position, kind: "step", has_value: false, aliases: [], ...extra });

test("entonnoir : étapes dans l'ordre, taux depuis l'étape précédente", () => {
  const stages = [stage("c", "purchase", 3, { has_value: true }), stage("a", "lead", 1), stage("b", "booking", 2)];
  const f = buildFunnel(stages, [
    { stage_id: "a", type: null, events: 50, people: 40, value: 0 },
    { stage_id: "b", type: null, events: 12, people: 10, value: 0 },
    { stage_id: "c", type: null, events: 5, people: 4, value: 900 },
  ]);
  assert.deepEqual(f.rows.map((r) => r.stage.key), ["lead", "booking", "purchase"]);
  assert.equal(f.rows[0].fromPrev, null);
  near(f.rows[1].fromPrev, 25);
  near(f.rows[2].fromPrev, 40);
  assert.equal(f.rows[0].share, 1);
  near(f.rows[2].share, 0.1);
  assert.equal(f.rows[2].value, 900);
});

test("entonnoir : une étape vide ne produit ni division par zéro ni taux", () => {
  const f = buildFunnel([stage("a", "lead", 1), stage("b", "booking", 2), stage("c", "purchase", 3)], [{ stage_id: "c", type: null, events: 2, people: 2, value: 10 }]);
  assert.equal(f.rows[1].people, 0);
  assert.equal(f.rows[1].fromPrev, null);
  assert.equal(f.rows[2].fromPrev, null);
  assert.equal(buildFunnel([stage("a", "lead", 1)], []).rows[0].share, 0);
});

test("entonnoir : les évènements sans étape sont listés à part, les plus fréquents d'abord", () => {
  const f = buildFunnel([stage("a", "lead", 1)], [
    { stage_id: null, type: "webinar", events: 3, people: 3, value: 0 },
    { stage_id: null, type: "quiz", events: 9, people: 7, value: 0 },
    { stage_id: "a", type: null, events: 1, people: 1, value: 0 },
  ]);
  assert.deepEqual(f.other.map((o) => o.type), ["quiz", "webinar"]);
});

test("clé d'étape : accents, espaces et chiffres en tête", () => {
  assert.equal(stageKey(" Rendez-vous honoré "), "rendez_vous_honore");
  assert.equal(stageKey("2e appel"), "e_appel");
  assert.equal(stageKey("---"), "");
});

// ---------------------------------------------------------------------
// Téléphone
// ---------------------------------------------------------------------
test("téléphone : écritures françaises d'un même numéro", () => {
  for (const raw of ["06 12 34 56 78", "0612345678", "+33 6 12 34 56 78", "+33 (0)6 12 34 56 78", "0033612345678", "33612345678", "06.12.34.56.78"])
    assert.equal(normalizePhone(raw), "33612345678", raw);
});

test("téléphone : le pays du visiteur sert aux numéros sans indicatif", () => {
  assert.equal(normalizePhone("0475 12 34 56", "BE"), "32475123456");
  assert.equal(normalizePhone("514 555 0199", "CA"), "15145550199");
  assert.equal(normalizePhone("612 34 56 78", "ES"), "34612345678");
  assert.equal(normalizePhone("0692 12 34 56", "RE"), "262692123456");
  assert.equal(normalizePhone("0692 12 34 56", "FR"), "262692123456");
  assert.equal(normalizePhone("0612345678", "ZZ"), "33612345678");
  assert.equal(normalizePhone("+1 514 555 0199", "FR"), "15145550199");
});

test("téléphone : une saisie inexploitable rend null", () => {
  for (const raw of ["", null, undefined, "abc", "12", "0", "+33", "1".repeat(20)]) assert.equal(normalizePhone(raw), null, String(raw));
});

// ---------------------------------------------------------------------
// Sources : webhook générique et import CSV
// ---------------------------------------------------------------------
const calcom = {
  triggerEvent: "BOOKING_CREATED",
  createdAt: "2026-09-12T08:00:00Z",
  payload: { uid: "bk_42", organizer: { email: "agence@exemple.fr", name: "Agence" }, attendees: [{ email: "Claire@Exemple.fr", name: "Claire Martin" }] },
};

test("webhook : les chemins de l'URL désignent le bon email", () => {
  const paths = { email: "payload.attendees.0.email", name: "payload.attendees.0.name", id: "payload.uid", date: "createdAt" };
  assert.deepEqual(readWebhook(calcom, "booking", paths), {
    email: "Claire@Exemple.fr", phone: undefined, name: "Claire Martin", type: "booking", value: undefined, currency: undefined, order_id: "bk_42", ts: "2026-09-12T08:00:00Z",
  });
  assert.equal(atPath(calcom, "payload.attendees.3.email"), undefined);
  assert.equal(atPath(calcom, "payload.uid.trop.loin"), undefined);
});

test("webhook : sans chemin, le champ le plus proche de la racine gagne", () => {
  const deal = { event: "deal.won", data: { id: 981, title: "Refonte", amount: "4 500,00", currency: "eur", person: { Email: "bob@exemple.fr", "Phone Number": "06 12 34 56 78" } } };
  const r = readWebhook(deal, "purchase");
  assert.equal(r.email, "bob@exemple.fr");
  assert.equal(r.phone, "06 12 34 56 78");
  assert.equal(r.value, 4500);
  assert.equal(r.currency, "EUR");
  assert.equal(r.order_id, "981");
  assert.equal(readWebhook({ email: "racine@exemple.fr", contact: { email: "fond@exemple.fr" } }, "lead").email, "racine@exemple.fr");
});

test("webhook : sans email ni téléphone, rien à enregistrer", () => {
  assert.equal(readWebhook({ event: "ping", id: 1 }, "lead"), null);
  assert.equal(readWebhook("pas un objet", "lead"), null);
  assert.equal(readWebhook(calcom, "booking", { email: "payload.attendees.9.email" }), null);
});

test("webhook : l'URL garde les chemins lisibles", () => {
  assert.equal(
    webhookUrl("https://app.fr", "sk_x", "booking", { email: "payload.email", id: "payload.uri" }),
    "https://app.fr/api/t/webhooks/in?key=sk_x&type=booking&email=payload.email&id=payload.uri",
  );
});

test("import CSV : colonnes en français, montants et dates français", () => {
  const r = parseConversionsCsv("Email;Téléphone;Type;Montant;Date;Référence\nClaire@Exemple.fr;06 12 34 56 78;purchase;1 490,50 €;12/09/2026;FAC-1\n;+33 7 98 76 54 32;show;;14/09/2026;\n", "");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows[0], { email: "claire@exemple.fr", phone: "06 12 34 56 78", type: "purchase", value: 1490.5, currency: undefined, order_id: "FAC-1", ts: "2026-09-12T12:00:00Z" });
  assert.equal(r.rows[1].email, undefined);
  assert.equal(r.rows[1].order_id, "csv:+33 7 98 76 54 32|show|2026-09-14|");
  assert.equal(r.columns.value, "Montant");
});

test("import CSV : une étape par fichier, lignes illisibles signalées sans bloquer les autres", () => {
  const r = parseConversionsCsv("email,valeur\na@b.fr,100\npas-un-email,50\n,20\nc@d.fr,abc\ne@f.fr,\n", "purchase");
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].type, "purchase");
  assert.equal(r.rows[1].value, undefined);
  assert.equal(r.errors.length, 3);
});

test("import CSV : refus net quand rien ne permet de rattacher une ligne", () => {
  assert.match(parseConversionsCsv("nom;valeur\nClaire;10\n", "purchase").errors[0], /email/);
  assert.match(parseConversionsCsv("email\na@b.fr\n", "").errors[0], /type/);
  assert.match(parseConversionsCsv("email", "purchase").errors[0], /en-têtes/);
});

// ---------------------------------------------------------------------
// Tableau des campagnes
// ---------------------------------------------------------------------
const STAGES = [
  { key: "lead", label: "Prospects", kind: "lead", has_value: false, aliases: [] },
  { key: "booking", label: "RDV", kind: "step", has_value: false, aliases: [] },
  { key: "purchase", label: "Ventes", kind: "sale", has_value: true, aliases: ["deal_won"] },
];
const paid = (at, extra = {}) => T(at, "paid_meta", { platform: "meta", campaign_key: "c1", campaign: "Prospection", adset_key: "s1", ad_key: "a1", content: "Vidéo A", ...extra });
const cv = (id, type, person, touches, value = 0, at = 30) => ({ id, ts: day(at), type, value, person, touches });
const CAMPS = [{ platform: "meta", campaign_id: "c1", campaign_name: "Prospection froide", spend: 300, pconv: 9, pvalue: 2000 }, { platform: "meta", campaign_id: "c2", campaign_name: "Retargeting", spend: 50, pconv: 0, pvalue: 0 }];
const ADS = [
  { platform: "meta", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s1", adset_name: "Large", ad_id: "a1", ad_name: "Vidéo A", spend: 200 },
  { platform: "meta", campaign_id: "c1", campaign_name: "Prospection froide", adset_id: "s1", adset_name: "Large", ad_id: "a2", ad_name: "Image B", spend: 100 },
];

test("campagnes : crédit, dépense et chiffre d'affaires à chaque niveau", () => {
  const t = buildCampaignTable(
    [cv("1", "lead", "p1", [paid(20)]), cv("2", "booking", "p1", [paid(20)]), cv("3", "purchase", "p1", [paid(20)], 1000), cv("4", "lead", "p2", [paid(21, { ad_key: "a2", content: "Image B" })])],
    STAGES, "last_click", 30, CAMPS, ADS,
  );
  const c1 = t.rows.find((r) => r.key === "c1");
  assert.equal(c1.label, "Prospection froide");
  assert.deepEqual(c1.stages, { lead: 2, booking: 1, purchase: 1 });
  assert.equal(c1.value, 1000);
  assert.equal(c1.spend, 300);
  near(ratio(c1.value, c1.spend), 1000 / 300);
  assert.deepEqual(c1.people.sort(), ["p1", "p2"]);
  const s1 = c1.children[0];
  assert.equal(s1.label, "Large");
  assert.equal(s1.spend, 300);
  assert.deepEqual(s1.children.map((a) => [a.key, a.label, a.spend, a.stages.lead, a.value]), [["a1", "Vidéo A", 200, 1, 1000], ["a2", "Image B", 100, 1, 0]]);
});

test("campagnes : une campagne qui dépense sans rien produire reste visible, avec des zéros", () => {
  const t = buildCampaignTable([], STAGES, "last_click", 30, CAMPS, ADS);
  const c2 = t.rows.find((r) => r.key === "c2");
  assert.deepEqual([c2.spend, c2.value, c2.stages, c2.pconv], [50, 0, {}, 0]);
  assert.equal(ratio(c2.value, c2.spend), 0);
  assert.equal(ratio(10, null), null);
  assert.equal(ratio(10, 0), null);
  assert.equal(t.total.spend, 350);
});

test("campagnes : l'organique et le direct ne sont crédités à aucune campagne, le total les compte", () => {
  const t = buildCampaignTable(
    [cv("1", "purchase", "p1", [T(20, "organic_search")], 400), cv("2", "purchase", "p2", [], 100), cv("3", "purchase", "p3", [paid(25)], 500)],
    STAGES, "last_click", 30, CAMPS, [],
  );
  assert.equal(t.organic.stages.purchase, 2);
  assert.equal(t.organic.value, 500);
  assert.equal(t.total.stages.purchase, 3);
  assert.equal(t.total.value, 1000);
  assert.equal(t.rows.find((r) => r.key === "c1").value, 500);
});

test("campagnes : modèle linéaire partagé entre deux campagnes, étape d'entrée comptée une fois par personne", () => {
  const two = [paid(10), paid(20, { campaign_key: "c2", campaign: "Retargeting", adset_key: null, ad_key: null })];
  const t = buildCampaignTable([cv("1", "purchase", "p1", two, 1000), cv("2", "lead", "p1", two, 0, 12), cv("3", "lead", "p1", two, 0, 25), cv("4", "deal_won", "p1", two, 200)], STAGES, "linear", 30, CAMPS, []);
  const [c1, c2] = ["c1", "c2"].map((k) => t.rows.find((r) => r.key === k));
  near(c1.value, 600);
  near(c2.value, 600);
  near(c1.stages.purchase, 1);
  assert.equal(t.total.stages.lead, 1);
  assert.equal(c2.children.length, 0);
});

test("campagnes : sans identifiant de régie, la campagne est reconnue par son nom d'URL et n'a pas de dépense", () => {
  const t = buildCampaignTable([cv("1", "lead", "p1", [T(20, "paid_google", { platform: "google", campaign: "brand-fr" })])], STAGES, "last_click", 30, [], []);
  assert.deepEqual([t.rows[0].key, t.rows[0].label, t.rows[0].spend, t.rows[0].platform], ["brand-fr", "brand-fr", null, "google"]);
});

test("campagnes : un évènement hors entonnoir n'entre pas dans le tableau", () => {
  const t = buildCampaignTable([cv("1", "webinaire", "p1", [paid(20)])], STAGES, "last_click", 30, [], []);
  assert.equal(t.rows.length, 0);
  assert.deepEqual(t.total.stages, {});
});

// ---------------------------------------------------------------------
// Contrat de l'API de l'extension
// ---------------------------------------------------------------------
const FULL = [...STAGES.slice(0, 2), { key: "show", label: "RDV honorés", kind: "step", has_value: false, aliases: [] }, STAGES[2]];

test("extension : le catalogue suit l'entonnoir et garde les clés historiques du contrat", () => {
  assert.deepEqual(catalogue(FULL).map((c) => c.cle), ["depense", "leads", "etape_booking", "etape_show", "ventes", "cpl", "caSigne", "roas", "cac", "conversionsPlateforme"]);
  const ecom = [{ key: "add_to_cart", label: "Paniers", kind: "step", has_value: false, aliases: [] }, { key: "purchase", label: "Achats", kind: "sale", has_value: true, aliases: [] }];
  assert.deepEqual(catalogue(ecom).map((c) => c.cle), ["depense", "etape_add_to_cart", "ventes", "caSigne", "roas", "cac", "conversionsPlateforme"]);
  assert.equal(catalogue(FULL).find((c) => c.cle === "ventes").role, "resultat");
  assert.deepEqual(catalogue([]).map((c) => c.cle), ["depense", "conversionsPlateforme"]);
});

test("extension : un ratio indéfini vaut null, jamais zéro", () => {
  const m = mesures({ stages: { lead: 4, purchase: 2 }, value: 1000, spend: 200, pconv: 7 }, FULL);
  assert.deepEqual([m.depense, m.leads, m.etape_booking, m.ventes, m.caSigne, m.roas, m.cpl, m.cac, m.conversionsPlateforme], [200, 4, 0, 2, 1000, 5, 50, 100, 7]);
  const vide = mesures({ stages: {}, value: 0, spend: 0 }, FULL);
  assert.deepEqual([vide.leads, vide.cpl, vide.cac, vide.roas, vide.conversionsPlateforme], [0, null, null, null, null]);
  assert.equal(mesures({ stages: { purchase: 1 }, value: 500, spend: null }, FULL).roas, null);
});

test("extension : entités à plat, clé composite, parent et niveau de dépense", () => {
  const t = buildCampaignTable([cv("1", "lead", "p1", [paid(20)]), cv("3", "purchase", "p1", [paid(20)], 1000)], STAGES, "last_click", 30, CAMPS, ADS);
  const tout = aplatir(t, STAGES, ["campagne", "adset", "pub"], [], "EUR");
  assert.deepEqual(Object.keys(tout).sort(), ["meta:adset:s1", "meta:campagne:c1", "meta:campagne:c2", "meta:pub:a1", "meta:pub:a2"]);
  assert.deepEqual([tout["meta:pub:a1"].parentExternalId, tout["meta:adset:s1"].parentExternalId, tout["meta:campagne:c1"].parentExternalId], ["s1", "c1", null]);
  assert.deepEqual([tout["meta:campagne:c1"].niveauDepense, tout["meta:campagne:c2"].niveauDepense, tout["meta:pub:a2"].niveauDepense], ["ad", "campaign", "ad"]);
  assert.equal(tout["meta:pub:a1"].m.caSigne, 1000);
  assert.equal(tout["meta:pub:a2"].m.ventes, 0);
  assert.equal(tout["meta:campagne:c1"].canal, "paid_meta");
  assert.deepEqual(Object.keys(aplatir(t, STAGES, ["pub"], ["google"], "EUR")), []);
  assert.deepEqual(Object.keys(aplatir(t, STAGES, ["campagne"], ["meta"], "EUR")).sort(), ["meta:campagne:c1", "meta:campagne:c2"]);
});

test("extension : une campagne reconnue par son seul nom d'URL n'a pas de ligne dans Ads Manager", () => {
  const t = buildCampaignTable([cv("1", "lead", "p1", [T(20, "paid_google", { campaign: "brand-fr" })])], STAGES, "last_click", 30, [], []);
  assert.deepEqual(aplatir(t, STAGES, ["campagne"], [], "EUR"), {});
});

test("extension : entité connue sans activité, des zéros et pas une absence", () => {
  const e = entreeSansActivite("meta", "campagne", "c9", null, "En pause", STAGES, "EUR");
  assert.deepEqual([e.m.depense, e.m.leads, e.m.ventes, e.m.caSigne, e.m.roas, e.m.conversionsPlateforme], [0, 0, 0, 0, null, 0]);
  assert.equal(entreeSansActivite("meta", "pub", "a9", "s1", "x", STAGES, "EUR").m.conversionsPlateforme, null);
});

test("extension : personnes créditées à une ligne, étape la plus avancée d'abord", () => {
  const convs = [cv("1", "lead", "p1", [paid(20)], 0, 21), cv("2", "purchase", "p1", [paid(20)], 900, 28), cv("3", "lead", "p2", [paid(22, { ad_key: "a2" })], 0, 23), cv("4", "lead", "p3", [T(20, "organic_search")], 0, 22)];
  const camp = creditesDe(convs, STAGES, "last_click", 30, "campagne", "c1");
  assert.deepEqual(camp.map((c) => [c.personne, c.etape, c.credit]), [["p1", "Ventes", 2], ["p2", "Prospects", 1]]);
  assert.equal(camp[0].jour, day(28).slice(0, 10));
  assert.deepEqual(creditesDe(convs, STAGES, "last_click", 30, "pub", "a2").map((c) => c.personne), ["p2"]);
  assert.deepEqual(creditesDe(convs, STAGES, "last_click", 30, "pub", "inconnue"), []);
});

test("extension : périodes du contrat et identifiant de compte comparable", () => {
  const now = new Date(Date.UTC(2026, 9, 9, 15));
  assert.deepEqual(lirePeriode("7j", null, null, now), { cle: "7j", start: "2026-10-03", end: "2026-10-09", label: "7 j" });
  assert.deepEqual([lirePeriode("mois_dernier", null, null, now).start, lirePeriode("mois_dernier", null, null, now).end], ["2026-09-01", "2026-09-30"]);
  assert.equal(lirePeriode("perso", "2026-09-01", "2026-09-15", now).start, "2026-09-01");
  assert.equal(lirePeriode("perso", "2026-09-15", "2026-09-01", now).cle, "30j");
  assert.equal(lirePeriode("nimporte", null, null, now).start, "2026-09-10");
  assert.equal(cleCompte("act_1634338935060146"), cleCompte("1634338935060146"));
  assert.equal(cleCompte("879-185-8341"), "8791858341");
});
