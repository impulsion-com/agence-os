// Reporting façon Hyros : modèle Scientifique, comparateur de modèles, valeur dans le temps, cohortes.
// Lancer : node --experimental-strip-types --test src/lib/tracking/tests/ltv.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { credits } from "../attribution.ts";
import { buildCampaignTable, modelMatrix, rowIds } from "../campaigns.ts";
import { acquisitions, cohorts, ltvByRow } from "../ltv.ts";

const day = (n) => new Date(Date.UTC(2026, 6, 1 + n, 12)).toISOString();
const meta = (at, ad = "a1") => ({ ts: day(at), channel: "paid_meta", platform: "meta", campaign_key: "c1", campaign: "Prospection", adset_key: "s1", ad_key: ad });
const STAGES = [
  { key: "lead", label: "Prospect", kind: "lead", has_value: false, aliases: [] },
  { key: "purchase", label: "Vente", kind: "sale", has_value: true, aliases: [] },
];
const SALE = new Set(["purchase"]);

test("scientifique : premier clic si la vente suit vite, sinon dernier clic", () => {
  const fast = { id: "x", ts: day(5), type: "purchase", value: 100, person: "p", touches: [meta(0, "first"), { ts: day(4), channel: "email" }] };
  assert.equal(credits(fast, "scientific_7", 30)[0].touch.ad_key, "first");
  const slow = { ...fast, ts: day(20), touches: [meta(0, "first"), meta(18, "last")] };
  assert.equal(credits(slow, "scientific_7", 30)[0].touch.ad_key, "last");
  assert.equal(credits(slow, "scientific_30", 30)[0].touch.ad_key, "first");
});

test("chemins de ligne cohérents avec le tableau", () => {
  assert.deepEqual(rowIds(meta(0)), ["c1", "c1|s1", "c1|s1|a1"]);
  assert.deepEqual(rowIds({ ts: day(0), channel: "paid_meta", campaign: "Sans id" }), ["Sans id"]);
  const t = buildCampaignTable([{ id: "1", ts: day(1), type: "purchase", value: 50, person: "p", touches: [meta(0)] }], STAGES, "last_click", 30, [], []);
  const ids = [t.rows[0].id, t.rows[0].children[0].id, t.rows[0].children[0].children[0].id];
  assert.deepEqual(ids, rowIds(meta(0)));
});

test("valeur déclarée par la régie jusqu'à la publicité", () => {
  const ads = [{ platform: "meta", campaign_id: "c1", campaign_name: "P", adset_id: "s1", adset_name: "S", ad_id: "a1", ad_name: "A", spend: 10, pconv: 2, pvalue: 80 }];
  const t = buildCampaignTable([], STAGES, "last_click", 30, [], ads);
  assert.equal(t.rows[0].children[0].pvalue, 80);
  assert.equal(t.rows[0].children[0].children[0].pconv, 2);
});

test("comparateur : chaque modèle répartit le même chiffre d'affaires", () => {
  const c = { id: "1", ts: day(10), type: "purchase", value: 100, person: "p", touches: [meta(0), { ts: day(9), channel: "paid_google", platform: "google", campaign_key: "g1" }] };
  const m = modelMatrix([c], STAGES, 30);
  assert.equal(m.get("c1").first_click, 100);
  assert.equal(m.get("g1").last_click, 100);
  assert.equal(m.get("c1").linear, 50);
  assert.equal(m.get("c1").scientific_7, 0);
  assert.equal(m.get("c1").scientific_30, 100);
});

test("valeur à 30/60/90 jours par prospect, non-acheteurs compris, fenêtres écoulées seulement", () => {
  const convs = [
    { id: "l1", ts: day(1), type: "lead", value: 0, person: "p1", touches: [meta(0)] },
    { id: "l2", ts: day(2), type: "lead", value: 0, person: "p2", touches: [meta(1)] },
    { id: "l3", ts: day(3), type: "lead", value: 0, person: "p3", touches: [{ ts: day(3), channel: "organic_search" }] },
    // p1 rentre une 2e fois : seule la première entrée compte
    { id: "l4", ts: day(5), type: "lead", value: 0, person: "p1", touches: [meta(4, "autre")] },
  ];
  const acq = acquisitions(convs, STAGES, 30, "2026-07-01", "2026-07-31");
  assert.equal(acq.length, 3);
  assert.deepEqual(acq.find((a) => a.person === "p3").rows, []);
  const sales = [
    { id: "s1", ts: day(10), type: "purchase", value: 100, person: "p1", touches: [] },
    { id: "s2", ts: day(50), type: "purchase", value: 60, person: "p1", touches: [] },
    { id: "s3", ts: day(120), type: "purchase", value: 999, person: "p1", touches: [] },
  ];
  // 70 jours après le début : 30 et 60 jours écoulés, pas 90
  const ltv = ltvByRow(acq, sales, SALE, day(70)).get("c1|s1|a1");
  assert.equal(ltv.people, 2);
  assert.equal(ltv.buyers, 1);
  assert.equal(ltv.value[30], 50); // 100 / 2 personnes
  assert.equal(ltv.value[60], 80); // 160 / 2
  assert.equal(ltv.value[90], null);
});

test("cohortes par mois d'entrée face à la dépense", () => {
  const convs = [
    { id: "l1", ts: day(1), type: "lead", value: 0, person: "p1", touches: [meta(0)] },
    { id: "l2", ts: day(35), type: "lead", value: 0, person: "p2", touches: [meta(34)] },
  ];
  const acq = acquisitions(convs, STAGES, 30, "2026-07-01", "2026-08-31");
  const sales = [{ id: "s", ts: day(3), type: "purchase", value: 300, person: "p1", touches: [] }];
  const co = cohorts(acq, sales, SALE, new Map([["2026-07", 100], ["2026-08", 50]]), day(200));
  assert.deepEqual(co.map((c) => [c.month, c.paid, c.spend, c.revenue]), [["2026-07", 1, 100, 300], ["2026-08", 1, 50, 0]]);
  assert.equal(co[0].value[30], 300);
});
