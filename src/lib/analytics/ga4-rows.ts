// Google Analytics 4 : requêtes de la Data API et transformation des réponses en lignes.
// Pur (aucun import d'exécution) : utilisé par la synchro et par les tests
// (node --experimental-strip-types --test src/lib/analytics/tests/analytics.test.mjs).

// ---------------------------------------------------------------------
// Fenêtre de synchro : 90 jours à la première synchro, puis 7 jours glissants
// réécrits à chaque passage (GA4 retraite les derniers jours : attribution,
// évènements arrivés en retard, données « (other) » consolidées).
// ---------------------------------------------------------------------
export const GA4_FIRST_SYNC_DAYS = 90;
export const GA4_ROLLING_DAYS = 7;

const isoUTC = (d: Date) => d.toISOString().slice(0, 10);

export function ga4Window(now: Date, firstSyncedAt: string | null | undefined, full = false) {
  const n = full || !firstSyncedAt ? GA4_FIRST_SYNC_DAYS : GA4_ROLLING_DAYS;
  return { since: isoUTC(new Date(now.getTime() - n * 864e5)), until: isoUTC(now), days: n, full: full || !firstSyncedAt };
}

// ---------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------
/** Nom d'évènement GA4 valide (lettres, chiffres, tiret bas, 40 caractères au plus). */
export const isEventName = (s: string | null | undefined): s is string => !!s && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(s);

/** Métrique « évènements clés » : tous, ou un seul évènement clé (keyEvents:purchase). */
export const keyEventMetric = (keyEvent?: string | null) => (isEventName(keyEvent) ? `keyEvents:${keyEvent}` : "keyEvents");

const BASE_METRICS = ["sessions", "totalUsers", "newUsers", "engagedSessions", "userEngagementDuration"];
const REVENUE_METRICS = ["ecommercePurchases", "purchaseRevenue", "totalRevenue"];

export const GA4_TOP_PAGES = 50;
export const GA4_TOP_SOURCES = 40;
export const GA4_TOP_COUNTRIES = 15;
const ROW_LIMIT = 100000;

export interface Ga4Request {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  limit?: number;
  orderBys?: unknown[];
  dimensionFilter?: unknown;
  keepEmptyRows?: boolean;
}

const names = (list: string[]) => list.map((name) => ({ name }));

/**
 * Les cinq rapports d'un appel batchRunReports (5 au plus par appel) :
 * 0 totaux par jour, 1 jour × canal × source / medium, 2 jour × appareil, 3 jour × pays,
 * 4 principales pages de destination de la fenêtre (sans la date).
 */
