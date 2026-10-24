// Lecture des créas façon Motion : scores 1 à 100 par annonce (accroche, rétention, clic,
// conversion), classement de la semaine avec ses mouvements, courbe de rétention vidéo et
// regroupement des annonces qui diffusent la même créa.
// Module pur, sans import d'exécution : testé par src/lib/creatives/tests/board.test.mjs.
import type { CTotals } from "./metrics";

// ---------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------
export type ScoreKey = "hook" | "watch" | "click" | "convert";

export const SCORE_LABEL: Record<ScoreKey, string> = { hook: "Accroche", watch: "Rétention", click: "Clic", convert: "Ventes" };
export const SCORE_HELP: Record<ScoreKey, string> = {
  hook: "Hook rate (vues de 3 s / impressions) comparé aux autres annonces du périmètre",
  watch: "Hold rate (ThruPlay / vues de 3 s) comparé aux autres annonces du périmètre",
  click: "CTR (clics sur un lien / impressions) comparé aux autres annonces du périmètre",
  convert: "ROAS réel du tracking dès qu'une annonce du périmètre a une vente suivie (vide pour celles qui n'en ont aucune), sinon ROAS déclaré, sinon CPA",
};

export type Scores = Record<ScoreKey, number | null>;

export interface ScoreInput {
  key: string;
  t: CTotals;
  /** Chiffre d'affaires mesuré par le tracking (null si aucune vente suivie) */
  realRevenue?: number | null;
}

/** Mesure du score Ventes, la même pour tout le périmètre (on ne compare pas un ROAS à un CPA). */
export type ConvertBasis = "real" | "roas" | "cpa";

/** Valeur brute d'un score (plus haut = mieux), null si non calculable. */
export function scoreValue(k: ScoreKey, x: ScoreInput, basis: ConvertBasis): number | null {
  const t = x.t;
  switch (k) {
    case "hook":
      return t.vImp > 0 ? t.v3 / t.vImp : null;
    case "watch":
      return t.v3h > 0 ? t.thru / t.v3h : null;
    case "click":
      return t.impressions > 0 ? t.clicks / t.impressions : null;
    case "convert":
      if (!(t.spend > 0)) return null;
      // Sans vente suivie, on ne sait pas : pas de score plutôt qu'un faux zéro (tracking partiel)
      if (basis === "real") return x.realRevenue !== null && x.realRevenue !== undefined ? x.realRevenue / t.spend : null;
      if (basis === "roas") return t.value / t.spend;
      return t.conversions > 0 ? -(t.spend / t.conversions) : null;
  }
}

/**
 * Scores 1 à 100 : rang centile de chaque annonce parmi celles du périmètre qui dépassent le seuil
 * de dépense (comme Motion, on compare à ses propres annonces, pas à un benchmark). Il faut au
 * moins 3 annonces comparables, sinon le score reste vide.
 */
export function scoreAds(ads: ScoreInput[], minSpend: number): Map<string, Scores> {
  const eligible = ads.filter((a) => a.t.spend >= minSpend);
  // Ventes : le ROAS réel dès qu'une annonce du périmètre a une vente suivie, sinon le ROAS déclaré
  // si au moins une annonce a une valeur de conversion, sinon le CPA (génération de prospects)
  const basis: ConvertBasis = eligible.some((a) => (a.realRevenue ?? 0) > 0) ? "real" : eligible.some((a) => a.t.value > 0) ? "roas" : "cpa";
  const out = new Map<string, Scores>();
  for (const a of ads) out.set(a.key, { hook: null, watch: null, click: null, convert: null });
  for (const k of Object.keys(SCORE_LABEL) as ScoreKey[]) {
    const vals = eligible.map((a) => ({ key: a.key, v: scoreValue(k, a, basis) })).filter((x): x is { key: string; v: number } => x.v !== null);
    if (vals.length < 3) continue;
    for (const x of vals) {
      const below = vals.filter((y) => y.v < x.v).length;
      const equal = vals.filter((y) => y.v === x.v).length - 1;
      const pct = (below + equal / 2) / (vals.length - 1);
      out.get(x.key)![k] = Math.max(1, Math.round(pct * 99) + 1);
    }
  }
  return out;
}

export type Band = "top" | "good" | "mid" | "low";
/** Bandes de couleur de Motion : 80 et plus, 60 à 80, 40 à 60, moins de 40. */
export const band = (s: number): Band => (s >= 80 ? "top" : s >= 60 ? "good" : s >= 40 ? "mid" : "low");

// ---------------------------------------------------------------------
// Classement de la semaine
// ---------------------------------------------------------------------
export type Move = "new" | "back" | "scaling" | "declining" | "paused" | "steady";

