// Calculs du reporting (purs, utilisables côté client et serveur).

import { MONTHS, addDays, fmtDate, iso, parseDay, today } from "@/lib/format";
import type { KpiMetric } from "@/lib/types";
import type { AdPlatform } from "./types";

// ---------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------
export type PeriodKey = "7d" | "30d" | "mtd" | "lastmonth" | "90d" | "custom";

export const PERIODS: { id: PeriodKey; name: string }[] = [
  { id: "7d", name: "7 derniers jours" },
  { id: "30d", name: "30 derniers jours" },
  { id: "mtd", name: "Ce mois-ci" },
  { id: "lastmonth", name: "Mois dernier" },
  { id: "90d", name: "90 derniers jours" },
  { id: "custom", name: "Personnalisée" },
];

export interface Period {
  key: PeriodKey;
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  days: number;
  label: string;
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !!parseDay(s);
const days = (a: string, b: string) => Math.round((parseDay(b)!.getTime() - parseDay(a)!.getTime()) / 864e5) + 1;

/** Période précédente de même durée, juste avant. */
export function withPrevious(key: PeriodKey, start: string, end: string, label?: string): Period {
  const n = days(start, end);
  const prevEnd = iso(addDays(parseDay(start)!, -1));
  const prevStart = iso(addDays(parseDay(start)!, -n));
  return { key, start, end, prevStart, prevEnd, days: n, label: label ?? rangeLabel(start, end) };
}

export function rangeLabel(start: string, end: string) {
  const a = parseDay(start)!;
  const b = parseDay(end)!;
  const lastOfMonth = addDays(new Date(b.getFullYear(), b.getMonth() + 1, 1), -1).getDate();
  if (a.getDate() === 1 && b.getDate() === lastOfMonth && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
    return `${MONTHS[a.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${a.getFullYear()}`;
  return `${fmtDate(start, a.getFullYear() !== b.getFullYear())} au ${fmtDate(end, true)}`;
}

/**
 * Résout la période depuis les paramètres d'URL (?period=30d, ?period=custom&from=…&to=…).
 * Les périodes glissantes se terminent hier (la journée en cours est incomplète).
 */
export function resolvePeriod(sp: { period?: string | string[]; from?: string | string[]; to?: string | string[] }, now = today()): Period {
  const key = (typeof sp.period === "string" ? sp.period : "30d") as PeriodKey;
  const yesterday = addDays(now, -1);
  const y = iso(yesterday);
  switch (key) {
    case "7d":
      return withPrevious("7d", iso(addDays(yesterday, -6)), y, "7 derniers jours");
    case "90d":
      return withPrevious("90d", iso(addDays(yesterday, -89)), y, "90 derniers jours");
    case "mtd": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = yesterday < first ? now : yesterday;
      // Comparaison : même nombre de jours au début du mois précédent
      const p = withPrevious("mtd", iso(first), iso(end), "Ce mois-ci");
      const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevLast = addDays(first, -1);
      const prevEnd = addDays(prevFirst, p.days - 1);
      return { ...p, prevStart: iso(prevFirst), prevEnd: iso(prevEnd > prevLast ? prevLast : prevEnd) };
    }
    case "lastmonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = addDays(new Date(now.getFullYear(), now.getMonth(), 1), -1);
      const p = withPrevious("lastmonth", iso(first), iso(last), rangeLabel(iso(first), iso(last)));
      const pf = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { ...p, prevStart: iso(pf), prevEnd: iso(addDays(first, -1)) };
    }
    case "custom": {
      const from = sp.from;
      const to = sp.to;
      if (isDay(from) && isDay(to) && from <= to && days(from, to) <= 731) return withPrevious("custom", from, to);
      return resolvePeriod({ period: "30d" }, now);
    }
    default:
      return withPrevious("30d", iso(addDays(yesterday, -29)), y, "30 derniers jours");
  }
}

export function periodQuery(p: { key: PeriodKey; start: string; end: string }) {
  return p.key === "custom" ? `period=custom&from=${p.start}&to=${p.end}` : `period=${p.key}`;
}

