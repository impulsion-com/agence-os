// Microsoft Clarity : plan de synchro et transformation des réponses de l'API Data Export en lignes.
// Pur (aucun import d'exécution) : utilisé par la synchro, l'interface et les tests
// (node --experimental-strip-types --test src/lib/analytics/tests/analytics.test.mjs).
//
// Forme des réponses (vérifiée le 1er octobre 2026) : un tableau de blocs
//   { metricName, information: [ { …valeurs, <dimension>: valeur } ] }
// avec, quand au moins une dimension est demandée, neuf blocs : DeadClickCount, ExcessiveScroll,
// RageClickCount, QuickbackClick, ScriptErrorCount, ErrorClickCount, ScrollDepth, Traffic, EngagementTime.
//  - blocs de friction : sessionsCount (sessions du segment), sessionsWithMetricPercentage (part des
//    sessions concernées), pagesViews (pages vues concernées), subTotal (nombre d'occurrences) ;
//  - ScrollDepth : averageScrollDepth (en %) ; EngagementTime : totalTime et activeTime (secondes, par session) ;
//  - Traffic : totalSessionCount, totalBotSessionCount, distinctUserCount (« distantUserCount » dans
//    l'exemple de la doc), pagesPerSessionPercentage (pages par session, malgré son nom).
// La clé d'une dimension porte son nom (Device, Channel, OS…), « Url » pour la dimension URL :
// les clés sont donc lues sans tenir compte de la casse.

export type ClarityDimension = "URL" | "Device" | "Channel" | "Source" | "Medium" | "Campaign" | "Browser" | "OS" | "Country/Region";

export interface ClarityMetricBlock {
  metricName: string;
  information?: Record<string, unknown>[];
}

export type ClarityScope = "page" | "device" | "channel";

/**
 * Les trois requêtes d'une synchro (sur les 10 autorisées par projet et par jour), de la plus
 * indispensable à la moins indispensable : les totaux par appareil portent les indicateurs du jour.
 */
export const CLARITY_CALLS: { scope: ClarityScope; dimensions: ClarityDimension[] }[] = [
  { scope: "device", dimensions: ["Device"] },
  { scope: "page", dimensions: ["URL", "Device"] },
  { scope: "channel", dimensions: ["Channel"] },
];

export interface ClarityRow {
  scope: ClarityScope;
  key: string;
  device: string;
  sessions: number;
  bot_sessions: number;
  users: number;
  pages_per_session: number | null;
  scroll_depth: number | null;
  total_time: number | null;
  active_time: number | null;
  dead_clicks: number;
  dead_sessions: number;
  rage_clicks: number;
  rage_sessions: number;
  quickbacks: number;
  quickback_sessions: number;
  excessive_scrolls: number;
  excessive_sessions: number;
  script_errors: number;
  script_error_sessions: number;
  error_clicks: number;
  error_click_sessions: number;
}

// ---------------------------------------------------------------------
// Plan de synchro
// ---------------------------------------------------------------------
// L'API ne renvoie qu'un agrégat des 24, 48 ou 72 dernières heures, sans découpage par jour, et
// n'accepte que 10 requêtes par projet et par jour. L'historique se construit donc ici : chaque
// synchro prend un instantané de 24 h et le range au jour qu'il couvre le plus (la date UTC de
// « maintenant moins 12 heures » : le cron de 5 h UTC range ainsi la veille).
//  - jamais deux synchros à moins de 8 heures d'écart : 3 synchros de 3 requêtes par 24 heures au plus ;
//  - un ou deux jours manqués (cron en panne) : un seul agrégat de 2 ou 3 jours, réparti à parts égales
//    sur les jours sans instantané (window_days > 1 signale ces jours reconstitués).
export const CLARITY_MIN_INTERVAL_H = 8;
export const CLARITY_REQUESTS_PER_SYNC = CLARITY_CALLS.length;

const DAY = 864e5;
const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
const dayNumber = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);