export const MOVE_LABEL: Record<Move, string> = { new: "Nouvelle", back: "Reprise", scaling: "En hausse", declining: "En baisse", paused: "En pause", steady: "Stable" };

export interface BoardRow {
  key: string;
  rank: number | null;
  prevRank: number | null;
  spend: number;
  prevSpend: number;
  move: Move;
  /** Semaines passées dans le top 10 sur les 8 dernières */
  weeksTop: number;
}

interface DayRow {
  date: string;
  spend: number | string;
}

const DAY = 864e5;
const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

function spendIn(rows: DayRow[], start: string, end: string) {
  let s = 0;
  for (const r of rows) if (r.date >= start && r.date <= end) s += Number(r.spend || 0);
  return s;
}

function ranks(spend: Map<string, number>) {
  const sorted = [...spend].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  return new Map(sorted.map(([k], i) => [k, i + 1]));
}

/**
 * Semaine glissante finissant à `end` (7 jours) comparée à la précédente : rang par dépense,
 * mouvement (+30 % = en hausse, −30 % = en baisse, plus rien = en pause, première dépense = nouvelle,
 * rien la semaine d'avant mais des dépenses plus anciennes = reprise)
 * et nombre de semaines dans le top 10 sur les 8 dernières.
 */
export function weeklyBoard(rowsByAd: Map<string, DayRow[]>, end: string, size = 10): BoardRow[] {
  const weeks = Array.from({ length: 8 }, (_, i) => ({ start: shift(end, -7 * i - 6), end: shift(end, -7 * i) }));
  const spendByWeek = weeks.map((w) => new Map([...rowsByAd].map(([k, rows]) => [k, spendIn(rows, w.start, w.end)])));
  const rankByWeek = spendByWeek.map(ranks);
  const cur = rankByWeek[0];
  const prev = rankByWeek[1];
  const keys = new Set([...cur.keys(), ...[...prev].filter(([, r]) => r <= size).map(([k]) => k)]);
  const rows: BoardRow[] = [];
  for (const key of keys) {
    const spend = spendByWeek[0].get(key) ?? 0;
    const prevSpend = spendByWeek[1].get(key) ?? 0;
    const before = spendIn(rowsByAd.get(key) ?? [], "0000-01-01", shift(weeks[0].start, -1));
    const move: Move =
      spend === 0
        ? "paused"
        : before === 0
          ? "new"
          : prevSpend === 0
            ? "back"
            : spend >= prevSpend * 1.3
              ? "scaling"
              : spend <= prevSpend * 0.7
                ? "declining"
                : "steady";
    rows.push({ key, rank: cur.get(key) ?? null, prevRank: prev.get(key) ?? null, spend, prevSpend, move, weeksTop: rankByWeek.filter((r) => (r.get(key) ?? 99) <= size).length });
  }
  return rows
    .filter((r) => (r.rank !== null && r.rank <= size) || r.move === "paused")
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.prevSpend - a.prevSpend);
}

// ---------------------------------------------------------------------
// Rétention vidéo
// ---------------------------------------------------------------------
export interface RetentionPoint {
  label: string;
  /** Part des personnes arrêtées par la vidéo (vues de 3 s) encore là, en % */
  pct: number;
}

/** Courbe 3 s → 25 % → 50 % → 75 % → 100 % de la vidéo, null si l'annonce n'a pas de vues vidéo. */
export function retention(t: CTotals): RetentionPoint[] | null {
  if (!(t.v3 > 0)) return null;
  const p = (n: number) => Math.min(100, (n / t.v3) * 100);
  return [
    { label: "3 s", pct: 100 },
    { label: "25 %", pct: p(t.p25) },
    { label: "50 %", pct: p(t.p50) },
    { label: "75 %", pct: p(t.p75) },
    { label: "Fin", pct: p(t.p100) },
  ];
}

// ---------------------------------------------------------------------
// Même créa, plusieurs annonces
// ---------------------------------------------------------------------
export interface AssetGroup<T> {
  asset: string;
  ads: string[];
  t: T;
}

/**
 * Regroupe les annonces qui diffusent la même vidéo ou la même image (clé d'asset de la plateforme),
 * pour juger la créa et pas chacune de ses copies. Les annonces sans clé restent seules.
 */
export function groupByAsset<T>(byAd: Map<string, T>, assetOf: (key: string) => string | null, merge: (a: T, b: T) => T): AssetGroup<T>[] {
  const m = new Map<string, AssetGroup<T>>();
  for (const [k, t] of byAd) {
    const asset = assetOf(k) ?? `ad:${k}`;
    const g = m.get(asset);
    if (g) {
      g.ads.push(k);
      g.t = merge(g.t, t);
    } else m.set(asset, { asset, ads: [k], t });
  }
  return [...m.values()];
}