export function ga4BatchRequests(since: string, until: string, keyEvent?: string | null): Ga4Request[] {
  const dateRanges = [{ startDate: since, endDate: until }];
  const metrics = names([...BASE_METRICS, keyEventMetric(keyEvent), ...REVENUE_METRICS]);
  return [
    { dateRanges, dimensions: names(["date"]), metrics: [...metrics, { name: "screenPageViews" }], limit: ROW_LIMIT },
    { dateRanges, dimensions: names(["date", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium"]), metrics, limit: ROW_LIMIT },
    { dateRanges, dimensions: names(["date", "deviceCategory"]), metrics: [...metrics, { name: "screenPageViews" }], limit: ROW_LIMIT },
    { dateRanges, dimensions: names(["date", "country"]), metrics: [...metrics, { name: "screenPageViews" }], limit: ROW_LIMIT },
    {
      dateRanges,
      dimensions: names(["landingPage"]),
      metrics: names(["sessions"]),
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: GA4_TOP_PAGES,
    },
  ];
}

/** Rapport jour × page de destination, limité aux principales pages (une seule requête). */
export function ga4PagesRequest(since: string, until: string, pages: string[], keyEvent?: string | null): Ga4Request {
  return {
    dateRanges: [{ startDate: since, endDate: until }],
    dimensions: names(["date", "landingPage"]),
    metrics: names(["sessions", "engagedSessions", keyEventMetric(keyEvent)]),
    dimensionFilter: { filter: { fieldName: "landingPage", inListFilter: { values: pages, caseSensitive: true } } },
    limit: ROW_LIMIT,
  };
}

// ---------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------
export interface Ga4Report {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
  metadata?: { currencyCode?: string; timeZone?: string; dataLossFromOtherRow?: boolean };
}

export interface Ga4Metrics {
  sessions: number;
  users: number;
  new_users: number;
  engaged_sessions: number;
  engagement_seconds: number;
  key_events: number;
  purchases: number;
  revenue: number;
}
export interface Ga4ChannelRow extends Ga4Metrics {
  date: string;
  channel: string;
  source: string;
  medium: string;
}
export interface Ga4DimRow extends Ga4Metrics {
  date: string;
  dim: "total" | "device" | "country";
  value: string;
  pageviews: number;
}
export interface Ga4PageRow {
  date: string;
  page: string;
  sessions: number;
  engaged_sessions: number;
  key_events: number;
}

export const OTHER = "(autres)";
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** « 20260929 » → « 2026-09-29 » (null si la valeur n'est pas une date GA4). */
export function ga4Date(v: string | undefined): string | null {
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
}

type Row = NonNullable<Ga4Report["rows"]>[number];
const dim = (r: Row, i: number) => (r.dimensionValues?.[i]?.value ?? "").trim();
const met = (r: Row, i: number) => num(r.metricValues?.[i]?.value);

/** Métriques communes, dans l'ordre de ga4BatchRequests. Revenu = achats e-commerce, sinon revenu total. */
function metrics(r: Row): Ga4Metrics {
  const purchaseRevenue = met(r, 7);
  return {
    sessions: Math.round(met(r, 0)),
    users: Math.round(met(r, 1)),
    new_users: Math.round(met(r, 2)),
    engaged_sessions: Math.round(met(r, 3)),
    engagement_seconds: Math.round(met(r, 4)),
    key_events: r2(met(r, 5)),
    purchases: r2(met(r, 6)),
    revenue: r2(purchaseRevenue > 0 ? purchaseRevenue : met(r, 8)),
  };
}

function addInto<T extends Ga4Metrics>(a: T, b: Ga4Metrics) {
  a.sessions += b.sessions;
  a.users += b.users;
  a.new_users += b.new_users;
  a.engaged_sessions += b.engaged_sessions;
  a.engagement_seconds += b.engagement_seconds;
  a.key_events = r2(a.key_events + b.key_events);
  a.purchases = r2(a.purchases + b.purchases);
  a.revenue = r2(a.revenue + b.revenue);
}

/**
 * Jour × canal × source / medium. Seules les `maxSources` principales paires source / medium de la
 * fenêtre (en sessions) sont gardées telles quelles : les autres sont regroupées par jour et par canal
 * sous « (autres) », ce qui borne le nombre de lignes sans perdre de sessions.
 */
export function ga4ChannelRows(report: Ga4Report | undefined, maxSources = GA4_TOP_SOURCES): Ga4ChannelRow[] {
  const parsed: Ga4ChannelRow[] = [];
  for (const r of report?.rows ?? []) {
    const date = ga4Date(dim(r, 0));
    if (!date) continue;
    parsed.push({ date, channel: dim(r, 1) || "Unassigned", source: dim(r, 2) || "(not set)", medium: dim(r, 3) || "(not set)", ...metrics(r) });
  }
  const volume = new Map<string, number>();
  for (const r of parsed) volume.set(`${r.source}\n${r.medium}`, (volume.get(`${r.source}\n${r.medium}`) ?? 0) + r.sessions);
  const keep = new Set([...volume.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxSources).map(([k]) => k));
  const out = new Map<string, Ga4ChannelRow>();
  for (const r of parsed) {
    const kept = keep.has(`${r.source}\n${r.medium}`);
    const row = kept ? r : { ...r, source: OTHER, medium: OTHER };
    const k = `${row.date}|${row.channel}|${row.source}|${row.medium}`;
    const cur = out.get(k);
    if (cur) addInto(cur, row);
    else out.set(k, { ...row });
  }
  return [...out.values()];
}

/** Jour × dimension simple. Pour les pays, seuls les principaux sont gardés, le reste regroupé. */
export function ga4DimRows(report: Ga4Report | undefined, kind: Ga4DimRow["dim"], maxValues = GA4_TOP_COUNTRIES): Ga4DimRow[] {
  const parsed: Ga4DimRow[] = [];
  for (const r of report?.rows ?? []) {
    const date = ga4Date(dim(r, 0));
    if (!date) continue;
    const value = kind === "total" ? "" : dim(r, 1) || "(not set)";
    parsed.push({ date, dim: kind, value, ...metrics(r), pageviews: Math.round(met(r, 9)) });
  }
  if (kind !== "country") return parsed;
  const volume = new Map<string, number>();
  for (const r of parsed) volume.set(r.value, (volume.get(r.value) ?? 0) + r.sessions);
  const keep = new Set([...volume.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxValues).map(([k]) => k));
  const out = new Map<string, Ga4DimRow>();
  for (const r of parsed) {
    const row = keep.has(r.value) ? r : { ...r, value: OTHER };
    const k = `${row.date}|${row.value}`;
    const cur = out.get(k);
    if (cur) {
      addInto(cur, row);
      cur.pageviews += row.pageviews;
    } else out.set(k, { ...row });
  }
  return [...out.values()];
}

const PAGE_MAX = 300;
const pageKey = (p: string) => (p || "(not set)").slice(0, PAGE_MAX);

/** Principales pages de destination de la fenêtre (rapport sans date, trié par sessions). */
export function ga4TopPages(report: Ga4Report | undefined): string[] {
  return (report?.rows ?? []).map((r) => dim(r, 0)).filter((p) => p !== "");
}

/**
 * Jour × page de destination pour les principales pages, plus une ligne « (autres) » par jour :
 * le total du jour moins les pages gardées (jamais négatif).
 */
export function ga4PageRows(report: Ga4Report | undefined, totals: Ga4DimRow[]): Ga4PageRow[] {
  const out = new Map<string, Ga4PageRow>();
  const sums = new Map<string, { sessions: number; engaged: number; key: number }>();
  for (const r of report?.rows ?? []) {
    const date = ga4Date(dim(r, 0));
    if (!date) continue;
    const row: Ga4PageRow = { date, page: pageKey(dim(r, 1)), sessions: Math.round(met(r, 0)), engaged_sessions: Math.round(met(r, 1)), key_events: r2(met(r, 2)) };
    const k = `${date}|${row.page}`;
    const cur = out.get(k);
    if (cur) {
      cur.sessions += row.sessions;
      cur.engaged_sessions += row.engaged_sessions;
      cur.key_events = r2(cur.key_events + row.key_events);
    } else out.set(k, row);
    const s = sums.get(date) ?? { sessions: 0, engaged: 0, key: 0 };
    s.sessions += row.sessions;
    s.engaged += row.engaged_sessions;
    s.key += row.key_events;
    sums.set(date, s);
  }
  const rows = [...out.values()];
  for (const t of totals) {
    if (t.dim !== "total") continue;
    const s = sums.get(t.date) ?? { sessions: 0, engaged: 0, key: 0 };
    const rest = t.sessions - s.sessions;
    if (rest <= 0) continue;
    rows.push({ date: t.date, page: OTHER, sessions: rest, engaged_sessions: Math.max(0, Math.min(rest, t.engaged_sessions - s.engaged)), key_events: Math.max(0, r2(t.key_events - s.key)) });
  }
  return rows;
}

// ---------------------------------------------------------------------
// Erreurs de l'API Google (Data API et Admin API), expliquées en français
// ---------------------------------------------------------------------
export interface GoogleApiError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { "@type"?: string; reason?: string; metadata?: Record<string, string> }[];
  };
}

export type Ga4ErrorCode = "api_disabled" | "token" | "scope" | "access" | "quota" | "not_found" | "request" | "unavailable" | "unknown";

const API_NAME: Record<string, string> = {
  "analyticsdata.googleapis.com": "Google Analytics Data API",
  "analyticsadmin.googleapis.com": "Google Analytics Admin API",
};

export function explainGa4Error(status: number, body: GoogleApiError | null | undefined): { code: Ga4ErrorCode; message: string } {
  const e = body?.error;
  const msg = e?.message ?? "";
  const info = e?.details?.find((d) => d.reason);
  const reason = info?.reason ?? "";
  if (reason === "SERVICE_DISABLED" || /has not been used in project|it is disabled/i.test(msg)) {
    const service = info?.metadata?.service ?? (/admin/i.test(msg) ? "analyticsadmin.googleapis.com" : "analyticsdata.googleapis.com");
    return {
      code: "api_disabled",
      message: `L'API « ${API_NAME[service] ?? service} » n'est pas activée dans le projet Google Cloud du client OAuth. Active « Google Analytics Data API » et « Google Analytics Admin API » dans console.cloud.google.com > API et services > Bibliothèque, attends une minute, puis réessaie.`,
    };
  }
  if (reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || /insufficient authentication scopes/i.test(msg))
    return { code: "scope", message: "L'accès à Google Analytics n'a pas été accordé : reconnecte Google Analytics et coche l'autorisation de lecture des données Analytics." };
  if (status === 401 || e?.status === "UNAUTHENTICATED") return { code: "token", message: "Accès Google expiré ou révoqué : reconnecte Google Analytics dans Réglages > Connexions." };
  if (status === 429 || e?.status === "RESOURCE_EXHAUSTED") {
    const scope = /per day|daily/i.test(msg) ? " quotidien" : /per hour|hourly/i.test(msg) ? " horaire" : "";
    return {
      code: "quota",
      message: `Quota${scope} de l'API Google Analytics dépassé pour cette propriété. Les données déjà synchronisées restent affichées, la synchro reprendra au prochain passage${scope === " horaire" ? " (dans l'heure)" : ""}.`,
    };
  }
  if (status === 403 || e?.status === "PERMISSION_DENIED")
    return { code: "access", message: "Ce compte Google n'a pas accès à cette propriété GA4 (rôle Lecteur requis). Demande l'accès au client ou connecte un autre compte Google." };
  if (status === 404 || e?.status === "NOT_FOUND") return { code: "not_found", message: "Propriété GA4 introuvable : elle a peut-être été supprimée. Actualise la liste des propriétés." };
  if (status === 400 || e?.status === "INVALID_ARGUMENT") return { code: "request", message: `Google Analytics a refusé la requête : ${msg || "paramètre invalide"}` };
  if (status >= 500) return { code: "unavailable", message: "Google Analytics est momentanément indisponible. Réessaie dans quelques minutes." };
  return { code: "unknown", message: `Google Analytics : ${msg || `erreur ${status}`}` };
}
