// Tests de l'analytics de site : transformation des réponses GA4 et Clarity en lignes,
// fenêtres de synchro, calculs (taux de conversion, taux de friction, pages à problèmes).
// Lancer : node --experimental-strip-types --test src/lib/analytics/tests/analytics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OTHER, explainGa4Error, ga4BatchRequests, ga4ChannelRows, ga4Date, ga4DimRows, ga4PageRows, ga4PagesRequest, ga4TopPages, ga4Window, isEventName, keyEventMetric,
} from "../ga4-rows.ts";
import {
  CLARITY_CALLS, CLARITY_MIN_INTERVAL_H, clarityDailyShare, clarityLinks, clarityPlan, clarityProjectId, clarityRows, claritySnapshotDate, clarityTokenInfo,
  isClarityProjectId, normalizeUrl,
} from "../clarity-rows.ts";
import {
  channelName, clarityInsights, clarityTotals, conversionGaps, daysBetween, fmtDuration, fmtSiteKpi, frictionRate, ga4Series, ga4Split, isPaidChannel, paidTotals,
  problemPages, rate, siteKpi, topChannels,
} from "../calc.ts";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// ---------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------
const row = (dims, mets) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((v) => ({ value: String(v) })) });
// métriques : sessions, totalUsers, newUsers, engagedSessions, userEngagementDuration, keyEvents, ecommercePurchases, purchaseRevenue, totalRevenue(, screenPageViews)

test("GA4 : fenêtre de synchro, 90 jours puis 7 jours glissants", () => {
  const now = new Date("2026-10-01T05:00:00Z");
  assert.deepEqual(ga4Window(now, null), { since: "2026-07-03", until: "2026-10-01", days: 90, full: true });
  assert.deepEqual(ga4Window(now, "2026-09-01T05:00:00Z"), { since: "2026-09-24", until: "2026-10-01", days: 7, full: false });
  // resynchronisation complète demandée
  assert.equal(ga4Window(now, "2026-09-01T05:00:00Z", true).since, "2026-07-03");
});

