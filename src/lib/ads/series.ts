// Séries quotidiennes et regroupements (purs, client et serveur).

import { ZERO, add, dayList, kpi, type Kpi, type Period, type RawMetric, type Totals } from "./metrics";

export interface Dated extends RawMetric {
  date: string;
}

/** Totaux de la période courante et de la période précédente. */
export function splitTotals<T extends Dated>(rows: T[], p: Period) {
  let cur = ZERO;
  let prev = ZERO;
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    if (d >= p.start && d <= p.end) cur = add(cur, r);
    else if (d >= p.prevStart && d <= p.prevEnd) prev = add(prev, r);
  }
  return { cur, prev };
}

/** Totaux par jour sur une plage (jours sans donnée = zéro). */
export function byDay<T extends Dated>(rows: T[], start: string, end: string) {
  const days = dayList(start, end);
  const map = new Map<string, Totals>(days.map((d) => [d, ZERO]));
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    const t = map.get(d);
    if (t) map.set(d, add(t, r));
  }
  return { days, totals: days.map((d) => map.get(d)!) };
}

/** Séries pour le graphique : dépense, indicateur et même indicateur sur la période précédente. */
export function chartSeries<T extends Dated>(rows: T[], p: Period, metric: Kpi) {
  const cur = byDay(rows, p.start, p.end);
  const prev = byDay(rows, p.prevStart, p.prevEnd);
  const values = cur.totals.map((t) => kpi(t, metric));
  const prevValues = cur.days.map((_, i) => (prev.totals[i] ? kpi(prev.totals[i], metric) : null));
  return { days: cur.days, spend: cur.totals.map((t) => t.spend), values, prev: prevValues };
}

/** Regroupe des lignes par clé. */
export function groupTotals<T extends RawMetric>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, Totals>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, add(m.get(k) ?? ZERO, r));
  }
  return m;
}