/** Jour auquel est rangé l'instantané des 24 heures qui se terminent à `now`. */
export const claritySnapshotDate = (now: Date) => isoUTC(new Date(now.getTime() - DAY / 2));

export type ClarityPlan =
  | { skip: true; reason: string; nextAt: string }
  | { skip: false; numOfDays: 1 | 2 | 3; dates: string[] };

export function clarityPlan(now: Date, lastSyncedAt: string | null | undefined): ClarityPlan {
  const label = claritySnapshotDate(now);
  const last = lastSyncedAt ? new Date(lastSyncedAt) : null;
  if (!last || Number.isNaN(last.getTime())) return { skip: false, numOfDays: 1, dates: [label] };
  const elapsed = now.getTime() - last.getTime();
  if (elapsed >= 0 && elapsed < CLARITY_MIN_INTERVAL_H * 3600e3) {
    return {
      skip: true,
      reason: `Clarity est déjà à jour (dernière synchro il y a moins de ${CLARITY_MIN_INTERVAL_H} h). Le quota de 10 requêtes par jour est préservé.`,
      nextAt: new Date(last.getTime() + CLARITY_MIN_INTERVAL_H * 3600e3).toISOString(),
    };
  }
  const missing = dayNumber(label) - dayNumber(claritySnapshotDate(last));
  const n = Math.max(1, Math.min(3, missing)) as 1 | 2 | 3;
  const end = dayNumber(label);
  const dates = Array.from({ length: n }, (_, i) => isoUTC(new Date((end - (n - 1 - i)) * DAY)));
  return { skip: false, numOfDays: n, dates };
}

// ---------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------
const lower = (row: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v;
  return out;
};
const n = (v: unknown) => {
  const x = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const nn = (v: unknown) => (v === null || v === undefined || v === "" ? null : n(v));
const text = (v: unknown) => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v));