test("GA4 : requêtes, cinq rapports par batch et évènement clé choisi", () => {
  const reqs = ga4BatchRequests("2026-09-01", "2026-09-30");
  assert.equal(reqs.length, 5); // limite de batchRunReports
  assert.deepEqual(reqs[1].dimensions.map((d) => d.name), ["date", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium"]);
  assert.ok(reqs.every((r) => r.metrics.length <= 10)); // 10 métriques au plus par rapport
  assert.equal(reqs[0].metrics[5].name, "keyEvents");
  assert.equal(ga4BatchRequests("2026-09-01", "2026-09-30", "purchase")[0].metrics[5].name, "keyEvents:purchase");
  assert.equal(keyEventMetric("generate_lead"), "keyEvents:generate_lead");
  // un nom d'évènement invalide ne passe jamais dans la requête
  assert.equal(keyEventMetric("purchase;drop"), "keyEvents");
  assert.equal(isEventName("9lives"), false);
  const pages = ga4PagesRequest("2026-09-01", "2026-09-30", ["/", "/panier"], "purchase");
  assert.deepEqual(pages.dimensionFilter.filter.inListFilter.values, ["/", "/panier"]);
  assert.equal(pages.metrics[2].name, "keyEvents:purchase");
});

test("GA4 : date et lignes par canal, sources secondaires regroupées", () => {
  assert.equal(ga4Date("20260929"), "2026-09-29");
  assert.equal(ga4Date("(other)"), null);
  const report = {
    rows: [
      row(["20260929", "Organic Search", "google", "organic"], [50, 40, 30, 35, 1800, 2, 1, 165, 165]),
      row(["20260929", "Paid Social", "facebook", "paid"], [30, 28, 25, 12, 600, 1, 1, 0, 90]),
      row(["20260929", "Referral", "petit-blog.fr", "referral"], [2, 2, 2, 1, 40, 0, 0, 0, 0]),
      row(["20260929", "Referral", "autre-blog.fr", "referral"], [1, 1, 1, 0, 0, 0, 0, 0, 0]),
      row(["20260930", "Organic Search", "google", "organic"], [60, 50, 20, 40, 2000, 0, 0, 0, 0]),
      row(["(other)", "x", "y", "z"], [9, 9, 9, 9, 9, 9, 9, 9, 9]), // ligne sans date : ignorée
    ],
  };
  const rows = ga4ChannelRows(report, 2);
  assert.equal(rows.length, 4);
  const google = rows.find((r) => r.date === "2026-09-29" && r.source === "google");
  assert.deepEqual(
    { ...google },
    { date: "2026-09-29", channel: "Organic Search", source: "google", medium: "organic", sessions: 50, users: 40, new_users: 30, engaged_sessions: 35, engagement_seconds: 1800, key_events: 2, purchases: 1, revenue: 165 },
  );
  // purchaseRevenue nul : repli sur totalRevenue
  assert.equal(rows.find((r) => r.source === "facebook").revenue, 90);
  // les deux petits référents sont fusionnés par jour et par canal, sans perdre de session
  const other = rows.find((r) => r.source === OTHER);
  assert.deepEqual([other.channel, other.medium, other.sessions, other.users], ["Referral", OTHER, 3, 3]);
  assert.equal(rows.reduce((s, r) => s + r.sessions, 0), 143);
});

test("GA4 : totaux, appareils, pays et pages avec « (autres) »", () => {
  const totals = ga4DimRows({ rows: [row(["20260929"], [100, 80, 50, 60, 3000, 4, 2, 300, 300, 240]), row(["20260930"], [50, 40, 20, 20, 900, 0, 0, 0, 0, 90])] }, "total");
  assert.deepEqual([totals[0].dim, totals[0].value, totals[0].sessions, totals[0].pageviews], ["total", "", 100, 240]);
  const devices = ga4DimRows({ rows: [row(["20260929", "mobile"], [70, 0, 0, 0, 0, 0, 0, 0, 0, 0]), row(["20260929", ""], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0])] }, "device");
  assert.deepEqual(devices.map((d) => d.value), ["mobile", "(not set)"]);
  const countries = ga4DimRows(
    { rows: [row(["20260929", "France"], [80, 0, 0, 0, 0, 0, 0, 0, 0, 0]), row(["20260929", "Belgium"], [5, 0, 0, 0, 0, 0, 0, 0, 0, 0]), row(["20260929", "Chile"], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0])] },
    "country",
    1,
  );
  assert.deepEqual(countries.map((c) => [c.value, c.sessions]).sort(), [["(autres)", 6], ["France", 80]]);

  assert.deepEqual(ga4TopPages({ rows: [row(["/"], [10]), row([""], [3]), row(["/panier"], [2])] }), ["/", "/panier"]);
  const pages = ga4PageRows({ rows: [row(["20260929", "/"], [40, 30, 1]), row(["20260929", "/panier"], [20, 18, 2]), row(["20260930", "/"], [50, 20, 0])] }, totals);
  const rest = pages.find((p) => p.date === "2026-09-29" && p.page === OTHER);
  // reste du jour = total moins les pages gardées
  assert.deepEqual([rest.sessions, rest.engaged_sessions, rest.key_events], [40, 12, 1]);
  // jour où les pages gardées couvrent tout : pas de ligne « (autres) »
  assert.equal(pages.some((p) => p.date === "2026-09-30" && p.page === OTHER), false);
  assert.equal(pages.filter((p) => p.date === "2026-09-29").reduce((s, p) => s + p.sessions, 0), 100);
});

