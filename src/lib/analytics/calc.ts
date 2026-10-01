// Calculs de l'analytics de site (GA4 et Clarity) : totaux, taux, pages à problèmes, constats en clair.
// Pur (seulement des imports de types) : utilisé par l'interface, le rapport client, le portail,
// le serveur MCP et les tests (node --experimental-strip-types --test src/lib/analytics/tests/analytics.test.mjs).

import type { ClarityChannel, ClarityData, ClarityDay, ClarityPage, Friction, Ga4Channel, Ga4Data, Ga4Day } from "./types";

// ---------------------------------------------------------------------
// Dates et formats
// ---------------------------------------------------------------------
export interface Range {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
}

const DAY = 864e5;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Jours d'une plage (bornes incluses). */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = utc(start); t <= utc(end); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const nf = (d: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : nf(0).format(Math.round(v)));
// Espace insécable avant « % » : un pourcentage ne se coupe jamais en fin de ligne
export const fmtPct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${nf(d).format(v)}\u00a0%`);
export function fmtMoney(v: number | null | undefined, currency = "EUR") {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const d = Math.abs(v) >= 1000 || v === 0 ? 0 : 2;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
/** Durée lisible : 48 s, 1 min 24 s. */
export function fmtDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "–";
  const s = Math.round(seconds);
  // espaces insécables : la durée ne se coupe pas en fin de ligne
  return s < 60 ? `${s}\u00a0s` : `${Math.floor(s / 60)}\u00a0min\u00a0${String(s % 60).padStart(2, "0")}\u00a0s`;
}

/** Pourcentage a / b (null si b est nul). */
export const rate = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

/** Variation relative en % (null si la base est nulle). */
export const change = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);

// ---------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------
export interface Ga4Totals {
  sessions: number;
  users: number;
  new_users: number;
  engaged: number;
  engagement_s: number;
  key_events: number;
  purchases: number;
  revenue: number;
  pageviews: number;
}

export const GA4_ZERO: Ga4Totals = { sessions: 0, users: 0, new_users: 0, engaged: 0, engagement_s: 0, key_events: 0, purchases: 0, revenue: 0, pageviews: 0 };

export function ga4Totals(daily: Ga4Day[], start: string, end: string): Ga4Totals {
  const t = { ...GA4_ZERO };
  for (const r of daily) {
    const d = String(r.d).slice(0, 10);
    if (d < start || d > end) continue;
    t.sessions += Number(r.sessions) || 0;
    t.users += Number(r.users) || 0;
    t.new_users += Number(r.new_users) || 0;
    t.engaged += Number(r.engaged) || 0;
    t.engagement_s += Number(r.engagement_s) || 0;
    t.key_events += Number(r.key_events) || 0;
    t.purchases += Number(r.purchases) || 0;
    t.revenue += Number(r.revenue) || 0;
    t.pageviews += Number(r.pageviews) || 0;
  }
  return t;
}

export const ga4Split = (daily: Ga4Day[], p: Range) => ({ cur: ga4Totals(daily, p.start, p.end), prev: ga4Totals(daily, p.prevStart, p.prevEnd) });

export type SiteKpi = "sessions" | "users" | "new_users" | "engagement_rate" | "key_events" | "conversion_rate" | "revenue" | "engagement_time" | "pageviews";

/** Valeur d'un indicateur de site ; null quand il n'est pas calculable. */
export function siteKpi(t: Ga4Totals, k: SiteKpi): number | null {
  switch (k) {
    case "sessions":
      return t.sessions;
    case "users":
      return t.users;
    case "new_users":
      return t.new_users;
    case "key_events":
      return t.key_events;
    case "revenue":
      return t.revenue;
    case "pageviews":
      return t.pageviews;
    case "engagement_rate":
      return rate(t.engaged, t.sessions);
    // Taux de conversion du site : évènements clés pour 100 sessions
    case "conversion_rate":
      return rate(t.key_events, t.sessions);
    // Durée d'engagement moyenne par session, en secondes
    case "engagement_time":
      return t.sessions > 0 ? t.engagement_s / t.sessions : null;
  }
}

export const SITE_KPI_LABEL: Record<SiteKpi, string> = {
  sessions: "Sessions",
  users: "Utilisateurs",
  new_users: "Nouveaux utilisateurs",
  engagement_rate: "Taux d'engagement",
  key_events: "Évènements clés",
  conversion_rate: "Taux de conversion",
  revenue: "Revenu",
  engagement_time: "Durée d'engagement",
  pageviews: "Pages vues",
};

export const SITE_KPI_HELP: Record<SiteKpi, string> = {
  sessions: "Visites du site mesurées par Google Analytics",
  users: "Somme des utilisateurs de chaque jour : une personne revenue plusieurs jours compte plusieurs fois",
  new_users: "Personnes venues pour la première fois",
  engagement_rate: "Part des sessions de plus de 10 secondes, avec 2 pages vues ou un évènement clé",
  key_events: "Actions comptées comme conversions dans Google Analytics (achat, formulaire…)",
  conversion_rate: "Évènements clés pour 100 sessions",
  revenue: "Chiffre d'affaires e-commerce mesuré par Google Analytics",
  engagement_time: "Temps moyen passé activement sur le site par session",
  pageviews: "Nombre de pages affichées",
};

export function fmtSiteKpi(k: SiteKpi, v: number | null, currency = "EUR"): string {
  if (v === null || !Number.isFinite(v)) return "–";
  switch (k) {
    case "engagement_rate":
      return fmtPct(v, 1);
    case "conversion_rate":
      return fmtPct(v, 2);
    case "revenue":
      return fmtMoney(v, currency);
    case "engagement_time":
      return fmtDuration(v);
    case "key_events":
      return nf(v % 1 === 0 || v >= 100 ? 0 : 1).format(v);
    default:
      return fmtInt(v);
  }
}

/** Format compact pour les axes des graphiques. */
export function fmtSiteCompact(k: SiteKpi, v: number, currency = "EUR"): string {
  if (k === "engagement_rate" || k === "conversion_rate") return `${nf(v !== 0 && Math.abs(v) < 10 ? 1 : 0).format(v)}\u00a0%`;
  if (k === "engagement_time") return `${Math.round(v)} s`;
  const o: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 };
  if (k === "revenue") Object.assign(o, { style: "currency", currency });
  return new Intl.NumberFormat("fr-FR", o).format(v);
}

/** Série quotidienne d'un indicateur sur la période, et sur la période précédente (alignée jour pour jour). */
export function ga4Series(daily: Ga4Day[], p: Range, k: SiteKpi) {
  const byDay = new Map(daily.map((r) => [String(r.d).slice(0, 10), r]));
  const one = (d: string) => {
    const r = byDay.get(d);
    return r ? ga4Totals([r], d, d) : null;
  };
  const days = daysBetween(p.start, p.end);
  const prevDays = daysBetween(p.prevStart, p.prevEnd);
  const cur = days.map(one);
  return {
    days,
    sessions: cur.map((t) => t?.sessions ?? 0),
    values: cur.map((t) => (t ? siteKpi(t, k) : null)),
    prev: days.map((_, i) => {
      const t = prevDays[i] ? one(prevDays[i]) : null;
      return t ? siteKpi(t, k) : null;
    }),
  };
}

// Groupes de canaux par défaut de GA4, en français
const CHANNEL_FR: Record<string, string> = {
  "direct": "Accès direct",
  "organic search": "Recherche naturelle",
  "paid search": "Recherche payante",
  "organic social": "Réseaux sociaux (naturel)",
  "paid social": "Réseaux sociaux payants",
  "email": "E-mail",
  "referral": "Sites référents",
  "display": "Display",
  "cross-network": "Multi-réseaux (Performance Max)",
  "paid shopping": "Shopping payant",
  "organic shopping": "Shopping (naturel)",
  "paid video": "Vidéo payante",
  "organic video": "Vidéo (naturel)",
  "paid other": "Autre payant",
  "affiliates": "Affiliation",
  "audio": "Audio",
  "sms": "SMS",
  "mobile push notifications": "Notifications mobiles",
  "unassigned": "Non attribué",
  "ai assistant": "Assistants IA",
  // variantes Clarity (sans espace)
  "organicsearch": "Recherche naturelle",
  "paidsearch": "Recherche payante",
  "paidsocial": "Réseaux sociaux payants",
  "social": "Réseaux sociaux",
  "organicsocial": "Réseaux sociaux (naturel)",
  "other": "Autre",
  "affiliate": "Affiliation",
  "ai": "Assistants IA",
};
export const channelName = (c: string) => CHANNEL_FR[c.trim().toLowerCase()] ?? (c || "Non attribué");

/** Canaux payants de GA4 : ceux que les régies publicitaires revendiquent. */
export const isPaidChannel = (c: string) => /^paid|^display$|^cross-network$/i.test(c.trim());

export function paidTotals(channels: Ga4Channel[]) {
  let sessions = 0;
  let key_events = 0;
  let revenue = 0;
  for (const c of channels) {
    if (!isPaidChannel(c.channel)) continue;
    sessions += Number(c.sessions) || 0;
    key_events += Number(c.key_events) || 0;
    revenue += Number(c.revenue) || 0;
  }
  return { sessions, key_events, revenue };
}

const DEVICE_FR: Record<string, string> = { mobile: "Mobile", desktop: "Ordinateur", pc: "Ordinateur", tablet: "Tablette", "smart tv": "TV connectée", other: "Autre" };
export const deviceName = (d: string) => DEVICE_FR[d.trim().toLowerCase()] ?? (d || "Autre");
const DEVICE_IN: Record<string, string> = { mobile: "sur mobile", desktop: "sur ordinateur", pc: "sur ordinateur", tablet: "sur tablette" };
const deviceIn = (d: string) => DEVICE_IN[d.trim().toLowerCase()] ?? `sur ${d.toLowerCase()}`;

// ---------------------------------------------------------------------
// Clarity
// ---------------------------------------------------------------------
export type FrictionKey = "rage" | "dead" | "quickback" | "excessive" | "script_error" | "error_click";

export const FRICTION_KEYS: FrictionKey[] = ["rage", "dead", "quickback", "excessive", "script_error", "error_click"];

export const FRICTION_META: Record<FrictionKey, { label: string; short: string; help: string; sessions: keyof Friction; count: keyof Friction }> = {
  rage: {
    label: "Clics de rage",
    short: "Rage",
    help: "Clics répétés très vite au même endroit : la personne s'énerve sur un élément qui ne répond pas",
    sessions: "rage_sessions",
    count: "rage_clicks",
  },
  dead: {
    label: "Clics morts",
    short: "Morts",
    help: "Clics sans aucun effet : un élément a l'air cliquable mais ne l'est pas",
    sessions: "dead_sessions",
    count: "dead_clicks",
  },
  quickback: {
    label: "Retours rapides",
    short: "Retours",
    help: "La personne ouvre une page puis revient aussitôt en arrière : la page ne répond pas à son attente",
    sessions: "quickback_sessions",
    count: "quickbacks",
  },
  excessive: {
    label: "Défilement excessif",
    short: "Défil.",
    help: "Défilement de haut en bas plus rapide que la normale : la personne cherche sans trouver",
    sessions: "excessive_sessions",
    count: "excessive_scrolls",
  },
  script_error: {
    label: "Erreurs de script",
    short: "Erreurs JS",
    help: "Erreurs JavaScript rencontrées pendant la visite",
    sessions: "script_error_sessions",
    count: "script_errors",
  },
  error_click: {
    label: "Clics en erreur",
    short: "Clics en erreur",
    help: "Clics qui déclenchent une erreur JavaScript",
    sessions: "error_click_sessions",
    count: "error_clicks",
  },
};

export interface ClarityTotals extends Friction {
  sessions: number;
  users: number;
  scroll_depth: number | null;
  active_time: number | null;
  pages_per_session: number | null;
  /** jours avec un instantané dans la plage */
  days: number;
}

const FRICTION_FIELDS: (keyof Friction)[] = [
  "dead_clicks", "dead_sessions", "rage_clicks", "rage_sessions", "quickbacks", "quickback_sessions",
  "excessive_scrolls", "excessive_sessions", "script_errors", "script_error_sessions", "error_clicks", "error_click_sessions",
];
const zeroFriction = (): Friction => Object.fromEntries(FRICTION_FIELDS.map((k) => [k, 0])) as unknown as Friction;

/** Totaux Clarity d'une plage : compteurs additionnés, moyennes pondérées par les sessions. */
export function clarityTotals(daily: ClarityDay[], start: string, end: string): ClarityTotals {
  const t: ClarityTotals = { ...zeroFriction(), sessions: 0, users: 0, scroll_depth: null, active_time: null, pages_per_session: null, days: 0 };
  const w = { scroll: 0, sScroll: 0, active: 0, sActive: 0, pages: 0, sPages: 0 };
  for (const r of daily) {
    const d = String(r.d).slice(0, 10);
    if (d < start || d > end) continue;
    const s = Number(r.sessions) || 0;
    t.days++;
    t.sessions += s;
    t.users += Number(r.users) || 0;
    for (const k of FRICTION_FIELDS) t[k] += Number(r[k]) || 0;
    if (r.scroll_depth !== null && r.scroll_depth !== undefined) {
      w.scroll += Number(r.scroll_depth) * s;
      w.sScroll += s;
    }
    if (r.active_time !== null && r.active_time !== undefined) {
      w.active += Number(r.active_time) * s;
      w.sActive += s;
    }
    if (r.pages_per_session !== null && r.pages_per_session !== undefined) {
      w.pages += Number(r.pages_per_session) * s;
      w.sPages += s;
    }
  }
  t.scroll_depth = w.sScroll > 0 ? w.scroll / w.sScroll : null;
  t.active_time = w.sActive > 0 ? w.active / w.sActive : null;
  t.pages_per_session = w.sPages > 0 ? w.pages / w.sPages : null;
  return t;
}

export const claritySplit = (daily: ClarityDay[], p: Range) => ({ cur: clarityTotals(daily, p.start, p.end), prev: clarityTotals(daily, p.prevStart, p.prevEnd) });

/** Part des sessions touchées par un signal de friction, en % (null sans session). */
export const frictionRate = (t: Friction & { sessions: number }, k: FrictionKey): number | null => rate(Number(t[FRICTION_META[k].sessions]) || 0, Number(t.sessions) || 0);

/** Série quotidienne du taux d'un signal (null les jours sans instantané). */
export function claritySeries(daily: ClarityDay[], p: Range, k: FrictionKey) {
  const byDay = new Map(daily.map((r) => [String(r.d).slice(0, 10), r]));
  const days = daysBetween(p.start, p.end);
  const prevDays = daysBetween(p.prevStart, p.prevEnd);
  const val = (d: string | undefined) => {
    const r = d ? byDay.get(d) : undefined;
    return r ? frictionRate(r, k) : null;
  };
  return { days, sessions: days.map((d) => Number(byDay.get(d)?.sessions ?? 0)), values: days.map(val), prev: days.map((_, i) => val(prevDays[i])) };
}

/** Chemin d'une URL pour l'affichage (sans domaine). */
export function urlPath(url: string): string {
  const m = /^https?:\/\/[^/]+(\/.*)?$/i.exec(url);
  return m ? m[1] || "/" : url || "/";
}

export interface ProblemPage extends Friction {
  url: string;
  path: string;
  sessions: number;
  /** % des sessions de la page avec clics de rage, clics morts, et les deux additionnés (plafonné à 100) */
  rage_rate: number;
  dead_rate: number;
  friction_rate: number;
  quickback_rate: number;
  script_error_rate: number;
  scroll_depth: number | null;
  /** part des sessions « clics de rage » et « clics morts » du site portée par cette page, en % */
  rage_share: number;
  dead_share: number;
  devices: { device: string; sessions: number; rage_sessions: number; dead_sessions: number }[];
}

/** Regroupe les lignes page × appareil par page. */
export function pagesByUrl(pages: ClarityPage[]): ProblemPage[] {
  const map = new Map<string, ProblemPage & { w: number; ws: number }>();
  for (const r of pages) {
    const p =
      map.get(r.url) ??
      ({ ...zeroFriction(), url: r.url, path: urlPath(r.url), sessions: 0, rage_rate: 0, dead_rate: 0, friction_rate: 0, quickback_rate: 0, script_error_rate: 0, scroll_depth: null, rage_share: 0, dead_share: 0, devices: [], w: 0, ws: 0 } as ProblemPage & { w: number; ws: number });
    map.set(r.url, p);
    const s = Number(r.sessions) || 0;
    p.sessions += s;
    for (const k of FRICTION_FIELDS) p[k] += Number(r[k]) || 0;
    if (r.scroll_depth !== null && r.scroll_depth !== undefined) {
      p.w += Number(r.scroll_depth) * s;
      p.ws += s;
    }
    p.devices.push({ device: r.device, sessions: s, rage_sessions: Number(r.rage_sessions) || 0, dead_sessions: Number(r.dead_sessions) || 0 });
  }
  const all = [...map.values()];
  const rageAll = all.reduce((s, p) => s + p.rage_sessions, 0);
  const deadAll = all.reduce((s, p) => s + p.dead_sessions, 0);
  return all.map(({ w, ws, ...p }) => ({
    ...p,
    rage_rate: rate(p.rage_sessions, p.sessions) ?? 0,
    dead_rate: rate(p.dead_sessions, p.sessions) ?? 0,
    friction_rate: Math.min(100, rate(p.rage_sessions + p.dead_sessions, p.sessions) ?? 0),
    quickback_rate: rate(p.quickback_sessions, p.sessions) ?? 0,
    script_error_rate: rate(p.script_error_sessions, p.sessions) ?? 0,
    scroll_depth: ws > 0 ? w / ws : null,
    rage_share: rate(p.rage_sessions, rageAll) ?? 0,
    dead_share: rate(p.dead_sessions, deadAll) ?? 0,
    devices: p.devices.sort((a, b) => b.sessions - a.sessions),
  }));
}

/**
 * Pages à problèmes : classées par taux de sessions avec clics de rage ou clics morts.
 * Les pages trop peu visitées sont écartées (au moins 30 sessions et 0,5 % des sessions suivies) :
 * trois sessions agacées sur dix visites ne font pas une page à problèmes.
 */
export function problemPages(pages: ClarityPage[], limit = 10): ProblemPage[] {
  const all = pagesByUrl(pages);
  const total = all.reduce((s, p) => s + p.sessions, 0);
  const floor = Math.max(30, total * 0.005);
  return all
    .filter((p) => p.sessions >= floor && p.rage_sessions + p.dead_sessions > 0)
    .sort((a, b) => b.friction_rate - a.friction_rate || b.sessions - a.sessions)
    .slice(0, limit);
}

export interface Insight {
  tone: "bad" | "warn" | "info";
  text: string;
}

const pc = (v: number, d = 0) => fmtPct(v, d);
const times = (x: number) => `${nf(x >= 10 ? 0 : 1).format(x)} fois`;
const pageLabel = (p: { path: string }) => (p.path === "/" ? "La page d'accueil" : `La page ${p.path}`);
const onPage = (p: { path: string }) => (p.path === "/" ? "Sur la page d'accueil" : `Sur ${p.path}`);

/**
 * Constats en clair tirés des données Clarity de la période (formulations neutres : elles servent
 * dans l'interface de l'agence comme dans ce que lit le client).
 */
export function clarityInsights(c: ClarityData, p: Range, max = 5): Insight[] {
  const out: Insight[] = [];
  const { cur, prev } = claritySplit(c.daily, p);
  if (cur.sessions <= 0) return out;
  const pages = pagesByUrl(c.pages);
  const pageSessions = pages.reduce((s, x) => s + x.sessions, 0);
  const minSessions = Math.max(30, pageSessions * 0.005);

  // 1. Concentration des clics de rage sur une page (et sur un appareil)
  const rageTotal = pages.reduce((s, x) => s + x.rage_sessions, 0);
  const topRage = [...pages].sort((a, b) => b.rage_sessions - a.rage_sessions)[0];
  if (topRage && rageTotal >= 10 && topRage.rage_share >= 25) {
    const dev = [...topRage.devices].sort((a, b) => b.rage_sessions - a.rage_sessions)[0];
    const devShare = dev ? rate(dev.rage_sessions, topRage.rage_sessions) ?? 0 : 0;
    out.push({
      tone: "bad",
      text: `${pageLabel(topRage)} concentre ${pc(topRage.rage_share)} des clics de rage${dev && devShare >= 60 ? `, à ${pc(devShare)} ${deviceIn(dev.device)}` : ""} : ${pc(topRage.rage_rate, 1)} des sessions qui la visitent s'y agacent.`,
    });
  }

  // 2. Clics morts : page nettement au-dessus de la moyenne du site
  const siteDead = rate(pages.reduce((s, x) => s + x.dead_sessions, 0), pageSessions) ?? 0;
  const topDead = pages.filter((x) => x.sessions >= minSessions).sort((a, b) => b.dead_rate - a.dead_rate)[0];
  if (topDead && siteDead > 0 && topDead.dead_rate >= Math.max(5, siteDead * 1.8)) {
    out.push({
      tone: "bad",
      text: `${onPage(topDead)}, ${pc(topDead.dead_rate)} des sessions comportent des clics morts (${pc(siteDead)} en moyenne sur le site) : un élément a l'air cliquable sans l'être.`,
    });
  }

  // 3. Écart entre mobile et ordinateur
  const dev = (name: RegExp) => c.devices.find((d) => name.test(d.device));
  const mobile = dev(/^mobile$/i);
  const desktop = dev(/^(pc|desktop)$/i);
  if (mobile && desktop && mobile.sessions >= 50 && desktop.sessions >= 50) {
    const m = frictionRate(mobile, "rage") ?? 0;
    const d = frictionRate(desktop, "rage") ?? 0;
    if (m >= 0.5 && d > 0 && m / d >= 2) out.push({ tone: "warn", text: `Les clics de rage sont ${times(m / d)} plus fréquents sur mobile (${pc(m, 1)} des sessions) que sur ordinateur (${pc(d, 1)}).` });
    else if (m >= 0.5 && d === 0) out.push({ tone: "warn", text: `Les clics de rage ne concernent que le mobile (${pc(m, 1)} des sessions).` });
  }

  // 4. Retours rapides par canal d'acquisition
  const chTotal = c.channels.reduce((s, x) => s + x.sessions, 0);
  const avgQuick = rate(c.channels.reduce((s, x) => s + x.quickback_sessions, 0), chTotal) ?? 0;
  const quick = (x: ClarityChannel) => rate(x.quickback_sessions, x.sessions) ?? 0;
  const topQuick = c.channels.filter((x) => x.sessions >= chTotal * 0.1).sort((a, b) => quick(b) - quick(a))[0];
  if (topQuick && avgQuick > 0 && quick(topQuick) >= avgQuick * 1.3 && quick(topQuick) >= 2) {
    out.push({
      tone: "warn",
      text: `Le trafic « ${channelName(topQuick.channel)} » revient en arrière dans ${pc(quick(topQuick), 1)} des sessions (${pc(avgQuick, 1)} en moyenne) : la page d'arrivée ne tient pas toujours la promesse de l'annonce.`,
    });
  }

  // 5. Erreurs de script
  const scriptRate = frictionRate(cur, "script_error") ?? 0;
  if (scriptRate >= 2) {
    const worst = pages.filter((x) => x.sessions >= minSessions).sort((a, b) => b.script_error_rate - a.script_error_rate)[0];
    out.push({
      tone: scriptRate >= 5 ? "bad" : "warn",
      text: `${pc(scriptRate, 1)} des sessions rencontrent une erreur de script${worst && worst.script_error_rate >= scriptRate * 1.5 ? `, surtout ${worst.path === "/" ? "sur la page d'accueil" : `sur ${worst.path}`} (${pc(worst.script_error_rate, 1)})` : ""}.`,
    });
  }

  // 6. Tendance des clics de rage par rapport à la période précédente
  const rc = frictionRate(cur, "rage");
  const rp = prev.sessions > 0 ? frictionRate(prev, "rage") : null;
  const ch = change(rc, rp);
  if (ch !== null && rc !== null && rp !== null && prev.days >= 3 && Math.abs(ch) >= 25 && Math.max(rc, rp) >= 0.5) {
    out.push({
      tone: ch > 0 ? "warn" : "info",
      text: `Les clics de rage ${ch > 0 ? "augmentent" : "reculent"} : ${pc(rc, 1)} des sessions contre ${pc(rp, 1)} sur la période précédente.`,
    });
  }

  // 7. Faible profondeur de défilement sur une page très visitée
  const shallow = pages.filter((x) => x.sessions >= pageSessions * 0.1 && x.scroll_depth !== null && x.scroll_depth < 45).sort((a, b) => b.sessions - a.sessions)[0];
  if (shallow) {
    out.push({ tone: "info", text: `${onPage(shallow)}, les visiteurs ne parcourent en moyenne que ${pc(shallow.scroll_depth!)} de la page : l'essentiel doit tenir dans la première moitié.` });
  }
  return out.slice(0, max);
}

