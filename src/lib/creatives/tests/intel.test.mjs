// Tests de la veille concurrentielle (calculs purs) et du parsing des réponses IA.
// Lancer : node --experimental-strip-types --test src/lib/creatives/tests/intel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  firstSentence, isNew, longevityDays, mapGraphError, normText, parseArchivePage, parsePageInput, scoreAd, scoreAll, stripToken, variantGroups,
} from "../intel-core.ts";
import { mockRecommendation, mockTags, validateRecommendation, validateTagBatch } from "../ai-parse.ts";

const NOW = Date.UTC(2026, 8, 30, 12);
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const ad = (id, extra = {}) => ({ id, page_id: "1", bodies: [], titles: [], start_time: ago(10), stop_time: null, is_active: true, eu_reach: null, ...extra });

test("longévité : active jusqu'à maintenant, arrêtée jusqu'à l'arrêt", () => {
  assert.equal(longevityDays(ago(47), null, NOW), 47);
  assert.equal(longevityDays(ago(47), ago(7), NOW), 40);
  assert.equal(longevityDays(null, null, NOW), null);
  assert.equal(longevityDays("pas une date", null, NOW), null);
  // Arrêt avant le lancement (donnée incohérente) : jamais négatif
  assert.equal(longevityDays(ago(3), ago(5), NOW), 0);
});

test("nouvelle : vue il y a moins de 7 jours", () => {
  assert.equal(isNew(ago(6.9), NOW), true);
  assert.equal(isNew(ago(7.1), NOW), false);
});

test("normalisation : accents, casse, ponctuation, emojis, URL et variables", () => {
  assert.equal(normText("  Élégante, LAMPE !! 🔥 https://x.fr/a?b=1 {{product.name}} "), "elegante lampe");
});

test("première phrase", () => {
  assert.equal(firstSentence("Ton salon est trop sombre ? Une lampe suffit."), "Ton salon est trop sombre ?");
  assert.equal(firstSentence("Sans ponctuation finale"), "Sans ponctuation finale");
  assert.equal(firstSentence("x".repeat(300)).length, 160);
});

test("groupes de variantes : même texte ou même titre, par page, transitif", () => {
  const ads = [
    ad("a", { bodies: ["La lumière scandinave, sans le prix scandinave."], titles: ["Lampadaire Fjord, 89 €"] }),
    ad("b", { bodies: ["La lumière SCANDINAVE sans le prix scandinave !"], titles: ["Autre titre très différent"] }),
    ad("c", { bodies: ["Un texte sans rapport avec les autres"], titles: ["Autre titre très différent"] }),
    ad("d", { bodies: ["La lumière scandinave, sans le prix scandinave."], page_id: "2" }), // autre page
    ad("e", { titles: ["Découvrir"] }), // titre trop court pour relier
    ad("f", { titles: ["Découvrir"] }),
  ];
  const g = variantGroups(ads);
  assert.equal(g.get("a"), g.get("b"));
  assert.equal(g.get("b"), g.get("c"), "c relié à b par le titre");
  assert.notEqual(g.get("a"), g.get("d"));
  assert.notEqual(g.get("e"), g.get("f"));
});

test("score : barème explicable et seuil de gagnante", () => {
  const s = scoreAd({ start_time: ago(47), stop_time: null, is_active: true, eu_reach: 230_000 }, 4, NOW);
  assert.equal(s.score, 35 + 20 + 15 + 7);
  assert.equal(s.winner, true);
  assert.deepEqual(s.reasons.map((r) => r.points), [35, 20, 15, 7]);
  assert.match(s.reasons[3].label, /230 k/);

  const young = scoreAd({ start_time: ago(20), stop_time: null, is_active: true, eu_reach: 5_000_000 }, 8, NOW);
  assert.equal(young.winner, false, "moins de 30 jours : jamais gagnante");

  const stopped = scoreAd({ start_time: ago(120), stop_time: ago(20), is_active: false, eu_reach: null }, 1, NOW);
  assert.equal(stopped.longevity, 100);
  assert.equal(stopped.winner, false, "arrêtée : jamais gagnante");
  assert.equal(stopped.score, 50);

  const capped = scoreAd({ start_time: ago(200), stop_time: null, is_active: true, eu_reach: 9_000_000 }, 12, NOW);
  assert.equal(capped.score, 100);
});

test("scoreAll : les variantes comptent dans le score", () => {
  const body = ["Même texte principal pour les trois pubs"];
  const m = scoreAll([ad("x", { bodies: body, start_time: ago(40) }), ad("y", { bodies: body }), ad("z", { bodies: body }), ad("w", { start_time: ago(40) })], NOW);
  assert.equal(m.get("x").variants, 3);
  assert.equal(m.get("w").variants, 1);
  assert.ok(m.get("x").score > m.get("w").score);
});

test("parsing Ad Library : champs, jeton retiré, pagination", () => {
  const page = {
    data: [
      {
        id: "1234567890",
        page_id: "987",
        page_name: "Nordlys",
        ad_creative_bodies: ["Texte A", "Texte A", " "],
        ad_creative_link_titles: ["Titre"],
        ad_delivery_start_time: "2026-08-01",
        ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=1234567890&access_token=SECRET",
        publisher_platforms: ["FACEBOOK", "INSTAGRAM"],
        languages: ["fr"],
        eu_total_reach: 45000,
        target_ages: ["25", "54"],
      },
      { page_name: "sans id" },
    ],
    paging: { cursors: { after: "abc" }, next: "https://graph.facebook.com/v26.0/ads_archive?after=abc" },
  };
  const { ads, next } = parseArchivePage(page);
  assert.equal(ads.length, 1);
  const a = ads[0];
  assert.deepEqual(a.bodies, ["Texte A"]);
  assert.deepEqual(a.platforms, ["facebook", "instagram"]);
  assert.equal(a.eu_reach, 45000);
  assert.equal(a.target_ages, "25-54");
  assert.equal(a.stop_time, null);
  assert.ok(!a.snapshot_url.includes("SECRET"));
  assert.equal(next, page.paging.next);

  assert.equal(parseArchivePage({ data: [], paging: { next: "https://x" } }).next, null, "page vide = fin");
  assert.equal(parseArchivePage({ data: [{ id: "1" }] }).next, null, "pas de next = fin");
  assert.deepEqual(parseArchivePage(null), { ads: [], next: null });
  assert.equal(stripToken("pas une url"), null);
});

