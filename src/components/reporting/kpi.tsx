"use client";

import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";

import "@/styles/reporting.css";
import {
  KPI_HELP,
  KPI_LABEL,
  MONTHLY,
  STATE_LABEL,
  delta,
  deltaTone,
  fmtDelta,
  fmtKpi,
  kpi,
  scaledTarget,
  targetState,
  type Kpi,
  type TargetState,
  type Totals,
} from "@/lib/ads/metrics";
import type { KpiMetric } from "@/lib/types";

export function Delta({ metric, cur, prev, title }: { metric: Kpi; cur: number | null; prev: number | null; title?: string }) {
  const d = delta(cur, prev);
  const tone = deltaTone(metric, d);
  const shown = d === null ? 0 : Math.abs(d) >= 100 ? Math.round(d) : Math.round(d * 10) / 10;
  const Arrow = shown > 0 ? ArrowUpRight : shown < 0 ? ArrowDownRight : null;
  const sense = tone === "good" ? "favorable" : tone === "bad" ? "défavorable" : "neutre";
  return (
    <span className={`rp-delta ${tone}`} title={title} aria-label={d === null ? "Pas de comparaison" : `${fmtDelta(d)}, évolution ${sense}`}>
      {Arrow && <Arrow size={13} strokeWidth={2.2} aria-hidden />}
      {fmtDelta(d)}
    </span>
  );
}

const STATE_ICON = { good: CircleCheck, near: CircleAlert, far: CircleX };

export function StateBadge({ state, short, title }: { state: TargetState; short?: boolean; title?: string }) {
  const I = STATE_ICON[state];
  const label = short ? { good: "Atteint", near: "Proche", far: "Loin" }[state] : STATE_LABEL[state];
  return (
    <span className={`rp-state ${state}`} title={title ?? STATE_LABEL[state]}>
      <I size={14} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}

export const CARD_KPIS: KpiMetric[] = ["spend", "conversions", "cpa", "roas", "ctr", "cpc"];

/** Rangée de cartes KPI avec variation vs période précédente et objectif. */
export function KpiCards({
  cur,
  prev,
  targets,
  days,
  currency,
  keys = CARD_KPIS,
  prevLabel = "vs période précédente",
}: {
  cur: Totals;
  prev: Totals;
  targets: Partial<Record<string, number>>;
  days: number;
  currency: string;
  keys?: Kpi[];
  prevLabel?: string;
}) {
  return (
    <div className="rp-kpis">
      {keys.map((k) => {
        const v = kpi(cur, k);
        const p = kpi(prev, k);
        const target = targets[k];
        const st = target ? targetState(k as KpiMetric, v, target, days) : null;
        return (
          <div className="rp-kpi" key={k}>
            <div className="k">
              {KPI_LABEL[k]}
              <span title={KPI_HELP[k]} className="fainter" style={{ display: "inline-flex" }}>
                <Info size={12} aria-label={KPI_HELP[k]} />
              </span>
            </div>
            <div className="v">{fmtKpi(k, v, currency)}</div>
            <div className="d">
              <Delta metric={k} cur={v} prev={p} />
              <span>{prevLabel}</span>
            </div>
            {target ? (
              <div className="tg">
                <span style={{ whiteSpace: "nowrap" }}>
                  Objectif {fmtKpi(k, scaledTarget(k as KpiMetric, target, days), currency)}
                  {MONTHLY[k as KpiMetric] && (days < 28 || days > 31) ? " au prorata" : ""}
                </span>
                {st ? <StateBadge state={st} short /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
