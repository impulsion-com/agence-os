"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleAlert, ExternalLink, Flame, Info, MonitorPlay } from "lucide-react";

import "@/styles/reporting.css";
import { delta, fmtDelta } from "@/lib/ads/metrics";
import {
  FRICTION_META,
  SITE_KPI_HELP,
  SITE_KPI_LABEL,
  channelName,
  clarityInsights,
  claritySeries,
  claritySplit,
  deviceName,
  fmtDuration,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSiteCompact,
  fmtSiteKpi,
  frictionRate,
  ga4Series,
  ga4Split,
  problemPages,
  rate,
  siteKpi,
  topChannels,
  type FrictionKey,
  type Insight,
  type Range,
  type SiteKpi,
} from "@/lib/analytics/calc";
import { clarityLinks } from "@/lib/analytics/clarity-rows";
import type { ClarityData, Ga4Data } from "@/lib/analytics/types";
import { fmtDate } from "@/lib/format";
import { DualChart, ShareBars, Sparkline } from "./charts";
import { SortTh, useSort } from "./common";

// Briques d'affichage de l'analytics de site, partagées par le tableau de bord de l'agence,
// le rapport client (/r/<token>) et le portail client. Les libellés sont neutres ; seuls les
// textes d'aide dépendent du lecteur (`client` : vouvoiement).

const viz = (i: number) => `var(--viz-${Math.min(8, i + 1)})`;

/** Variation vs période précédente. `better` : sens favorable (null = neutre). */
export function Trend({ cur, prev, better }: { cur: number | null; prev: number | null; better: "up" | "down" | null }) {
  const d = delta(cur, prev);
  const tone = d === null || Math.abs(d) < 0.05 || better === null ? "neutral" : d > 0 === (better === "up") ? "good" : "bad";
  const shown = d === null ? 0 : Math.abs(d) >= 100 ? Math.round(d) : Math.round(d * 10) / 10;
  const Arrow = shown > 0 ? ArrowUpRight : shown < 0 ? ArrowDownRight : null;
  const sense = tone === "good" ? "favorable" : tone === "bad" ? "défavorable" : "neutre";
  return (
    <span className={`rp-delta ${tone}`} aria-label={d === null ? "Pas de comparaison" : `${fmtDelta(d)}, évolution ${sense}`}>
      {Arrow && <Arrow size={13} strokeWidth={2.2} aria-hidden />}
      {fmtDelta(d)}
    </span>
  );
}

export interface Stat {
  key: string;
  label: string;
  help?: string;
  value: string;
  cur: number | null;
  prev: number | null;
  better: "up" | "down" | null;
  /** ligne de détail sous la variation */
  sub?: ReactNode;
  /** mini-courbe (valeurs quotidiennes) */
  spark?: number[];
  /** masque la variation (pas de période de comparaison) */
  noDelta?: boolean;
}