/** URL sans paramètres ni ancre (les variantes ?utm=… d'une même page sont regroupées). */
export function normalizeUrl(raw: string): string {
  let u = raw.trim();
  const cut = u.search(/[?#]/);
  if (cut >= 0) u = u.slice(0, cut);
  const m = /^(https?:\/\/)([^/]+)(\/.*)?$/i.exec(u);
  if (m) {
    const path = (m[3] ?? "/").replace(/\/+$/, "") || "/";
    u = `${m[1].toLowerCase()}${m[2].toLowerCase()}${path}`;
  } else if (u.length > 1) u = u.replace(/\/+$/, "") || "/";
  return u.slice(0, 400);
}

type CountKey =
  | "sessions" | "bot_sessions" | "users"
  | "dead_clicks" | "dead_sessions" | "rage_clicks" | "rage_sessions" | "quickbacks" | "quickback_sessions"
  | "excessive_scrolls" | "excessive_sessions" | "script_errors" | "script_error_sessions" | "error_clicks" | "error_click_sessions";

const FRICTION: Record<string, readonly [count: CountKey, sessions: CountKey]> = {
  deadclickcount: ["dead_clicks", "dead_sessions"],
  rageclickcount: ["rage_clicks", "rage_sessions"],
  quickbackclick: ["quickbacks", "quickback_sessions"],
  excessivescroll: ["excessive_scrolls", "excessive_sessions"],
  scripterrorcount: ["script_errors", "script_error_sessions"],
  errorclickcount: ["error_clicks", "error_click_sessions"],
};

interface Acc extends ClarityRow {
  // sommes pondérées des moyennes (poids = sessions de la ligne brute)
  w_pages: number;
  w_scroll: number;
  w_total: number;
  w_active: number;
  s_pages: number;
  s_scroll: number;
  s_time: number;
  /** lignes brutes fusionnées dans cette clé */
  raw: Set<string>;
}

const blank = (scope: ClarityScope, key: string, device: string): Acc => ({
  scope, key, device,
  sessions: 0, bot_sessions: 0, users: 0, pages_per_session: null, scroll_depth: null, total_time: null, active_time: null,
  dead_clicks: 0, dead_sessions: 0, rage_clicks: 0, rage_sessions: 0, quickbacks: 0, quickback_sessions: 0,
  excessive_scrolls: 0, excessive_sessions: 0, script_errors: 0, script_error_sessions: 0, error_clicks: 0, error_click_sessions: 0,
  w_pages: 0, w_scroll: 0, w_total: 0, w_active: 0, s_pages: 0, s_scroll: 0, s_time: 0, raw: new Set(),
});

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Lignes d'une réponse pour une portée donnée :
 *  - page : clé = URL normalisée, device = appareil (dimensions URL + Device) ;
 *  - device : clé = appareil ; channel : clé = canal.
 * Les lignes brutes d'une même clé (variantes d'URL) sont fusionnées : les compteurs s'additionnent,
 * les moyennes sont pondérées par les sessions. Seules les `limit` premières lignes en sessions sont gardées.
 */
export function clarityRows(blocks: ClarityMetricBlock[] | null | undefined, scope: ClarityScope, limit = 200): ClarityRow[] {
  // 1. sessions de chaque ligne brute (bloc Traffic, sinon sessionsCount d'un bloc de friction)
  const rawKey = (row: Record<string, unknown>) => (scope === "page" ? `${text(row.url)}\n${text(row.device)}` : text(scope === "device" ? row.device : row.channel));
  const sessionsOf = new Map<string, number>();
  for (const b of blocks ?? []) {
    for (const info of b.information ?? []) {
      const row = lower(info);
      const s = Math.max(n(row.totalsessioncount), n(row.sessionscount));
      const k = rawKey(row);
      if (s > (sessionsOf.get(k) ?? 0)) sessionsOf.set(k, s);
    }
  }

  // 2. fusion par clé normalisée
  const acc = new Map<string, Acc>();
  for (const b of blocks ?? []) {
    const name = (b.metricName ?? "").toLowerCase();
    for (const info of b.information ?? []) {
      const row = lower(info);
      const main = scope === "page" ? text(row.url) : scope === "device" ? text(row.device) : text(row.channel);
      if (!main) continue;
      const key = scope === "page" ? normalizeUrl(main) : main;
      const device = scope === "page" ? text(row.device) : "";
      const id = `${key}\n${device}`;
      const a = acc.get(id) ?? blank(scope, key, device);
      acc.set(id, a);
      a.raw.add(rawKey(row));
      const weight = sessionsOf.get(rawKey(row)) ?? 0;

      if (name === "traffic") {
        a.sessions += n(row.totalsessioncount);
        a.bot_sessions += n(row.totalbotsessioncount);
        a.users += n(row.distinctusercount ?? row.distantusercount);
        const pps = nn(row.pagespersessionpercentage);
        if (pps !== null && weight > 0) {
          a.w_pages += pps * weight;
          a.s_pages += weight;
        }
      } else if (name === "scrolldepth") {
        const v = nn(row.averagescrolldepth);
        if (v !== null && weight > 0) {
          a.w_scroll += v * weight;
          a.s_scroll += weight;
        }
      } else if (name === "engagementtime") {
        const total = nn(row.totaltime);
        const active = nn(row.activetime);
        if ((total !== null || active !== null) && weight > 0) {
          a.w_total += (total ?? 0) * weight;
          a.w_active += (active ?? 0) * weight;
          a.s_time += weight;
        }
      } else if (FRICTION[name]) {
        const [count, sessions] = FRICTION[name];
        const base = n(row.sessionscount) || weight;
        a[count] += n(row.subtotal);
        a[sessions] += (base * n(row.sessionswithmetricpercentage)) / 100;
      }
    }
  }

  // 3. sessions de repli (bloc Traffic absent) et moyennes
  const out: ClarityRow[] = [];
  for (const a of acc.values()) {
    const { w_pages, w_scroll, w_total, w_active, s_pages, s_scroll, s_time, raw, ...row } = a;
    if (row.sessions === 0) for (const k of raw) row.sessions += sessionsOf.get(k) ?? 0;
    row.pages_per_session = s_pages > 0 ? r2(w_pages / s_pages) : null;
    row.scroll_depth = s_scroll > 0 ? r2(w_scroll / s_scroll) : null;
    row.total_time = s_time > 0 ? r2(w_total / s_time) : null;
    row.active_time = s_time > 0 ? r2(w_active / s_time) : null;
    // jamais plus de sessions concernées que de sessions
    for (const [, sessions] of Object.values(FRICTION)) row[sessions] = r2(Math.min(row[sessions], row.sessions));
    if (row.sessions > 0) out.push(row);
  }
  return out.sort((x, y) => y.sessions - x.sessions || x.key.localeCompare(y.key)).slice(0, limit);
}

const COUNTS: CountKey[] = [
  "sessions", "bot_sessions", "users", "dead_clicks", "dead_sessions", "rage_clicks", "rage_sessions", "quickbacks", "quickback_sessions",
  "excessive_scrolls", "excessive_sessions", "script_errors", "script_error_sessions", "error_clicks", "error_click_sessions",
];

/** Répartit un agrégat de plusieurs jours à parts égales (compteurs divisés, moyennes inchangées). */
export function clarityDailyShare(rows: ClarityRow[], days: number): ClarityRow[] {
  if (days <= 1) return rows;
  return rows.map((r) => {
    const out = { ...r };
    for (const k of COUNTS) out[k] = r2(r[k] / days);
    return out;
  });
}

// ---------------------------------------------------------------------
// Jeton et liens
// ---------------------------------------------------------------------
/** Identifiant de projet Clarity, tel qu'il apparaît dans l'URL du tableau de bord. */
export const isClarityProjectId = (s: string) => /^[a-z0-9]{6,24}$/i.test(s);

/** Extrait l'identifiant d'une URL Clarity collée (…/projects/view/<id>/…), sinon renvoie la saisie. */
export function clarityProjectId(input: string): string {
  const m = /projects\/view\/([a-z0-9]+)/i.exec(input);
  return (m ? m[1] : input).trim();
}

export interface ClarityTokenInfo {
  ok: boolean;
  /** Expiration lue dans le jeton (ISO), si elle y figure */
  exp: string | null;
  error?: string;
}

/**
 * Contrôle local d'un jeton API Clarity (un JWT), sans appeler l'API : chaque appel compte dans le
 * quota de 10 requêtes par jour. La validité réelle est confirmée par la première synchro.
 */
export function clarityTokenInfo(token: string, now = new Date()): ClarityTokenInfo {
  const parts = token.trim().split(".");
  const bad: ClarityTokenInfo = { ok: false, exp: null, error: "Ce texte ne ressemble pas à un jeton API Clarity. Copie le jeton complet généré dans Clarity > Settings > Data Export." };
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return bad;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { exp?: number; scope?: string; aud?: string };
    const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
    if (payload.scope && !/export/i.test(payload.scope)) return { ok: false, exp: null, error: "Ce jeton n'est pas un jeton « Data Export » de Clarity." };
    if (exp && exp.getTime() < now.getTime()) return { ok: false, exp: exp.toISOString(), error: "Ce jeton Clarity a expiré : génère un nouveau jeton dans Clarity > Settings > Data Export." };
    return { ok: true, exp: exp ? exp.toISOString() : null };
  } catch {
    return bad;
  }
}

/** Liens directs vers le projet dans Clarity. */
export function clarityLinks(projectId: string) {
  const base = `https://clarity.microsoft.com/projects/view/${encodeURIComponent(projectId)}`;
  return { dashboard: `${base}/dashboard`, recordings: `${base}/impressions`, heatmaps: `${base}/heatmaps` };
}
