// Scores, classement de la semaine, rétention. Usage : node --experimental-strip-types --test src/lib/creatives/tests/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { band, groupByAsset, retention, scoreAds, weeklyBoard } from "../board.ts";

const Z = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0, vImp: 0, v3: 0, v3h: 0, thru: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
const T = (o) => ({ ...Z, ...o });

test("scores : rang centile parmi les annonces au-dessus du seuil", () => {
  const ads = [
    { key: "a", t: T({ spend: 100, impressions: 1000, clicks: 10, vImp: 1000, v3: 200 }) },
    { key: "b", t: T({ spend: 100, impressions: 1000, clicks: 20, vImp: 1000, v3: 300 }) },
    { key: "c", t: T({ spend: 100, impressions: 1000, clicks: 30, vImp: 1000, v3: 400 }) },
    { key: "d", t: T({ spend: 5, impressions: 1000, clicks: 90, vImp: 1000, v3: 900 }) },
  ];
  const s = scoreAds(ads, 50);
  assert.equal(s.get("a").click, 1);
  assert.equal(s.get("b").click, 51);
  assert.equal(s.get("c").click, 100);
  assert.equal(s.get("c").hook, 100);
  // sous le seuil : pas de score
  assert.equal(s.get("d").click, null);
  // moins de 3 annonces comparables : pas de score
  assert.equal(s.get("a").watch, null);
});

test("scores : la conversion suit le ROAS réel dès qu'une vente est suivie", () => {
  const ads = [
    { key: "a", t: T({ spend: 100, value: 500 }), realRevenue: 0 },
    { key: "b", t: T({ spend: 100, value: 100 }), realRevenue: 300 },
    { key: "c", t: T({ spend: 100, value: 300 }), realRevenue: 100 },
  ];
  const s = scoreAds(ads, 0);
  assert.equal(s.get("b").convert, 100);
  assert.equal(s.get("a").convert, 1);
});

test("bandes de couleur", () => {
  assert.equal(band(85), "top");
  assert.equal(band(60), "good");
  assert.equal(band(45), "mid");
  assert.equal(band(10), "low");
});

test("classement de la semaine : rangs et mouvements", () => {
  const day = (date, spend) => ({ date, spend });
  const rows = new Map([
    // stable depuis longtemps
    ["old", [day("2026-09-01", 50), day("2026-10-10", 70), day("2026-10-20", 70)]],
    // monte fort
    ["up", [day("2026-09-01", 10), day("2026-10-10", 50), day("2026-10-20", 200)]],
    // coupée cette semaine
    ["off", [day("2026-09-01", 10), day("2026-10-12", 300)]],
    // apparue cette semaine
    ["neuf", [day("2026-10-19", 30)]],
  ]);
  const b = weeklyBoard(rows, "2026-10-23");
  const by = Object.fromEntries(b.map((r) => [r.key, r]));
  assert.equal(by.up.rank, 1);
  assert.equal(by.up.move, "scaling");
  assert.equal(by.old.move, "steady");
  assert.equal(by.neuf.move, "new");
  assert.equal(by.off.move, "paused");
  assert.equal(by.off.rank, null);
  assert.equal(by.off.prevRank, 1);
  assert.equal(b[b.length - 1].key, "off");
});

test("rétention : part des vues de 3 s encore là", () => {
  assert.equal(retention(T({ v3: 0 })), null);
  const r = retention(T({ v3: 200, p25: 120, p50: 80, p75: 50, p100: 20 }));
  assert.deepEqual(r.map((x) => Math.round(x.pct)), [100, 60, 40, 25, 10]);
});

test("même créa, plusieurs annonces", () => {
  const byAd = new Map([["m|1", 10], ["m|2", 5], ["m|3", 7]]);
  const g = groupByAsset(byAd, (k) => (k === "m|3" ? null : "v:42"), (a, b) => a + b);
  assert.deepEqual(g.map((x) => [x.asset, x.ads.length, x.t]), [["v:42", 2, 15], ["ad:m|3", 1, 7]]);
});

test("scores : sans vente suivie, pas de score de conversion", () => {
  const ads = [
    { key: "a", t: T({ spend: 100 }), realRevenue: 100 },
    { key: "b", t: T({ spend: 100 }), realRevenue: 200 },
    { key: "c", t: T({ spend: 100 }), realRevenue: 300 },
    { key: "d", t: T({ spend: 100, value: 900 }), realRevenue: null },
  ];
  const s = scoreAds(ads, 0);
  assert.equal(s.get("d").convert, null);
  assert.equal(s.get("c").convert, 100);
});
