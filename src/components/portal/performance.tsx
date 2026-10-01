"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChartColumn, FileText, Printer } from "lucide-react";

import "@/styles/reporting.css";
import { DailyChart, ShareBars } from "@/components/reporting/charts";
import { Delta, KpiCards } from "@/components/reporting/kpi";
import { PeriodPicker } from "@/components/reporting/period-picker";
import { ReportView } from "@/components/reporting/report-view";
import type { ReportData } from "@/lib/ads/load";
import { KPI_LABEL, fmtKpi, kpi, platformColor, platformName, rangeLabel, type Kpi, type Period, type Totals } from "@/lib/ads/metrics";
import { chartSeries, groupTotals, splitTotals } from "@/lib/ads/series";
import { ago } from "@/lib/format";
import type { PortalReportItem, PortalReporting } from "@/lib/portal/types";
import { usePortal } from "./context";
import { Empty } from "./bits";

const METRICS: Kpi[] = ["conversions", "roas", "cpa", "ctr", "cpc"];
const MAX_CAMPAIGNS = 20;

/** Performance publicitaire du client : indicateurs, évolution quotidienne, campagnes et rapports publiés. */
export function PerformanceView({ data, period }: { data: PortalReporting; period: Period }) {
  const { currency } = usePortal();
  const rows = useMemo(() => data.metrics.map((m) => ({ ...m, date: String(m.date).slice(0, 10) })), [data.metrics]);
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
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
  const empty = cur.spend === 0 && cur.impressions === 0;

  return (
    <>
      <div className="ptl-ph">
        <div>
          <h1>Performance</h1>
          <p>
            Les résultats de vos campagnes publicitaires
            {data.accounts.length ? ` (${[...new Set(data.accounts.map((a) => platformName(a.platform)))].join(", ")})` : ""}.
            {data.synced_at && <span suppressHydrationWarning> Données mises à jour {ago(data.synced_at)}.</span>}
          </p>
        </div>
        {data.accounts.length > 0 && <PeriodPicker period={period} />}
      </div>

      {!data.accounts.length ? (
        <div className="card">
          <Empty icon={<ChartColumn size={18} />} title="Aucun compte publicitaire relié pour le moment">
            Vos indicateurs apparaîtront ici dès que votre agence aura relié vos comptes publicitaires.
          </Empty>
        </div>
      ) : empty ? (
        <div className="card">
          <Empty icon={<ChartColumn size={18} />} title="Aucune donnée sur cette période">
            Choisissez une autre période pour afficher vos résultats.
          </Empty>
        </div>
      ) : (
        <>
          <KpiCards
            cur={cur}
            prev={prev}
            targets={data.targets}
            days={period.days}
            currency={currency}
            prevLabel={`vs ${rangeLabel(period.prevStart, period.prevEnd).replace(/^./, (c) => c.toLowerCase())}`}
          />

          <div className="ptl-sec">
            <h2>Évolution quotidienne</h2>
          </div>
          <div className="card">
            <div className="card-h" style={{ flexWrap: "wrap" }}>
              <h3 style={{ fontSize: "var(--fs)" }}>Dépense et {KPI_LABEL[metric]} par jour</h3>
              <div className="seg" role="group" aria-label="Indicateur affiché">
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
              <div className="ptl-sec">
                <h2>Répartition par plateforme</h2>
              </div>
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

          <div className="ptl-sec">
            <h2>
              Campagnes <span className="count">{campList.length}</span>
            </h2>
          </div>
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

      <Reports reports={data.reports} />
    </>
  );
}

function Reports({ reports }: { reports: PortalReportItem[] }) {
  const { href, ctx } = usePortal();
  return (
    <>
      <div className="ptl-sec">
        <h2>
          Rapports <span className="count">{reports.length}</span>
        </h2>
      </div>
      {reports.length === 0 ? (
        <div className="card">
          <Empty icon={<FileText size={18} />} title="Aucun rapport publié">
            Les rapports commentés par {ctx.workspace.name} seront disponibles ici.
          </Empty>
        </div>
      ) : (
        <div className="ptl-reports">
          {reports.map((r) => (
            <Link key={r.id} href={href(`performance?report=${r.id}`)} className="ptl-report">
              <span className="ic">
                <FileText size={18} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="t" style={{ display: "block" }}>{r.title}</span>
                <span className="s" style={{ display: "block" }}>{rangeLabel(r.period_start, r.period_end)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Lecture d'un rapport publié dans le portail (mêmes composants que la page publique /r/<token>). */
export function ReportReader({ data }: { data: ReportData }) {
  const { href } = usePortal();
  return (
    <>
      <Link href={href("performance")} className="ptl-back">
        <ArrowLeft size={14} /> Performance
      </Link>
      <div className="ptl-reportdoc">
        <ReportView
          data={data}
          embedded
          actions={
            <div className="actions no-print">
              <button type="button" className="btn" onClick={() => window.print()}>
                <Printer size={14} /> Télécharger en PDF
              </button>
            </div>
          }
        />
      </div>
    </>
  );
}