/** Liste des jours d'une période (axe X des graphiques). */
export function dayList(start: string, end: string) {
  const out: string[] = [];
  let d = parseDay(start)!;
  const e = parseDay(end)!;
  while (d <= e) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}

// ---------------------------------------------------------------------
// Totaux et indicateurs
// ---------------------------------------------------------------------
export interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  value: number;
}

export const ZERO: Totals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 };

export interface RawMetric {
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  conversions: number | string;
  conversion_value?: number | string;
  value?: number | string;
}

export function add(t: Totals, r: RawMetric): Totals {
  return {
    spend: t.spend + Number(r.spend || 0),
    impressions: t.impressions + Number(r.impressions || 0),
    clicks: t.clicks + Number(r.clicks || 0),
    conversions: t.conversions + Number(r.conversions || 0),
    value: t.value + Number(r.conversion_value ?? r.value ?? 0),
  };
}

export const sum = (rows: RawMetric[]) => rows.reduce(add, ZERO);

export type Kpi = KpiMetric | "value" | "impressions" | "clicks" | "cpm";

/** Valeur d'un indicateur ; null quand il n'est pas calculable (division par zéro). */
export function kpi(t: Totals, k: Kpi): number | null {
  switch (k) {
    case "spend":
      return t.spend;
    case "conversions":
      return t.conversions;
    case "value":
      return t.value;
    case "impressions":
      return t.impressions;
    case "clicks":
      return t.clicks;
    case "cpa":
      return t.conversions > 0 ? t.spend / t.conversions : null;
    case "roas":
      return t.spend > 0 && t.value > 0 ? t.value / t.spend : null;
    case "ctr":
      return t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null;
    case "cpc":
      return t.clicks > 0 ? t.spend / t.clicks : null;
    case "cpm":
      return t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null;
  }
}

/** Sens favorable : true si une hausse est une bonne nouvelle. */
export const HIGHER_IS_BETTER: Record<Kpi, boolean | null> = {
  spend: null, // neutre : ni bon ni mauvais en soi
  conversions: true,
  value: true,
  impressions: true,
  clicks: true,
  roas: true,
  ctr: true,
  cpa: false,
  cpc: false,
  cpm: false,
};

export const KPI_LABEL: Record<Kpi, string> = {
  spend: "Dépense",
  conversions: "Conversions",
  value: "Valeur de conversion",
  impressions: "Impressions",
  clicks: "Clics",
  roas: "ROAS",
  ctr: "CTR",
  cpa: "CPA",
  cpc: "CPC",
  cpm: "CPM",
};

export const KPI_HELP: Record<Kpi, string> = {
  spend: "Montant investi en publicité sur la période",
  conversions: "Achats ou prospects attribués aux publicités",
  value: "Chiffre d'affaires attribué aux publicités",
  impressions: "Nombre d'affichages des publicités",
  clicks: "Clics vers le site ou le formulaire",
  roas: "Valeur de conversion divisée par la dépense",
  ctr: "Part des impressions qui génèrent un clic",
  cpa: "Coût moyen d'une conversion",
  cpc: "Coût moyen d'un clic",
  cpm: "Coût pour mille impressions",
};

/** Formate un indicateur. */
export function fmtKpi(k: Kpi, v: number | null, currency = "EUR"): string {
  if (v === null || !Number.isFinite(v)) return "–";
  const nf = (d: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const cur = (d: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d });
  switch (k) {
    case "spend":
    case "value":
      return cur(Math.abs(v) >= 1000 || v === 0 ? 0 : 2).format(v);
    case "cpa":
    case "cpc":
    case "cpm":
      return cur(2).format(v);
    case "roas":
      return `${nf(2).format(v)}`;
    case "ctr":
      return `${nf(2).format(v)} %`;
    case "conversions":
      return nf(v % 1 === 0 || v >= 100 ? 0 : 1).format(v);
    default:
      return nf(0).format(v);
  }
}

/** Format compact pour les axes (12 k€, 1,2 M). */
export function fmtCompact(k: Kpi, v: number, currency = "EUR") {
  const money = k === "spend" || k === "value" || k === "cpa" || k === "cpc" || k === "cpm";
  const o: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 };
  if (money) Object.assign(o, { style: "currency", currency });
  const s = new Intl.NumberFormat("fr-FR", o).format(v);
  return k === "ctr" ? `${s} %` : s;
}