// ---------------------------------------------------------------------
// Vue d'ensemble : écarts entre les sources de conversions
// ---------------------------------------------------------------------
export interface GapInput {
  /** conversions et valeur déclarées par les régies publicitaires */
  platformConversions: number;
  platformValue: number;
  ga4: Ga4Data | null;
  ga4Totals: Ga4Totals | null;
  firstParty: { purchases: number; revenue: number; leads: number } | null;
}

/** Phrases qui expliquent les écarts entre plateformes, GA4 et tracking first-party (tutoiement : vue agence). */
export function conversionGaps(g: GapInput): string[] {
  const out: string[] = [];
  const conv = (v: number) => nf(v % 1 === 0 || v >= 100 ? 0 : 1).format(v);
  if (g.ga4 && g.ga4Totals && g.platformConversions > 0) {
    const paid = paidTotals(g.ga4.channels);
    if (g.ga4Totals.key_events <= 0) {
      out.push("GA4 ne remonte aucun évènement clé sur la période : vérifie que la conversion suivie par les campagnes est bien marquée comme évènement clé dans Google Analytics.");
    } else if (paid.key_events < g.platformConversions) {
      const part = rate(paid.key_events, g.platformConversions) ?? 0;
      out.push(
        `Les plateformes déclarent ${conv(g.platformConversions)} conversions, GA4 en attribue ${conv(paid.key_events)} aux canaux payants (${pc(part)}) : les régies comptent aussi les conversions après une simple vue de publicité et sur plusieurs jours, alors que GA4 crédite le dernier canal de la session.`,
      );
    } else {
      out.push(
        `GA4 attribue ${conv(paid.key_events)} évènements clés aux canaux payants, plus que les ${conv(g.platformConversions)} conversions déclarées par les plateformes : vérifie que l'évènement clé choisi est bien celui que les campagnes optimisent.`,
      );
    }
  }
  if (g.firstParty && g.ga4Totals && g.ga4Totals.key_events > 0 && g.firstParty.purchases + g.firstParty.leads > 0) {
    const fp = g.firstParty.purchases > 0 ? g.firstParty.purchases : g.firstParty.leads;
    const d = change(fp, g.ga4Totals.key_events) ?? 0;
    out.push(
      Math.abs(d) < 5
        ? `Le tracking first-party confirme GA4 : ${conv(fp)} ${g.firstParty.purchases > 0 ? "ventes" : "prospects"} mesurés contre ${conv(g.ga4Totals.key_events)} évènements clés.`
        : `Le tracking first-party mesure ${conv(fp)} ${g.firstParty.purchases > 0 ? "ventes" : "prospects"}, soit ${pc(Math.abs(d))} de ${d > 0 ? "plus" : "moins"} que GA4 : ${d > 0 ? "il enregistre aussi les conversions envoyées par le serveur, que les bloqueurs et les refus de cookies font perdre à GA4" : "son script n'est peut-être pas posé sur toutes les pages de conversion"}.`,
    );
  } else if (g.firstParty && !g.ga4 && g.platformConversions > 0 && g.firstParty.purchases > 0) {
    out.push(`Le tracking first-party mesure ${conv(g.firstParty.purchases)} ventes réelles, à comparer aux ${conv(g.platformConversions)} conversions déclarées par les plateformes.`);
  }
  return out;
}

/** Répartition par canal pour l'affichage : les principaux canaux, le reste regroupé en « Autres ». */
export function topChannels(channels: Ga4Channel[], max = 7) {
  const sorted = [...channels].filter((c) => c.sessions > 0).sort((a, b) => b.sessions - a.sessions);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce(
    (s, c) => ({
      ...s,
      sessions: s.sessions + c.sessions,
      users: s.users + c.users,
      new_users: s.new_users + c.new_users,
      engaged: s.engaged + c.engaged,
      key_events: s.key_events + c.key_events,
      purchases: s.purchases + c.purchases,
      revenue: s.revenue + c.revenue,
      prev_sessions: s.prev_sessions + c.prev_sessions,
      prev_key_events: s.prev_key_events + c.prev_key_events,
      prev_revenue: s.prev_revenue + c.prev_revenue,
    }),
    { channel: "Autres", sessions: 0, users: 0, new_users: 0, engaged: 0, key_events: 0, purchases: 0, revenue: 0, prev_sessions: 0, prev_key_events: 0, prev_revenue: 0 } as Ga4Channel,
  );
  return [...head, rest];
}