test("erreurs Graph : identité non confirmée, jeton, limite", () => {
  assert.equal(mapGraphError({ code: 10, error_subcode: 2332002, message: "Application does not have permission for this action" }).code, "identity");
  assert.equal(mapGraphError({ code: 190, message: "Invalid OAuth access token" }).code, "token");
  assert.equal(mapGraphError({ code: 613 }).code, "rate");
  assert.equal(mapGraphError({ code: 1, message: "An unknown error has occurred." }).code, "token");
  assert.equal(mapGraphError({ code: 100, message: "Invalid parameter" }).code, "param");
});

test("saisie d'une page : ID, URL de page, URL Ad Library, nom", () => {
  assert.deepEqual(parsePageInput("123456789"), { pageId: "123456789" });
  assert.deepEqual(parsePageInput("https://www.facebook.com/ads/library/?active_status=all&view_all_page_id=112233445566"), { pageId: "112233445566" });
  assert.deepEqual(parsePageInput("https://www.facebook.com/profile.php?id=100064000000001"), { pageId: "100064000000001" });
  assert.deepEqual(parsePageInput("https://www.facebook.com/Sezane-Paris-123456789012/"), { pageId: "123456789012" });
  assert.deepEqual(parsePageInput("facebook.com/sezane.paris"), { name: "sezane paris" });
  assert.deepEqual(parsePageInput("Maison Verdure"), { name: "Maison Verdure" });
  assert.equal(parsePageInput("  "), null);
});

test("IA : validation d'un lot de tags (ids inconnus ignorés, valeurs hors liste ramenées à une valeur neutre)", () => {
  const ok = validateTagBatch(
    {
      items: [
        { id: "a", angle: "Preuve sociale", hook_type: "temoignage", hook: "J'ai testé", awareness: "product", format: "ugc", promise: "", proof: "4 200 avis", offer: "", cta: "Acheter", persona: "Peau sèche" },
        { id: "zzz", angle: "x", hook_type: "question", hook: "", awareness: "problem", format: "static", promise: "", proof: "", offer: "", cta: "", persona: "" },
      ],
    },
    ["a", "b"],
  );
  assert.equal(ok.size, 1);
  assert.equal(ok.get("a").hook_type, "temoignage");
  // Valeur hors liste : ramenée à « autre » (le reste du lot est gardé)
  const odd = validateTagBatch({ items: [{ id: "a", angle: "x", hook_type: "Inconnu", hook: "", awareness: "PROBLEM", format: "reel", promise: "", proof: "", offer: "", cta: "", persona: "" }] }, ["a"]);
  assert.equal(odd.get("a").hook_type, "autre");
  assert.equal(odd.get("a").awareness, "problem");
  assert.equal(odd.get("a").format, "other");
  // Champ manquant : lot rejeté
  assert.throws(() => validateTagBatch({ items: [{ id: "a", hook_type: "question" }] }, ["a"]));
});

test("IA : validation d'une recommandation (3 à 5 opportunités, pubs citées connues)", () => {
  const brief = { concept_title: "T", angle: "A", hooks: ["h1", "h2", "h3"], script: "s", shots: ["p1"], format: "ugc", awareness: "problem", persona: "p", cta: "c" };
  const opp = (ads) => ({ title: "O", kind: "scale", why: "parce que", evidence: [{ label: "ROAS", value: "+40 %" }], competitor_ads: ads, brief });
  const r = validateRecommendation({ summary: "S", opportunities: [opp(["demo-a", "inconnue"]), opp([]), opp(["demo-b"])] }, ["demo-a", "demo-b"]);
  assert.deepEqual(r.opportunities[0].competitor_ads, ["demo-a"]);
  assert.throws(() => validateRecommendation({ summary: "S", opportunities: [opp([])] }, []), "moins de 3 opportunités");
  assert.throws(() => validateRecommendation({ summary: "S", opportunities: [opp([]), opp([]), { ...opp([]), brief: { ...brief, hooks: ["un seul"] } }] }, []));
});

test("IA simulée (AI_MOCK) : tags heuristiques et recommandation valides", () => {
  const t = mockTags({ id: "x", text: "Ton salon est trop sombre le soir ? -20 % cette semaine." });
  assert.equal(t.hook_type, "question");
  const rec = mockRecommendation({
    company: "Kalia",
    own: { angles: [{ key: "Routine", spend: 1000, roas: 3.2, cpa: 20, hook: 35, vsAvg: 25 }], formats: [], awareness: [], hooks: [], fatigued: [], concepts: 5, coverage: { problem: 2 } },
    competitors: [{ archive_id: "demo-a", page: "Oléa", text: "Teint terne ?", score: 80, longevity: 66, variants: 3, tags: { angle: "Résultats visibles", hook_type: "question", awareness: "problem", format: "ugc" } }],
    gaps: { angles: ["Résultats visibles"], awareness: ["unaware"], hookTypes: ["question"] },
  });
  const v = validateRecommendation(rec, ["demo-a"]);
  assert.ok(v.opportunities.length >= 3);
});