/** Variation relative en % (null si la base est nulle). */
export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Tonalité d'une variation : good / bad / neutral. */
export function deltaTone(k: Kpi, d: number | null): "good" | "bad" | "neutral" {
  if (d === null || Math.abs(d) < 0.05) return "neutral";
  const hib = HIGHER_IS_BETTER[k];
  if (hib === null) return "neutral";
  return (d > 0) === hib ? "good" : "bad";
}

export function fmtDelta(d: number | null) {
  if (d === null) return "–";
  const v = Math.abs(d) >= 100 ? Math.round(d) : Math.round(d * 10) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${new Intl.NumberFormat("fr-FR").format(Math.abs(v))} %`;
}

// ---------------------------------------------------------------------
// Objectifs
// ---------------------------------------------------------------------
export const TARGET_METRICS: KpiMetric[] = ["spend", "conversions", "cpa", "roas", "ctr", "cpc"];

/** spend et conversions sont des objectifs mensuels, ramenés à la durée de la période. */
export const MONTHLY: Partial<Record<KpiMetric, true>> = { spend: true, conversions: true };
const MONTH_DAYS = 30.4;

export function scaledTarget(metric: KpiMetric, target: number, periodDays: number) {
  return MONTHLY[metric] ? (target * periodDays) / MONTH_DAYS : target;
}

export type TargetState = "good" | "near" | "far";

/**
 * État vs objectif.
 * - Ratios (CPA, CPC : plus bas = mieux ; ROAS, CTR : plus haut = mieux) : atteint, proche (écart < 15 %), loin.
 * - Conversions : atteint si ≥ objectif ramené à la période, proche si ≥ 85 %.
 * - Dépense (budget) : atteint si à ± 10 % du budget ramené à la période, proche à ± 25 %.
 */
export function targetState(metric: KpiMetric, value: number | null, target: number, periodDays: number): TargetState | null {
  if (value === null || !target) return null;
  const t = scaledTarget(metric, target, periodDays);
  if (metric === "spend") {
    const gap = Math.abs(value - t) / t;
    return gap <= 0.1 ? "good" : gap <= 0.25 ? "near" : "far";
  }
  const lower = metric === "cpa" || metric === "cpc";
  const ratio = lower ? t / value : value / t;
  return ratio >= 1 ? "good" : ratio >= 0.85 ? "near" : "far";
}

export const STATE_LABEL: Record<TargetState, string> = { good: "Objectif atteint", near: "Proche de l'objectif", far: "Loin de l'objectif" };

/** Pire état parmi une liste (pour la pastille d'un client). */
export function worst(states: (TargetState | null)[]): TargetState | null {
  const s = states.filter(Boolean) as TargetState[];
  if (!s.length) return null;
  return s.includes("far") ? "far" : s.includes("near") ? "near" : "good";
}

// ---------------------------------------------------------------------
// Plateformes
// ---------------------------------------------------------------------
// Couleurs de série (palette catégorielle validée, ordre fixe) : --viz-1…--viz-6 dans reporting.css
export const PLATFORM_META: Record<AdPlatform, { name: string; short: string; slot: number }> = {
  meta: { name: "Meta Ads", short: "Meta", slot: 1 },
  google: { name: "Google Ads", short: "Google", slot: 2 },
  tiktok: { name: "TikTok Ads", short: "TikTok", slot: 3 },
  linkedin: { name: "LinkedIn Ads", short: "LinkedIn", slot: 4 },
  snapchat: { name: "Snapchat Ads", short: "Snapchat", slot: 5 },
  pinterest: { name: "Pinterest Ads", short: "Pinterest", slot: 6 },
  chatgpt: { name: "ChatGPT Ads", short: "ChatGPT", slot: 7 },
  other: { name: "Autre régie", short: "Autre", slot: 8 },
};
export const platformColor = (p: string) => `var(--viz-${PLATFORM_META[p as AdPlatform]?.slot ?? 8})`;
export const platformName = (p: string) => PLATFORM_META[p as AdPlatform]?.name ?? p;