test("GA4 : erreurs expliquées (API non activée, accès, quota, jeton)", () => {
  const disabled = explainGa4Error(403, {
    error: {
      code: 403,
      status: "PERMISSION_DENIED",
      message: "Google Analytics Data API has not been used in project 123 before or it is disabled.",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata: { service: "analyticsdata.googleapis.com" } }],
    },
  });
  assert.equal(disabled.code, "api_disabled");
  assert.match(disabled.message, /Google Analytics Data API/);
  assert.match(explainGa4Error(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED", metadata: { service: "analyticsadmin.googleapis.com" } }] } }).message, /Admin API/);
  assert.equal(explainGa4Error(403, { error: { status: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." } }).code, "access");
  const quota = explainGa4Error(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Exhausted property tokens per hour for a project." } });
  assert.equal(quota.code, "quota");
  assert.match(quota.message, /horaire/);
  assert.equal(explainGa4Error(401, { error: { status: "UNAUTHENTICATED" } }).code, "token");
  assert.equal(explainGa4Error(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }).code, "scope");
  assert.equal(explainGa4Error(503, null).code, "unavailable");
  assert.equal(explainGa4Error(400, { error: { status: "INVALID_ARGUMENT", message: "Field keyEvents:x is not a valid metric" } }).code, "request");
});

// ---------------------------------------------------------------------
// Clarity
// ---------------------------------------------------------------------
// Réponse réelle du 1er octobre 2026 pour un projet sans trafic sur 24 h : neuf blocs, tous vides.
const EMPTY = ["DeadClickCount", "ExcessiveScroll", "RageClickCount", "QuickbackClick", "ScriptErrorCount", "ErrorClickCount", "ScrollDepth", "Traffic", "EngagementTime"].map((metricName) => ({ metricName, information: [] }));

const friction = (sessions, pct, sub, dims) => ({ sessionsCount: String(sessions), sessionsWithMetricPercentage: pct, sessionsWithoutMetricPercentage: 100 - pct, pagesViews: String(sub), subTotal: String(sub), ...dims });
// Forme documentée (learn.microsoft.com) et reprise du code de Microsoft (microsoft/Analytics-Hub)
const deviceBlocks = [
  { metricName: "DeadClickCount", information: [friction(200, 15, 95, { Device: "Mobile" }), friction(100, 4, 6, { Device: "PC" })] },
  { metricName: "RageClickCount", information: [friction(200, 2.5, 9, { Device: "Mobile" }), friction(100, 0, 0, { Device: "PC" })] },
  { metricName: "QuickbackClick", information: [friction(200, 3, 7, { Device: "Mobile" })] },
  { metricName: "ExcessiveScroll", information: [friction(200, 1, 2, { Device: "Mobile" })] },
  { metricName: "ScriptErrorCount", information: [friction(200, 0, 0, { Device: "Mobile" })] },
  { metricName: "ErrorClickCount", information: [friction(200, 0.5, 1, { Device: "Mobile" })] },
  { metricName: "ScrollDepth", information: [{ averageScrollDepth: 55.5, Device: "Mobile" }, { averageScrollDepth: 70, Device: "PC" }] },
  {
    metricName: "Traffic",
    information: [
      { totalSessionCount: "200", totalBotSessionCount: "14", distinctUserCount: "180", pagesPerSessionPercentage: 1.88, Device: "Mobile" },
      // variante de l'exemple de la doc : « distantUserCount », « PagesPerSessionPercentage »
      { totalSessionCount: "100", totalBotSessionCount: "3", distantUserCount: "90", PagesPerSessionPercentage: 2.5, Device: "PC" },
    ],
  },
  { metricName: "EngagementTime", information: [{ totalTime: "247", activeTime: "120", Device: "Mobile" }, { totalTime: "300", activeTime: "150", Device: "PC" }] },
];

test("Clarity : réponse vide (projet sans trafic) : aucune ligne, aucune erreur", () => {
  for (const c of CLARITY_CALLS) assert.deepEqual(clarityRows(EMPTY, c.scope), []);
  assert.deepEqual(clarityRows(null, "device"), []);
});

test("Clarity : lignes par appareil", () => {
  const rows = clarityRows(deviceBlocks, "device");
  assert.equal(rows.length, 2);
  const m = rows[0];
  assert.deepEqual([m.scope, m.key, m.device, m.sessions, m.bot_sessions, m.users], ["device", "Mobile", "", 200, 14, 180]);
  assert.deepEqual([m.dead_clicks, m.dead_sessions, m.rage_clicks, m.rage_sessions], [95, 30, 9, 5]);
  assert.deepEqual([m.quickbacks, m.quickback_sessions, m.excessive_sessions, m.script_error_sessions, m.error_click_sessions], [7, 6, 2, 0, 1]);
  assert.deepEqual([m.scroll_depth, m.total_time, m.active_time, m.pages_per_session], [55.5, 247, 120, 1.88]);
  const pc = rows[1];
  assert.deepEqual([pc.key, pc.users, pc.pages_per_session, pc.dead_sessions, pc.rage_sessions], ["PC", 90, 2.5, 4, 0]);
});

test("Clarity : pages × appareil, variantes d'URL fusionnées et moyennes pondérées", () => {
  const blocks = [
    {
      metricName: "Traffic",
      information: [
        { totalSessionCount: "60", totalBotSessionCount: "0", distinctUserCount: "50", pagesPerSessionPercentage: 2, Url: "https://Site.fr/panier?utm_source=meta", Device: "Mobile" },
        { totalSessionCount: "40", totalBotSessionCount: "0", distinctUserCount: "35", pagesPerSessionPercentage: 3, Url: "https://site.fr/panier/", Device: "Mobile" },
        { totalSessionCount: "30", totalBotSessionCount: "0", distinctUserCount: "30", pagesPerSessionPercentage: 1, Url: "https://site.fr/panier", Device: "PC" },
        { totalSessionCount: "500", totalBotSessionCount: "0", distinctUserCount: "400", pagesPerSessionPercentage: 1.5, Url: "https://site.fr/", Device: "Mobile" },
      ],
    },
    {
      metricName: "RageClickCount",
      information: [friction(60, 10, 14, { Url: "https://Site.fr/panier?utm_source=meta", Device: "Mobile" }), friction(40, 5, 3, { Url: "https://site.fr/panier/", Device: "Mobile" })],
    },
    { metricName: "ScrollDepth", information: [{ averageScrollDepth: 80, Url: "https://Site.fr/panier?utm_source=meta", Device: "Mobile" }, { averageScrollDepth: 60, Url: "https://site.fr/panier/", Device: "Mobile" }] },
  ];
  const rows = clarityRows(blocks, "page");
  assert.deepEqual(rows.map((r) => `${r.key} ${r.device} ${r.sessions}`), ["https://site.fr/ Mobile 500", "https://site.fr/panier Mobile 100", "https://site.fr/panier PC 30"]);
  const cart = rows[1];
  assert.deepEqual([cart.rage_clicks, cart.rage_sessions, cart.users], [17, 8, 85]); // 60 × 10 % + 40 × 5 %
  near(cart.scroll_depth, 72); // (80 × 60 + 60 × 40) / 100
  near(cart.pages_per_session, 2.4);
  // seules les `limit` premières lignes en sessions sont gardées
  assert.equal(clarityRows(blocks, "page", 1).length, 1);
  assert.equal(normalizeUrl("https://Site.fr/Produits/Lampe/?a=1#top"), "https://site.fr/Produits/Lampe");
  assert.equal(normalizeUrl("https://site.fr"), "https://site.fr/");
});

test("Clarity : sessions de repli quand le bloc Traffic manque", () => {
  const rows = clarityRows([{ metricName: "DeadClickCount", information: [friction(80, 25, 30, { Channel: "PaidSocial" })] }], "channel");
  assert.deepEqual([rows[0].key, rows[0].sessions, rows[0].dead_sessions], ["PaidSocial", 80, 20]);
});

test("Clarity : plan de synchro (un instantané par jour, quota préservé)", () => {
  // cron de 5 h UTC : l'instantané de 24 h est rangé à la veille
  assert.equal(claritySnapshotDate(new Date("2026-10-02T05:00:00Z")), "2026-10-01");
  // première synchro : pas d'historique possible, un seul jour
  assert.deepEqual(clarityPlan(new Date("2026-10-02T05:00:00Z"), null), { skip: false, numOfDays: 1, dates: ["2026-10-01"] });
  // lendemain : un jour, le suivant
  assert.deepEqual(clarityPlan(new Date("2026-10-03T05:00:00Z"), "2026-10-02T05:00:00Z"), { skip: false, numOfDays: 1, dates: ["2026-10-02"] });
  // clic sur « Synchroniser » deux heures après le cron : aucune requête dépensée
  const again = clarityPlan(new Date("2026-10-02T07:00:00Z"), "2026-10-02T05:00:00Z");
  assert.equal(again.skip, true);
  assert.equal(again.nextAt, "2026-10-02T13:00:00.000Z");
  // au pire 3 synchros de 3 requêtes par 24 h : 9 requêtes sur les 10 autorisées
  assert.ok((24 / CLARITY_MIN_INTERVAL_H) * CLARITY_CALLS.length <= 10);
  // synchro manuelle l'après-midi : l'instantané du jour, que le cron suivant remplacera
  assert.deepEqual(clarityPlan(new Date("2026-10-02T15:00:00Z"), "2026-10-02T05:00:00Z"), { skip: false, numOfDays: 1, dates: ["2026-10-02"] });
  // un cron manqué : agrégat de 48 h réparti sur les deux jours sans instantané
  assert.deepEqual(clarityPlan(new Date("2026-10-04T05:00:00Z"), "2026-10-02T05:00:00Z"), { skip: false, numOfDays: 2, dates: ["2026-10-02", "2026-10-03"] });
  // longue panne : 3 jours au plus (limite de l'API), les jours plus anciens sont perdus
  assert.deepEqual(clarityPlan(new Date("2026-10-10T05:00:00Z"), "2026-10-02T05:00:00Z"), { skip: false, numOfDays: 3, dates: ["2026-10-07", "2026-10-08", "2026-10-09"] });
  // jamais le jour d'un instantané déjà pris
  const p = clarityPlan(new Date("2026-10-03T20:00:00Z"), "2026-10-02T13:00:00Z");
  assert.deepEqual(p, { skip: false, numOfDays: 1, dates: ["2026-10-03"] });
});

test("Clarity : répartition d'un agrégat de plusieurs jours", () => {
  const [mobile] = clarityDailyShare(clarityRows(deviceBlocks, "device"), 2);
  assert.deepEqual([mobile.sessions, mobile.dead_clicks, mobile.dead_sessions, mobile.rage_sessions], [100, 47.5, 15, 2.5]);
  // les moyennes ne sont pas divisées
  assert.deepEqual([mobile.scroll_depth, mobile.active_time], [55.5, 120]);
  assert.equal(clarityDailyShare(clarityRows(deviceBlocks, "device"), 1)[0].sessions, 200);
});

test("Clarity : jeton, identifiant de projet et liens", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = (payload) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJl`;
  const now = new Date("2026-10-01T00:00:00Z");
  const ok = clarityTokenInfo(jwt({ scope: "Data.Export", iss: "clarity", exp: 1900000000 }), now);
  assert.deepEqual([ok.ok, ok.exp], [true, "2030-03-17T17:46:40.000Z"]);
  assert.equal(clarityTokenInfo(jwt({ scope: "Data.Export", exp: 1700000000 }), now).ok, false); // expiré
  assert.equal(clarityTokenInfo("pas-un-jeton", now).ok, false);
  assert.equal(clarityTokenInfo(jwt({ scope: "Project.Read" }), now).ok, false);
  assert.equal(clarityProjectId("https://clarity.microsoft.com/projects/view/3t0wlogvdz/dashboard?date=Last%203%20days"), "3t0wlogvdz");
  assert.equal(clarityProjectId("  3t0wlogvdz "), "3t0wlogvdz");
  assert.equal(isClarityProjectId("3t0wlogvdz"), true);
  assert.equal(isClarityProjectId("../x"), false);
  assert.deepEqual(clarityLinks("3t0wlogvdz"), {
    dashboard: "https://clarity.microsoft.com/projects/view/3t0wlogvdz/dashboard",
    recordings: "https://clarity.microsoft.com/projects/view/3t0wlogvdz/impressions",
    heatmaps: "https://clarity.microsoft.com/projects/view/3t0wlogvdz/heatmaps",
  });
});

// ---------------------------------------------------------------------
// Calculs
// ---------------------------------------------------------------------
const P = { start: "2026-09-03", end: "2026-09-04", prevStart: "2026-09-01", prevEnd: "2026-09-02" };
const gaDay = (d, sessions, engaged, key, revenue) => ({ d, sessions, users: sessions, new_users: 0, engaged, engagement_s: sessions * 30, key_events: key, purchases: key, revenue, pageviews: sessions * 2 });

test("calculs GA4 : taux de conversion, taux d'engagement, séries", () => {
  const daily = [gaDay("2026-09-01", 100, 40, 1, 50), gaDay("2026-09-02", 100, 60, 3, 150), gaDay("2026-09-03", 200, 120, 6, 600), gaDay("2026-09-04", 300, 150, 4, 400)];
  const { cur, prev } = ga4Split(daily, P);
  assert.deepEqual([cur.sessions, cur.key_events, cur.revenue, prev.sessions, prev.key_events], [500, 10, 1000, 200, 4]);
  assert.equal(siteKpi(cur, "conversion_rate"), 2); // 10 évènements clés pour 500 sessions
  assert.equal(siteKpi(cur, "engagement_rate"), 54);
  assert.equal(siteKpi(cur, "engagement_time"), 30);
  assert.equal(siteKpi({ ...cur, sessions: 0 }, "conversion_rate"), null); // jamais de division par zéro
  assert.equal(rate(1, 0), null);
  assert.equal(fmtSiteKpi("conversion_rate", 2), "2,00\u00a0%");
  assert.equal(fmtDuration(84), "1\u00a0min\u00a024\u00a0s");
  assert.deepEqual(daysBetween("2026-02-27", "2026-03-01"), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  const s = ga4Series(daily, P, "conversion_rate");
  assert.deepEqual(s.sessions, [200, 300]);
  near(s.values[0], 3);
  near(s.prev[0], 1); // même rang dans la période précédente
  // jour sans donnée : valeur absente, pas zéro
  assert.equal(ga4Series(daily, { ...P, end: "2026-09-05" }, "conversion_rate").values[2], null);
});

test("calculs GA4 : canaux payants et libellés", () => {
  const ch = (channel, sessions, key_events) => ({ channel, sessions, users: 0, new_users: 0, engaged: 0, key_events, purchases: 0, revenue: key_events * 100, prev_sessions: 0, prev_key_events: 0, prev_revenue: 0 });
  const channels = [ch("Paid Social", 400, 12), ch("Cross-network", 100, 5), ch("Organic Search", 300, 9), ch("Display", 20, 0), ch("Direct", 80, 4)];
  assert.deepEqual(paidTotals(channels), { sessions: 520, key_events: 17, revenue: 1700 });
  assert.equal(isPaidChannel("Organic Social"), false);
  assert.equal(channelName("Paid Social"), "Réseaux sociaux payants");
  assert.equal(channelName("PaidSocial"), "Réseaux sociaux payants"); // variante Clarity
  assert.equal(channelName("Canal maison"), "Canal maison");
  const top = topChannels(channels, 3);
  assert.deepEqual(top.map((c) => [c.channel, c.sessions]), [["Paid Social", 400], ["Organic Search", 300], ["Autres", 200]]);

  const gaps = conversionGaps({ platformConversions: 30, platformValue: 3000, ga4: { channels }, ga4Totals: { sessions: 900, key_events: 30 }, firstParty: { purchases: 36, revenue: 4000, leads: 0 } });
  assert.match(gaps[0], /déclarent 30 conversions, GA4 en attribue 17 aux canaux payants \(57\s%\)/);
  assert.match(gaps[1], /first-party mesure 36 ventes, soit 20\s% de plus que GA4/);
  // GA4 au-dessus des plateformes : autre explication
  assert.match(conversionGaps({ platformConversions: 10, platformValue: 0, ga4: { channels }, ga4Totals: { sessions: 900, key_events: 30 }, firstParty: null })[0], /plus que les 10 conversions/);
  assert.deepEqual(conversionGaps({ platformConversions: 0, platformValue: 0, ga4: null, ga4Totals: null, firstParty: null }), []);
});

const page = (url, device, sessions, rage, dead, extra = {}) => ({
  url, device, sessions, dead_clicks: dead * 2, dead_sessions: dead, rage_clicks: rage * 3, rage_sessions: rage, quickbacks: 0, quickback_sessions: 0,
  excessive_scrolls: 0, excessive_sessions: 0, script_errors: 0, script_error_sessions: 0, error_clicks: 0, error_click_sessions: 0, scroll_depth: 60, active_time: 50, ...extra,
});
const PAGES = [
  page("https://site.fr/", "Mobile", 1000, 4, 40),
  page("https://site.fr/", "PC", 400, 1, 12),
  page("https://site.fr/panier", "Mobile", 300, 27, 12),
  page("https://site.fr/panier", "PC", 100, 1, 3),
  page("https://site.fr/produits/lampe", "Mobile", 500, 2, 85),
  page("https://site.fr/mentions-legales", "Mobile", 10, 3, 4), // trop peu visitée pour être classée
];

test("calculs Clarity : taux de friction et totaux pondérés", () => {
  const day = (d, sessions, rage, scroll) => ({ ...page("", "", sessions, rage, 0), d, users: sessions, scroll_depth: scroll, total_time: null, pages_per_session: null, window_days: 1 });
  const t = clarityTotals([day("2026-09-03", 100, 2, 40), day("2026-09-04", 300, 10, 60), day("2026-09-10", 999, 999, 99)], "2026-09-03", "2026-09-04");
  assert.deepEqual([t.sessions, t.rage_sessions, t.days], [400, 12, 2]);
  assert.equal(frictionRate(t, "rage"), 3); // 12 sessions avec clics de rage sur 400
  near(t.scroll_depth, 55); // (40 × 100 + 60 × 300) / 400
  assert.equal(frictionRate({ ...t, sessions: 0 }, "rage"), null);
});

test("calculs Clarity : pages à problèmes classées par taux de clics de rage ou morts", () => {
  const list = problemPages(PAGES);
  assert.deepEqual(list.map((p) => p.path), ["/produits/lampe", "/panier", "/"]);
  const cart = list[1];
  assert.equal(cart.sessions, 400);
  near(cart.rage_rate, 7); // 28 sessions sur 400
  near(cart.friction_rate, 10.75); // (28 + 15) / 400
  near(cart.rage_share, (28 / 38) * 100); // part des clics de rage du site
  assert.deepEqual(cart.devices.map((d) => d.device), ["Mobile", "PC"]);
});

test("constats en clair : page qui concentre les clics de rage sur mobile", () => {
  const daily = [{ ...page("", "", 1200, 19, 78), d: "2026-09-03", users: 1000, total_time: null, pages_per_session: null, window_days: 1 }, { ...page("", "", 1110, 19, 78), d: "2026-09-04", users: 1000, total_time: null, pages_per_session: null, window_days: 1 }];
  const devices = [{ ...page("", "", 1810, 36, 141), device: "Mobile", users: 0 }, { ...page("", "", 500, 2, 15), device: "PC", users: 0 }];
  const channels = [
    { channel: "PaidSocial", sessions: 1500, dead_sessions: 0, rage_sessions: 0, quickback_sessions: 120, script_error_sessions: 0, scroll_depth: 50, active_time: 40 },
    { channel: "OrganicSearch", sessions: 800, dead_sessions: 0, rage_sessions: 0, quickback_sessions: 16, script_error_sessions: 0, scroll_depth: 60, active_time: 70 },
  ];
  const texts = clarityInsights({ sources: [], first_day: "2026-09-03", last_day: "2026-09-04", synced_at: null, daily, devices, pages: PAGES, channels }, P).map((i) => i.text);
  assert.match(texts[0], /^La page \/panier concentre 74\s% des clics de rage, à 96\s% sur mobile : 7,0\s% des sessions/);
  assert.ok(texts.some((t) => /^Sur \/produits\/lampe, 17\s% des sessions comportent des clics morts/.test(t)));
  assert.ok(texts.some((t) => /plus fréquents sur mobile \(2,0\s% des sessions\) que sur ordinateur \(0,4\s%\)/.test(t)));
  assert.ok(texts.some((t) => /Le trafic « Réseaux sociaux payants » revient en arrière dans 8,0\s% des sessions/.test(t)));
  // aucun tiret long, jamais
  assert.ok(texts.every((t) => !t.includes("\u2014")));
  // sans donnée sur la période : aucun constat
  assert.deepEqual(clarityInsights({ sources: [], first_day: null, last_day: null, synced_at: null, daily: [], devices: [], pages: [], channels: [] }, P), []);
});