/** Rangée de cartes d'indicateurs (même gabarit que les KPI publicitaires). */
export function StatCards({ items, prevLabel = "vs période précédente" }: { items: Stat[]; prevLabel?: string }) {
  return (
    <div className={`rp-kpis c${items.length}`}>
      {items.map((s) => (
        <div className="rp-kpi" key={s.key}>
          <div className="k">
            {s.label}
            {s.help && (
              <span title={s.help} className="fainter" style={{ display: "inline-flex" }}>
                <Info size={12} aria-label={s.help} />
              </span>
            )}
          </div>
          <div className="v">{s.value}</div>
          {!s.noDelta && (
            <div className="d">
              <Trend cur={s.cur} prev={s.prev} better={s.better} />
              <span>{prevLabel}</span>
            </div>
          )}
          {(s.sub || s.spark) && (
            <div className="tg" style={{ justifyContent: "space-between" }}>
              {s.sub && <span>{s.sub}</span>}
              {s.spark && s.spark.length > 1 && <Sparkline values={s.spark} width={72} height={22} label={`Tendance : ${s.label}`} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Taux avec une barre proportionnelle (lecture rapide d'une colonne de tableau). */
function RateBar({ value, max, color, digits = 1 }: { value: number; max: number; color: string; digits?: number }) {
  return (
    <span className="rp-rate">
      <span>{fmtPct(value, digits)}</span>
      <i aria-hidden style={{ ["--p" as string]: max > 0 ? Math.min(1, value / max) : 0, ["--c" as string]: color }} />
    </span>
  );
}

// =====================================================================
// GA4
// =====================================================================
const SITE_BETTER: Record<SiteKpi, "up" | "down" | null> = {
  sessions: "up", users: "up", new_users: "up", engagement_rate: "up", key_events: "up", conversion_rate: "up", revenue: "up", engagement_time: "up", pageviews: "up",
};

export function useGa4(ga4: Ga4Data, period: Range) {
  return useMemo(() => {
    const split = ga4Split(ga4.daily, period);
    return { ...split, currency: ga4.currency || "EUR", hasRevenue: split.cur.revenue > 0 || split.prev.revenue > 0, hasPrev: split.prev.sessions > 0 };
  }, [ga4, period]);
}

export function SiteKpis({ ga4, period, prevLabel }: { ga4: Ga4Data; period: Range; prevLabel?: string }) {
  const { cur, prev, currency, hasRevenue, hasPrev } = useGa4(ga4, period);
  const keys: SiteKpi[] = ["sessions", "users", "engagement_rate", "key_events", "conversion_rate", hasRevenue ? "revenue" : "engagement_time"];
  const event = ga4.sources.length === 1 ? ga4.sources[0].key_event : null;
  return (
    <StatCards
      prevLabel={prevLabel}
      items={keys.map((k) => ({
        key: k,
        label: SITE_KPI_LABEL[k],
        help: k === "key_events" && event ? `Évènement clé retenu : ${event}` : SITE_KPI_HELP[k],
        value: fmtSiteKpi(k, siteKpi(cur, k), currency),
        cur: siteKpi(cur, k),
        prev: hasPrev ? siteKpi(prev, k) : null,
        better: SITE_BETTER[k],
      }))}
    />
  );
}

export function SiteTrend({ ga4, period, title = "Évolution quotidienne", prevLabel }: { ga4: Ga4Data; period: Range; title?: string; prevLabel?: string }) {
  const { currency, hasRevenue } = useGa4(ga4, period);
  const metrics: SiteKpi[] = ["conversion_rate", "key_events", "engagement_rate", ...(hasRevenue ? (["revenue"] as SiteKpi[]) : [])];
  const [metric, setMetric] = useState<SiteKpi>("conversion_rate");
  const s = useMemo(() => ga4Series(ga4.daily, period, metric), [ga4, period, metric]);
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <h3>{title}</h3>
        <div className="seg rp-seg no-print" role="group" aria-label="Indicateur affiché">
          {metrics.map((m) => (
            <button key={m} type="button" className={metric === m ? "on" : ""} aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {SITE_KPI_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <DualChart
        days={s.days}
        prevLabel={prevLabel}
        top={{ label: "Sessions", values: s.sessions, format: (v) => fmtInt(v), compact: (v) => fmtSiteCompact("sessions", v) }}
        bottom={{ label: SITE_KPI_LABEL[metric], values: s.values, prev: s.prev, format: (v) => fmtSiteKpi(metric, v, currency), compact: (v) => fmtSiteCompact(metric, v, currency) }}
      />
    </div>
  );
}

export function ChannelShare({ ga4, period }: { ga4: Ga4Data; period: Range }) {
  const { currency, hasRevenue } = useGa4(ga4, period);
  return (
    <ShareBars
      items={topChannels(ga4.channels).map((c, i) => ({
        key: c.channel,
        name: channelName(c.channel),
        color: viz(i),
        value: c.sessions,
        display: fmtInt(c.sessions),
        meta: `${fmtSiteKpi("key_events", c.key_events)} évènements clés · conversion ${fmtPct(rate(c.key_events, c.sessions), 2)}${hasRevenue ? ` · ${fmtMoney(c.revenue, currency)}` : ""}`,
      }))}
    />
  );
}

export function DeviceShare({ ga4 }: { ga4: Ga4Data }) {
  return (
    <ShareBars
      items={ga4.devices.slice(0, 4).map((d, i) => ({
        key: d.device,
        name: deviceName(d.device),
        color: viz(i),
        value: d.sessions,
        display: fmtInt(d.sessions),
        meta: `Conversion ${fmtPct(rate(d.key_events, d.sessions), 2)} · engagement ${fmtPct(rate(d.engaged, d.sessions), 0)}`,
      }))}
    />
  );
}

type SrcCol = "name" | "sessions" | "dsessions" | "engagement" | "key_events" | "conversion" | "revenue";

export function SourceTable({ ga4, period, limit = 30, sortable = true }: { ga4: Ga4Data; period: Range; limit?: number; sortable?: boolean }) {
  const { currency, hasRevenue, hasPrev } = useGa4(ga4, period);
  const { sort, toggle, apply } = useSort<SrcCol>("sessions");
  const rows = apply(ga4.sources_medium, (r, k) => {
    if (k === "name") return `${r.source} / ${r.medium}`;
    if (k === "dsessions") return r.prev_sessions ? (r.sessions - r.prev_sessions) / r.prev_sessions : null;
    if (k === "engagement") return rate(r.engaged, r.sessions);
    if (k === "conversion") return rate(r.key_events, r.sessions);
    return r[k];
  }).slice(0, limit);
  const th = (k: SrcCol, label: ReactNode, right?: boolean) =>
    sortable ? (
      <SortTh key={k} k={k} sort={sort} onSort={toggle} right={right}>
        {label}
      </SortTh>
    ) : (
      <th key={k} className={right ? "r" : undefined}>{label}</th>
    );
  if (!rows.length) return <div className="empty" style={{ padding: 28 }}><p>Aucune session sur la période.</p></div>;
  return (
    <div className="rp-scroll">
      <table className="tbl rp-tbl" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            {th("name", "Source / medium")}
            {th("sessions", "Sessions", true)}
            {hasPrev && th("dsessions", "Évol.", true)}
            {th("engagement", "Engagement", true)}
            {th("key_events", "Évèn. clés", true)}
            {th("conversion", "Taux de conv.", true)}
            {hasRevenue && th("revenue", "Revenu", true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.source}|${r.medium}`}>
              <td className="two" style={{ maxWidth: 320 }}>
                <span style={{ minWidth: 0, display: "block" }}>
                  <span className="trunc" style={{ display: "block", fontWeight: 500 }}>
                    {r.source} / {r.medium}
                  </span>
                  <span className="sub">{channelName(r.channel)}</span>
                </span>
              </td>
              <td className="r" style={{ fontWeight: 500 }}>{fmtInt(r.sessions)}</td>
              {hasPrev && <td className="r"><Trend cur={r.sessions} prev={r.prev_sessions || null} better="up" /></td>}
              <td className="r">{fmtPct(rate(r.engaged, r.sessions), 0)}</td>
              <td className="r">{fmtSiteKpi("key_events", r.key_events)}</td>
              <td className="r">{fmtPct(rate(r.key_events, r.sessions), 2)}</td>
              {hasRevenue && <td className="r">{fmtMoney(r.revenue, currency)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PageCol = "name" | "sessions" | "dsessions" | "engagement" | "key_events" | "conversion";
const pageName = (p: string) => (p === "(not set)" ? "(page non définie)" : p);

export function LandingTable({ ga4, period, limit = 30, sortable = true }: { ga4: Ga4Data; period: Range; limit?: number; sortable?: boolean }) {
  const { hasPrev } = useGa4(ga4, period);
  const { sort, toggle, apply } = useSort<PageCol>("sessions");
  const rows = apply(ga4.pages, (r, k) => {
    if (k === "name") return r.page;
    if (k === "dsessions") return r.prev_sessions ? (r.sessions - r.prev_sessions) / r.prev_sessions : null;
    if (k === "engagement") return rate(r.engaged, r.sessions);
    if (k === "conversion") return rate(r.key_events, r.sessions);
    return r[k];
  }).slice(0, limit);
  const th = (k: PageCol, label: ReactNode, right?: boolean) =>
    sortable ? (
      <SortTh key={k} k={k} sort={sort} onSort={toggle} right={right}>
        {label}
      </SortTh>
    ) : (
      <th key={k} className={right ? "r" : undefined}>{label}</th>
    );
  if (!rows.length) return <div className="empty" style={{ padding: 28 }}><p>Aucune page de destination sur la période.</p></div>;
  return (
    <div className="rp-scroll">
      <table className="tbl rp-tbl" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            {th("name", "Page de destination")}
            {th("sessions", "Sessions", true)}
            {hasPrev && th("dsessions", "Évol.", true)}
            {th("engagement", "Engagement", true)}
            {th("key_events", "Évèn. clés", true)}
            {th("conversion", "Taux de conv.", true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.page}>
              <td style={{ maxWidth: 380 }}>
                <span className="trunc mono" style={{ display: "block" }} title={r.page}>
                  {pageName(r.page)}
                </span>
              </td>
              <td className="r" style={{ fontWeight: 500 }}>{fmtInt(r.sessions)}</td>
              {hasPrev && <td className="r"><Trend cur={r.sessions} prev={r.prev_sessions || null} better="up" /></td>}
              <td className="r">{fmtPct(rate(r.engaged, r.sessions), 0)}</td>
              <td className="r">{fmtSiteKpi("key_events", r.key_events)}</td>
              <td className="r">{fmtPct(rate(r.key_events, r.sessions), 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pied de section : d'où viennent les chiffres. */
export function Ga4Footnote({ ga4 }: { ga4: Ga4Data }) {
  const events = [...new Set(ga4.sources.map((s) => s.key_event).filter(Boolean))];
  return (
    <p className="fainter" style={{ fontSize: 12, marginTop: 12 }}>
      Source : Google Analytics 4 ({ga4.sources.map((s) => s.name).join(", ")}).{" "}
      {events.length ? `Conversion suivie : évènement clé « ${events.join(" », « ")} ».` : "Conversions : tous les évènements clés de la propriété."} Le taux de conversion rapporte les
      évènements clés aux sessions.
    </p>
  );
}

// =====================================================================
// Clarity
// =====================================================================
export function useClarity(clarity: ClarityData, period: Range) {
  return useMemo(() => {
    const split = claritySplit(clarity.daily, period);
    return { ...split, hasPrev: split.prev.days > 0 && split.prev.sessions > 0, estimated: clarity.daily.filter((d) => d.window_days > 1 && d.d >= period.start && d.d <= period.end).length };
  }, [clarity, period]);
}

const CARD_FRICTION: FrictionKey[] = ["rage", "dead", "quickback", "script_error"];

export function FrictionCards({ clarity, period, prevLabel }: { clarity: ClarityData; period: Range; prevLabel?: string }) {
  const { cur, prev, hasPrev } = useClarity(clarity, period);
  const spark = (k: FrictionKey) => claritySeries(clarity.daily, period, k).values.filter((v): v is number => v !== null);
  const items: Stat[] = [
    ...CARD_FRICTION.map((k): Stat => {
      const m = FRICTION_META[k];
      const v = frictionRate(cur, k);
      return {
        key: k,
        label: m.label,
        help: `${m.help}. Part des sessions concernées.`,
        value: fmtPct(v, v !== null && v < 10 ? 2 : 1),
        cur: v,
        prev: hasPrev ? frictionRate(prev, k) : null,
        better: "down",
        sub: `${fmtInt(cur[m.sessions])} sessions`,
        spark: spark(k),
        noDelta: !hasPrev,
      };
    }),
    {
      key: "scroll",
      label: "Défilement moyen",
      help: "Profondeur de défilement : part de la page parcourue en moyenne",
      value: fmtPct(cur.scroll_depth, 0),
      cur: cur.scroll_depth,
      prev: hasPrev ? prev.scroll_depth : null,
      better: "up",
      sub: cur.active_time !== null ? `Temps actif ${fmtDuration(cur.active_time)}` : undefined,
      noDelta: !hasPrev,
    },
    {
      key: "sessions",
      label: "Sessions",
      help: "Sessions observées par Clarity sur la période (hors robots)",
      value: fmtInt(cur.sessions),
      cur: cur.sessions,
      prev: hasPrev ? prev.sessions : null,
      better: null,
      sub: `${cur.days} jour${cur.days > 1 ? "s" : ""} d'observation`,
      noDelta: !hasPrev,
    },
  ];
  return <StatCards items={items} prevLabel={prevLabel} />;
}

const TONE_ICON = { bad: AlertTriangle, warn: CircleAlert, info: Info };

export function InsightList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return <div className="empty-note faint" style={{ padding: "8px 14px 16px", fontSize: 12.5 }}>Rien d&apos;anormal à signaler sur la période.</div>;
  return (
    <ul className="rp-insights">
      {insights.map((i, n) => {
        const I = TONE_ICON[i.tone];
        return (
          <li key={n} className={i.tone}>
            <I size={15} aria-hidden />
            <span>{i.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export const useInsights = (clarity: ClarityData, period: Range, max = 5) => useMemo(() => clarityInsights(clarity, period, max), [clarity, period, max]);

/** Pages à problèmes, classées par taux de sessions avec clics de rage ou clics morts. */
export function ProblemPages({ clarity, limit = 10, links = false }: { clarity: ClarityData; limit?: number; links?: boolean }) {
  const pages = useMemo(() => problemPages(clarity.pages, limit), [clarity, limit]);
  const project = links ? clarity.sources.find((s) => s.external_id && !s.demo) : undefined;
  if (!pages.length) return <div className="empty" style={{ padding: 28 }}><p>Aucune page ne ressort : pas assez de sessions, ou aucune friction relevée sur la période.</p></div>;
  const maxRage = Math.max(...pages.map((p) => p.rage_rate));
  const maxDead = Math.max(...pages.map((p) => p.dead_rate));
  return (
    <div className="rp-scroll">
      <table className="tbl rp-tbl" style={{ minWidth: 760 }}>
        <thead>
          <tr>
            <th>Page</th>
            <th className="r">Sessions</th>
            <th className="r">Clics de rage</th>
            <th className="r">Clics morts</th>
            <th className="r">Retours rapides</th>
            <th className="r">Défilement</th>
            <th>Appareil le plus touché</th>
            {project && <th aria-label="Ouvrir dans Clarity" />}
          </tr>
        </thead>
        <tbody>
          {pages.map((p, i) => {
            const worst = [...p.devices].sort((a, b) => b.rage_sessions + b.dead_sessions - (a.rage_sessions + a.dead_sessions))[0];
            const share = worst ? rate(worst.rage_sessions + worst.dead_sessions, p.rage_sessions + p.dead_sessions) : null;
            return (
              <tr key={p.url}>
                <td style={{ maxWidth: 300 }}>
                  <span className="client">
                    <span className="rp-rank" aria-hidden>{i + 1}</span>
                    <span className="trunc mono" title={p.url}>{p.path}</span>
                  </span>
                </td>
                <td className="r">{fmtInt(p.sessions)}</td>
                <td className="r"><RateBar value={p.rage_rate} max={maxRage} color="var(--viz-8)" /></td>
                <td className="r"><RateBar value={p.dead_rate} max={maxDead} color="var(--viz-4)" /></td>
                <td className="r">{fmtPct(p.quickback_rate, 1)}</td>
                <td className="r">{fmtPct(p.scroll_depth, 0)}</td>
                <td className="muted">{worst && share !== null ? `${deviceName(worst.device)} (${fmtPct(share, 0)})` : "–"}</td>
                {project && (
                  <td className="r">
                    <span style={{ display: "inline-flex", gap: 2 }}>
                      <a className="btn btn-ghost btn-sm btn-icon" href={clarityLinks(project.external_id!).recordings} target="_blank" rel="noreferrer" title="Enregistrements dans Clarity" aria-label={`Enregistrements de sessions dans Clarity (${p.path})`}>
                        <MonitorPlay size={13} />
                      </a>
                      <a className="btn btn-ghost btn-sm btn-icon" href={clarityLinks(project.external_id!).heatmaps} target="_blank" rel="noreferrer" title="Cartes de chaleur dans Clarity" aria-label={`Cartes de chaleur dans Clarity (${p.path})`}>
                        <Flame size={13} />
                      </a>
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DeviceFriction({ clarity }: { clarity: ClarityData }) {
  if (!clarity.devices.length) return <div className="empty-note faint" style={{ padding: "8px 14px 16px", fontSize: 12.5 }}>Aucune donnée sur la période.</div>;
  const total = clarity.devices.reduce((s, d) => s + d.sessions, 0);
  return (
    <div className="rp-share" style={{ gap: 14 }}>
      {clarity.devices.map((d, i) => (
        <div className="row" key={d.device}>
          <span className="name">
            <span className="rp-dot" style={{ ["--c" as string]: viz(i) }} />
            <span className="trunc">{deviceName(d.device)}</span>
          </span>
          <span className="val">
            {fmtInt(d.sessions)}
            <small>{fmtPct(rate(d.sessions, total), 0)}</small>
          </span>
          <span className="track" aria-hidden>
            <i style={{ ["--c" as string]: viz(i), ["--p" as string]: total > 0 ? d.sessions / total : 0 }} />
          </span>
          <span className="meta">
            Rage {fmtPct(frictionRate(d, "rage"), 1)} · morts {fmtPct(frictionRate(d, "dead"), 1)} · retours {fmtPct(frictionRate(d, "quickback"), 1)} · défilement {fmtPct(d.scroll_depth, 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChannelFriction({ clarity }: { clarity: ClarityData }) {
  const total = clarity.channels.reduce((s, c) => s + c.sessions, 0);
  if (!total) return null;
  return (
    <div className="rp-share" style={{ gap: 14 }}>
      {clarity.channels.slice(0, 6).map((c, i) => (
        <div className="row" key={c.channel}>
          <span className="name">
            <span className="rp-dot" style={{ ["--c" as string]: viz(i) }} />
            <span className="trunc">{channelName(c.channel)}</span>
          </span>
          <span className="val">
            {fmtInt(c.sessions)}
            <small>{fmtPct(rate(c.sessions, total), 0)}</small>
          </span>
          <span className="meta">
            Retours rapides {fmtPct(rate(c.quickback_sessions, c.sessions), 1)} · clics morts {fmtPct(rate(c.dead_sessions, c.sessions), 1)} · temps actif {fmtDuration(c.active_time)}
          </span>
        </div>
      ))}
    </div>
  );
}

const TREND_FRICTION: FrictionKey[] = ["rage", "dead", "quickback", "script_error", "excessive"];

export function ClarityTrend({ clarity, period, title = "Tendance quotidienne", prevLabel }: { clarity: ClarityData; period: Range; title?: string; prevLabel?: string }) {
  const [metric, setMetric] = useState<FrictionKey>("rage");
  const s = useMemo(() => claritySeries(clarity.daily, period, metric), [clarity, period, metric]);
  const hasPrev = s.prev.some((v) => v !== null);
  const label = `${FRICTION_META[metric].label} (% des sessions)`;
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <h3>{title}</h3>
        <div className="seg rp-seg no-print" role="group" aria-label="Signal affiché">
          {TREND_FRICTION.map((m) => (
            <button key={m} type="button" className={metric === m ? "on" : ""} aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {FRICTION_META[m].label}
            </button>
          ))}
        </div>
      </div>
      <DualChart
        days={s.days}
        prevLabel={prevLabel}
        top={{ label: "Sessions observées", values: s.sessions, format: (v) => fmtInt(v), compact: (v) => fmtSiteCompact("sessions", v) }}
        bottom={{ label, values: s.values, prev: hasPrev ? s.prev : undefined, format: (v) => fmtPct(v, 2), compact: (v) => fmtSiteCompact("conversion_rate", v) }}
      />
    </div>
  );
}

/** Liens directs vers chaque projet dans Clarity (réservés à l'agence, jamais pour une source de démo). */
export function ClarityLinks({ clarity }: { clarity: ClarityData }) {
  const projects = clarity.sources.filter((s) => s.external_id && !s.demo);
  if (!projects.length)
    return <div className="empty-note faint" style={{ padding: "8px 14px 16px", fontSize: 12.5 }}>Projet de démonstration : les liens vers Clarity apparaissent pour un vrai projet.</div>;
  return (
    <div style={{ display: "grid", gap: 12, padding: "2px 14px 14px" }}>
      {projects.map((s) => {
        const l = clarityLinks(s.external_id!);
        return (
          <div key={s.id} style={{ display: "grid", gap: 6 }}>
            {projects.length > 1 && <span className="faint" style={{ fontSize: 12 }}>{s.name}</span>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <a className="btn btn-sm" href={l.recordings} target="_blank" rel="noreferrer">
                <MonitorPlay size={13} /> Enregistrements
              </a>
              <a className="btn btn-sm" href={l.heatmaps} target="_blank" rel="noreferrer">
                <Flame size={13} /> Cartes de chaleur
              </a>
              <a className="btn btn-sm" href={l.dashboard} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> Tableau de bord
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Rappel de la limite de Clarity : aucun historique avant la connexion. Affiché quand la période
 * (ou sa comparaison) commence avant le premier instantané.
 */
export function ClarityHistoryNote({ clarity, period, client }: { clarity: ClarityData; period: Range; client?: boolean }) {
  if (!clarity.first_day || clarity.first_day <= period.prevStart) return null;
  return (
    <div className="rp-note" role="note" style={{ marginBottom: 16 }}>
      <Info size={15} />
      <span>
        Les données de comportement commencent le {fmtDate(clarity.first_day, true)}.{" "}
        {client
          ? "Microsoft Clarity ne conserve pas d'historique exportable : les indicateurs sont enregistrés chaque jour depuis cette date."
          : "Clarity ne fournit aucun historique par son API : un instantané est enregistré chaque jour depuis la connexion du projet, la comparaison se complète au fil des jours."}
      </span>
    </div>
  );
}
