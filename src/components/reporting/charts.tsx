"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import "@/styles/reporting.css";
import { fmtDate } from "@/lib/format";
import { KPI_LABEL, fmtCompact, fmtKpi, type Kpi } from "@/lib/ads/metrics";

// ---------------------------------------------------------------------
// Utilitaires d'échelle
// ---------------------------------------------------------------------
function niceStep(max: number, ticks = 3) {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
function scale(values: (number | null)[], ticks = 3) {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const step = niceStep(max || 1, ticks);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const list: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) list.push(v);
  return { top, ticks: list };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Barre verticale : bout arrondi 4 px, base droite. */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function linePath(xs: number[], ys: (number | null)[]) {
  let d = "";
  let pen = false;
  ys.forEach((y, i) => {
    if (y === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${xs[i].toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

// ---------------------------------------------------------------------
// Graphique quotidien : dépense (barres) au-dessus, indicateur choisi (ligne) en dessous.
// Deux panneaux avec chacun leur axe, alignés sur le même axe du temps
// (jamais deux échelles sur un même graphique).
// ---------------------------------------------------------------------
export function DailyChart({
  days,
  spend,
  metric,
  values,
  prev,
  currency,
  prevLabel = "Période précédente",
}: {
  days: string[];
  spend: number[];
  metric: Kpi;
  values: (number | null)[];
  prev?: (number | null)[];
  currency: string;
  prevLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, width);
  const L = 50;
  const R = 8;
  const top1 = 22;
  const h1 = 132;
  const top2 = top1 + h1 + 40;
  const h2 = 96;
  const H = top2 + h2 + 24;
  const n = Math.max(1, days.length);
  const band = (W - L - R) / n;
  const bw = Math.max(1, Math.min(24, band - 2));
  const xs = days.map((_, i) => L + band * i + band / 2);

  const s1 = useMemo(() => scale(spend), [spend]);
  const s2 = useMemo(() => scale([...values, ...(prev ?? [])]), [values, prev]);
  const y1 = (v: number) => top1 + h1 - (v / s1.top) * h1;
  const y2 = (v: number) => top2 + h2 - (v / s2.top) * h2;

  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 78))));
  const xTicks = days.map((d, i) => ({ d, i })).filter(({ i }) => (n - 1 - i) % tickEvery === 0);

  const pick = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * W;
    const i = Math.floor((x - L) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  const tipLeft = hover === null ? 0 : Math.min(Math.max(0, (xs[hover] / W) * width + 12), Math.max(0, width - 200));
  const flip = hover !== null && (xs[hover] / W) * width > width - 210;

  return (
    <div className={`rp-chart${hover !== null ? " hovering" : ""}`} ref={ref}>
      <div className="rp-legend" style={{ padding: "0 0 8px" }}>
        <span style={{ ["--c" as string]: "var(--viz-1)" }}>
          <i className="sw" /> Dépense
        </span>
        <span style={{ ["--c" as string]: "var(--viz-2)" }}>
          <i className="ln" /> {KPI_LABEL[metric]}
        </span>
        {prev && (
          <span style={{ ["--c" as string]: "var(--viz-prev)" }}>
            <i className="ln" /> {KPI_LABEL[metric]}, {prevLabel.toLowerCase()}
          </span>
        )}
      </div>
      {width > 0 && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          height={H}
          role="img"
          tabIndex={0}
          aria-label={`Dépense quotidienne et ${KPI_LABEL[metric]} par jour. Utilise les flèches pour parcourir les jours.`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            else if (e.key === "Escape") setHover(null);
          }}
        >
          {/* Panneau 1 : dépense */}
          <text className="panel-t" x={0} y={top1 - 10}>Dépense</text>
          <g className="grid">
            {s1.ticks.slice(1).map((t) => (
              <line key={t} x1={L} x2={W - R} y1={y1(t)} y2={y1(t)} />
            ))}
          </g>
          {s1.ticks.map((t) => (
            <text key={t} x={L - 8} y={y1(t) + 3.5} textAnchor="end">
              {fmtCompact("spend", t, currency)}
            </text>
          ))}
          {spend.map((v, i) => (
            <path key={i} className={`bar${hover === i ? " on" : ""}`} d={barPath(xs[i] - bw / 2, y1(v), bw, top1 + h1 - y1(v))} />
          ))}
          <line className="base" x1={L} x2={W - R} y1={top1 + h1} y2={top1 + h1} />

          {/* Panneau 2 : indicateur */}
          <text className="panel-t" x={0} y={top2 - 10}>{KPI_LABEL[metric]}</text>
          <g className="grid">
            {s2.ticks.slice(1).map((t) => (
              <line key={t} x1={L} x2={W - R} y1={y2(t)} y2={y2(t)} />
            ))}
          </g>
          {s2.ticks.map((t) => (
            <text key={t} x={L - 8} y={y2(t) + 3.5} textAnchor="end">
              {fmtCompact(metric, t, currency)}
            </text>
          ))}
          <line className="base" x1={L} x2={W - R} y1={top2 + h2} y2={top2 + h2} />
          {prev && <path className="line prev" d={linePath(xs, prev.map((v) => (v === null ? null : y2(v))))} />}
          <path className="line" d={linePath(xs, values.map((v) => (v === null ? null : y2(v))))} />

          {/* Axe du temps */}
          {xTicks.map(({ d, i }) => (
            <text key={d} x={xs[i] > W - R - 24 ? W - R : xs[i]} y={H - 6} textAnchor={xs[i] > W - R - 24 ? "end" : "middle"}>
              {fmtDate(d)}
            </text>
          ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line className="cross" x1={xs[hover]} x2={xs[hover]} y1={top1} y2={top2 + h2} />
              {values[hover] !== null && <circle className="dot" cx={xs[hover]} cy={y2(values[hover]!)} r={4} />}
            </g>
          )}
          <rect className="hit" x={L} y={0} width={W - L - R} height={H} />
        </svg>
      )}
      {hover !== null && (
        <div className="rp-tip" style={{ left: flip ? undefined : tipLeft, right: flip ? width - (xs[hover] / W) * width + 12 : undefined, top: 30 }} role="status">
          <div className="h">{fmtDate(days[hover], true)}</div>
          <TipRow color="var(--viz-1)" label="Dépense" value={fmtKpi("spend", spend[hover], currency)} />
          <TipRow color="var(--viz-2)" label={KPI_LABEL[metric]} value={fmtKpi(metric, values[hover], currency)} />
          {prev && <TipRow color="var(--viz-prev)" label={prevLabel} value={fmtKpi(metric, prev[hover] ?? null, currency)} />}
        </div>
      )}
    </div>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="r" style={{ ["--c" as string]: color }}>
      <i className="k" />
      <span>{label}</span>
      <b className="n">{value}</b>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mini-courbe de dépense
// ---------------------------------------------------------------------
export function Sparkline({ values, width = 96, height = 26, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return <span className="fainter" style={{ fontSize: 11 }}>–</span>;
  const max = Math.max(...values, 0.0001);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg className="rp-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? "Évolution de la dépense"}>
      <path d={`M0,${height}L${pts.join("L")}L${width},${height}Z`} />
      <polyline points={pts.join(" ")} />
    </svg>
  );
}

// ---------------------------------------------------------------------
// Répartition (barres horizontales étiquetées)
// ---------------------------------------------------------------------
export interface ShareItem {
  key: string;
  name: ReactNode;
  color: string;
  value: number;
  display: string;
  meta?: ReactNode;
}

export function ShareBars({ items }: { items: ShareItem[] }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length) return <div className="empty-note faint" style={{ padding: "8px 14px 16px", fontSize: 12.5 }}>Aucune donnée sur la période.</div>;
  return (
    <div className="rp-share">
      {items.map((i) => {
        const p = total > 0 ? i.value / total : 0;
        return (
          <div className="row" key={i.key}>
            <span className="name">
              <span className="rp-dot" style={{ ["--c" as string]: i.color }} />
              <span className="trunc">{i.name}</span>
            </span>
            <span className="val">
              {i.display}
              <small>{Math.round(p * 100)} %</small>
            </span>
            <span className="track" aria-hidden>
              <i style={{ ["--c" as string]: i.color, ["--p" as string]: p }} />
            </span>
            {i.meta && <span className="meta">{i.meta}</span>}
          </div>
        );
      })}
    </div>
  );
}
