"use client";

import { useMemo, useState, type ReactNode } from "react";

import "@/styles/reporting.css";
import { fmtDate } from "@/lib/format";
import {
  KPI_LABEL,
  fmtKpi,
  kpi,
  platformColor,
  platformName,
  rangeLabel,
  withPrevious,
  type Kpi,
  type Totals,
} from "@/lib/ads/metrics";
import { chartSeries, groupTotals, splitTotals } from "@/lib/ads/series";
import type { ReportData } from "@/lib/ads/load";
import { DailyChart, ShareBars } from "./charts";
import { Delta, KpiCards } from "./kpi";

const METRICS: Kpi[] = ["conversions", "roas", "cpa", "ctr", "cpc"];
const MAX_CAMPAIGNS = 15;

/**
 * Rapport tel que le client le voit (vouvoiement). Utilisé par la page publique /r/[token]
 * et par l'aperçu de l'éditeur, à partir des mêmes données (forme de la RPC public_report).
 */
export function ReportView({ data, embedded, actions }: { data: ReportData; embedded?: boolean; actions?: ReactNode }) {
  const { report, workspace, company, accounts, targets } = data;
  const currency = workspace.currency || "EUR";
  const period = useMemo(() => withPrevious("custom", report.period_start, report.period_end), [report.period_start, report.period_end]);
  const rows = useMemo(() => data.metrics.map((m) => ({ ...m, date: String(m.date).slice(0, 10) })), [data.metrics]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const hasValue = rows.some((r) => Number(r.value) > 0);
  const [metric, setMetric] = useState<Kpi>(hasValue ? "roas" : "conversions");

  const { cur, prev } = useMemo(() => splitTotals(rows, period), [rows, period]);
  const series = useMemo(() => chartSeries(rows, period, metric), [rows, period, metric]);
  const curRows = rows.filter((r) => r.date >= period.start && r.date <= period.end);
  const prevRows = rows.filter((r) => r.date >= period.prevStart && r.date <= period.prevEnd);
  const byPlatform = [...groupTotals(curRows, (r) => accById.get(r.account)?.platform ?? "other").entries()].sort((a, b) => b[1].spend - a[1].spend);

  const campKey = (r: (typeof rows)[number]) => `${r.account}|${r.campaign_id ?? r.campaign}`;
  const camps = groupTotals(curRows, campKey);
  const prevCamps = groupTotals(prevRows, campKey);
  const names = new Map(curRows.map((r) => [campKey(r), r.campaign]));
  const campList = [...camps.entries()].sort((a, b) => b[1].spend - a[1].spend);
  const top = campList.slice(0, MAX_CAMPAIGNS);
  const rest = campList.slice(MAX_CAMPAIGNS).reduce<Totals | null>(
    (s, [, t]) => ({
      spend: (s?.spend ?? 0) + t.spend,
      impressions: (s?.impressions ?? 0) + t.impressions,
      clicks: (s?.clicks ?? 0) + t.clicks,
      conversions: (s?.conversions ?? 0) + t.conversions,
      value: (s?.value ?? 0) + t.value,
    }),
    null,
  );
  const platforms = [...new Set(accounts.map((a) => platformName(a.platform)))];
  const empty = cur.spend === 0 && cur.impressions === 0;

  return (
    <article className={`rp-doc${embedded ? " embedded" : ""}`}>
      <header className="top">
        <div>
          <div className="agency">
            <span className="mark" aria-hidden>{workspace.name.slice(0, 1).toUpperCase()}</span>
            {workspace.name}
          </div>
          <h1>{report.title}</h1>
          <p className="period">
            {company.name} · du {fmtDate(period.start, true)} au {fmtDate(period.end, true)}
          </p>
        </div>
        {actions}
      </header>

      {report.commentary.trim() && (
        <>
          <h2 className="sec">Ce qu&apos;il faut retenir</h2>
          <div className="comment prose">{report.commentary}</div>
        </>
      )}

      <h2 className="sec">Indicateurs clés</h2>
      {empty ? (
        <div className="card empty-note">Aucune donnée publicitaire n&apos;est disponible sur cette période.</div>
      ) : (
        <KpiCards
          cur={cur}
          prev={prev}
          targets={targets}
          days={period.days}
          currency={currency}
          prevLabel={`vs ${rangeLabel(period.prevStart, period.prevEnd).replace(/^./, (c) => c.toLowerCase())}`}
        />
      )}

      {!empty && (
        <>
          <h2 className="sec">Évolution quotidienne</h2>
          <div className="card">
            <div className="card-h" style={{ flexWrap: "wrap" }}>
              <h3 style={{ fontSize: "var(--fs)" }}>Dépense et {KPI_LABEL[metric]} par jour</h3>
              <div className="seg no-print" role="group" aria-label="Indicateur affiché">
                {METRICS.map((m) => (
                  <button key={m} type="button" className={metric === m ? "on" : ""} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                    {KPI_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <DailyChart days={series.days} spend={series.spend} metric={metric} values={series.values} prev={series.prev} currency={currency} />
          </div>

          {byPlatform.length > 1 && (
            <>
              <h2 className="sec">Répartition par plateforme</h2>
              <div className="card" style={{ paddingTop: 14 }}>
                <ShareBars
                  items={byPlatform.map(([p, t]) => ({
                    key: p,
                    name: platformName(p),
                    color: platformColor(p),
                    value: t.spend,
                    display: fmtKpi("spend", t.spend, currency),
                    meta: `${fmtKpi("conversions", t.conversions, currency)} conversions · CPA ${fmtKpi("cpa", kpi(t, "cpa"), currency)}${t.value ? ` · ROAS ${fmtKpi("roas", kpi(t, "roas"), currency)}` : ""}`,
                  }))}
                />
              </div>
            </>
          )}

          <h2 className="sec">Détail des campagnes</h2>
          <div className="card">
            <div className="rp-scroll">
              <table className="tbl rp-tbl" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>Campagne</th>
                    <th className="r">Dépense</th>
                    <th className="r">Évol.</th>
                    <th className="r">Clics</th>
                    <th className="r">CTR</th>
                    <th className="r">Conv.</th>
                    <th className="r">CPA</th>
                    <th className="r">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map(([k, t]) => {
                    const acc = accById.get(k.split("|")[0]);
                    return (
                      <tr key={k}>
                        <td style={{ maxWidth: 300 }}>
                          <span className="client">
                            <span className="rp-dot" style={{ ["--c" as string]: platformColor(acc?.platform ?? "other") }} title={platformName(acc?.platform ?? "other")} />
                            <span style={{ minWidth: 0 }}>
                              <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{names.get(k) || "Campagne"}</span>
                              <span className="sub">{platformName(acc?.platform ?? "other")}</span>
                            </span>
                          </span>
                        </td>
                        <td className="r" style={{ fontWeight: 500 }}>{fmtKpi("spend", t.spend, currency)}</td>
                        <td className="r"><Delta metric="spend" cur={t.spend} prev={prevCamps.get(k)?.spend ?? null} /></td>
                        <td className="r">{fmtKpi("clicks", t.clicks, currency)}</td>
                        <td className="r">{fmtKpi("ctr", kpi(t, "ctr"), currency)}</td>
                        <td className="r">{fmtKpi("conversions", t.conversions, currency)}</td>
                        <td className="r">{fmtKpi("cpa", kpi(t, "cpa"), currency)}</td>
                        <td className="r">{fmtKpi("roas", kpi(t, "roas"), currency)}</td>
                      </tr>
                    );
                  })}
                  {rest && (
                    <tr>
                      <td className="muted">{campList.length - MAX_CAMPAIGNS} autres campagnes</td>
                      <td className="r">{fmtKpi("spend", rest.spend, currency)}</td>
                      <td />
                      <td className="r">{fmtKpi("clicks", rest.clicks, currency)}</td>
                      <td className="r">{fmtKpi("ctr", kpi(rest, "ctr"), currency)}</td>
                      <td className="r">{fmtKpi("conversions", rest.conversions, currency)}</td>
                      <td className="r">{fmtKpi("cpa", kpi(rest, "cpa"), currency)}</td>
                      <td className="r">{fmtKpi("roas", kpi(rest, "roas"), currency)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="r">{fmtKpi("spend", cur.spend, currency)}</td>
                    <td className="r"><Delta metric="spend" cur={cur.spend} prev={prev.spend} /></td>
                    <td className="r">{fmtKpi("clicks", cur.clicks, currency)}</td>
                    <td className="r">{fmtKpi("ctr", kpi(cur, "ctr"), currency)}</td>
                    <td className="r">{fmtKpi("conversions", cur.conversions, currency)}</td>
                    <td className="r">{fmtKpi("cpa", kpi(cur, "cpa"), currency)}</td>
                    <td className="r">{fmtKpi("roas", kpi(cur, "roas"), currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {report.next_steps.trim() && (
        <>
          <h2 className="sec">Prochaines étapes</h2>
          <div className="comment prose">{report.next_steps}</div>
        </>
      )}

      <footer className="foot">
        <span>
          Rapport préparé par {workspace.name}
          {platforms.length ? ` · données ${platforms.join(", ")}` : ""}
        </span>
        <span>
          Comparaison avec la période du {fmtDate(period.prevStart, true)} au {fmtDate(period.prevEnd, true)}. Montants en {currency}.
        </span>
      </footer>
    </article>
  );
}
