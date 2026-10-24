// Valeur d'un prospect dans le temps, façon Hyros : pour chaque campagne, ensemble et publicité, ce
// que rapporte en moyenne une personne entrée par elle, 30, 60 et 90 jours après son premier clic,
// non-acheteurs compris. Et les cohortes par mois d'entrée face à la dépense du mois.
// Pur : client, serveur et tests (chemins relatifs avec extension, node --experimental-strip-types).

import { credits, type Conversion } from "./attribution.ts";
import { rowIds, type StageDef } from "./campaigns.ts";
import { isPaid } from "./channels.ts";

export const HORIZONS = [30, 60, 90] as const;
export type Horizon = (typeof HORIZONS)[number];

const DAY_MS = 864e5;

export interface Acquisition {
  person: string;
  /** Entrée : la première conversion d'une étape d'entrée sur la période */
  ts: string;
  /** Départ de l'horloge : le premier clic payant de cette entrée (sinon l'entrée elle-même) */
  start: string;
  /** Lignes du tableau créditées au premier clic ; vide si l'entrée ne vient pas de la publicité */
  rows: string[];
}

export interface LtvCell {
  /** Personnes entrées par la ligne */
  people: number;
  /** Personnes dont la fenêtre est écoulée, et valeur moyenne par personne sur cette fenêtre */
  matured: Record<Horizon, number>;
  value: Record<Horizon, number | null>;
  /** Acheteurs parmi les personnes entrées, toutes fenêtres confondues */
  buyers: number;
}

/**
 * Entrées de la période : la première conversion d'étape d'entrée (kind « lead ») de chaque personne
 * entre `start` et `end`, créditée au premier clic de sa fenêtre d'attribution, comme Hyros.
 */
export function acquisitions(convs: Conversion[], stages: StageDef[], windowDays: number, start: string, end: string): Acquisition[] {
  const entry = new Set(stages.filter((s) => s.kind === "lead").flatMap((s) => [s.key, ...s.aliases]));
  const first = new Map<string, Conversion>();
  for (const c of convs) {
    const d = c.ts.slice(0, 10);
    if (!entry.has(c.type) || d < start || d > end) continue;
    const prev = first.get(c.person);
    if (!prev || c.ts < prev.ts) first.set(c.person, c);
  }
  return [...first.values()].map((c) => {
    const touch = credits(c, "first_click", windowDays)[0]?.touch ?? null;
    const paid = touch && isPaid(touch.channel);
    return { person: c.person, ts: c.ts, start: paid ? touch.ts : c.ts, rows: paid ? rowIds(touch) : [] };
  });
}

/**
 * Valeur par personne à 30, 60 et 90 jours, par ligne du tableau. Une personne ne compte pour un horizon
 * qu'une fois sa fenêtre entièrement écoulée (sinon la valeur serait sous-estimée) ; `now` en ISO.
 */
export function ltvByRow(acq: Acquisition[], sales: Conversion[], saleTypes: Set<string>, now: string): Map<string, LtvCell> {
  const byPerson = new Map<string, Conversion[]>();
  for (const s of sales) {
    if (!saleTypes.has(s.type) || !s.value) continue;
    const l = byPerson.get(s.person);
    if (l) l.push(s);
    else byPerson.set(s.person, [s]);
  }
  const nowMs = Date.parse(now);
  const sums = new Map<string, { people: number; buyers: number; n: Record<Horizon, number>; v: Record<Horizon, number> }>();
  for (const a of acq) {
    const t0 = Date.parse(a.start);
    const mine = (byPerson.get(a.person) ?? []).filter((s) => Date.parse(s.ts) >= t0);
    for (const row of a.rows) {
      const r = sums.get(row) ?? { people: 0, buyers: 0, n: { 30: 0, 60: 0, 90: 0 }, v: { 30: 0, 60: 0, 90: 0 } };
      r.people++;
      if (mine.length) r.buyers++;
      for (const h of HORIZONS) {
        if (t0 + h * DAY_MS > nowMs) continue;
        r.n[h]++;
        r.v[h] += mine.filter((s) => Date.parse(s.ts) <= t0 + h * DAY_MS).reduce((x, s) => x + s.value, 0);
      }
      sums.set(row, r);
    }
  }
  const out = new Map<string, LtvCell>();
  for (const [row, r] of sums)
    out.set(row, {
      people: r.people,
      buyers: r.buyers,
      matured: r.n,
      value: { 30: r.n[30] ? r.v[30] / r.n[30] : null, 60: r.n[60] ? r.v[60] / r.n[60] : null, 90: r.n[90] ? r.v[90] / r.n[90] : null },
    });
  return out;
}

export interface Cohort {
  /** Mois d'entrée, AAAA-MM */
  month: string;
  /** Personnes entrées dans le mois, et celles venues de la publicité */
  people: number;
  paid: number;
  /** Dépense publicitaire du mois (sur la période) */
  spend: number;
  /** Chiffre d'affaires à date des personnes venues de la publicité */
  revenue: number;
  /** Valeur par personne payante à 30, 60, 90 jours (personnes dont la fenêtre est écoulée) */
  value: Record<Horizon, number | null>;
}

/** Cohortes par mois d'entrée : volume, dépense du mois, valeur des personnes venues de la publicité. */
export function cohorts(acq: Acquisition[], sales: Conversion[], saleTypes: Set<string>, spendByMonth: Map<string, number>, now: string): Cohort[] {
  const months = new Map<string, Acquisition[]>();
  for (const a of acq) {
    const m = a.ts.slice(0, 7);
    const l = months.get(m);
    if (l) l.push(a);
    else months.set(m, [a]);
  }
  for (const m of spendByMonth.keys()) if (!months.has(m)) months.set(m, []);
  return [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const paid = list.filter((a) => a.rows.length).map((a) => ({ ...a, rows: ["cohort"] }));
      const cell = ltvByRow(paid, sales, saleTypes, now).get("cohort");
      const t0 = new Map(paid.map((a) => [a.person, Date.parse(a.start)]));
      const revenue = sales.filter((s) => saleTypes.has(s.type) && t0.has(s.person) && Date.parse(s.ts) >= t0.get(s.person)!).reduce((x, s) => x + (s.value || 0), 0);
      return { month, people: list.length, paid: paid.length, spend: spendByMonth.get(month) ?? 0, revenue, value: cell?.value ?? { 30: null, 60: null, 90: null } };
    });
}
