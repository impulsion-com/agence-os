// Tests du moteur d'attribution et de la classification des canaux.
// Lancer : node --experimental-strip-types --test src/lib/tracking/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { attributeBy, attributeTree, credits, inWindow, linkCampaigns, DIMENSIONS } from "../attribution.ts";
import { classify, hostMatches } from "../channels.ts";

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
