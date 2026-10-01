"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChartColumn, FileText, Globe, Megaphone, MousePointerClick, Printer } from "lucide-react";

import "@/styles/reporting.css";
import { DailyChart, ShareBars } from "@/components/reporting/charts";
import { Delta, KpiCards } from "@/components/reporting/kpi";
import { PeriodPicker } from "@/components/reporting/period-picker";
import { ReportView } from "@/components/reporting/report-view";
import {
  ChannelShare, ClarityHistoryNote, DeviceFriction, DeviceShare, FrictionCards, Ga4Footnote, InsightList, LandingTable, ProblemPages, SiteKpis, SiteTrend, useClarity, useGa4, useInsights,
} from "@/components/reporting/site-analytics";
import type { ReportData } from "@/lib/ads/load";
import { KPI_LABEL, fmtKpi, kpi, platformColor, platformName, rangeLabel, type Kpi, type Period, type Totals } from "@/lib/ads/metrics";
import { chartSeries, groupTotals, splitTotals } from "@/lib/ads/series";
import type { ClarityData, Ga4Data, SiteAnalytics } from "@/lib/analytics/types";
import { ago, fmtDate } from "@/lib/format";
import type { PortalReportItem, PortalReporting } from "@/lib/portal/types";
import { usePortal, useUrlParam } from "./context";
import { Empty } from "./bits";

const METRICS: Kpi[] = ["conversions", "roas", "cpa", "ctr", "cpc"];
const MAX_CAMPAIGNS = 20;

type View = "ads" | "site" | "behavior";

/**
 * Performance du client : publicité, site (GA4) et comportement sur le site (Clarity), puis les rapports publiés.
 * Les rubriques « Site » et « Comportement » n'apparaissent que si l'agence a relié ces outils.
 */
export function PerformanceView({ data, analytics, period }: { data: PortalReporting; analytics: SiteAnalytics | null; period: Period }) {
  const ga4 = analytics?.ga4 ?? null;
  const clarity = analytics?.clarity ?? null;
  const [param, setParam] = useUrlParam("view");
  const tabs: { id: View; name: string; icon: typeof Globe }[] = [
    { id: "ads", name: "Publicité", icon: Megaphone },
    ...(ga4 ? [{ id: "site" as const, name: "Site", icon: Globe }] : []),
    ...(clarity ? [{ id: "behavior" as const, name: "Comportement", icon: MousePointerClick }] : []),
  ];
  // Sans compte publicitaire, on ouvre directement sur ce qui existe
  const fallback: View = data.accounts.length || !tabs[1] ? "ads" : tabs[1].id;
  const view = tabs.find((t) => t.id === param)?.id ?? fallback;
  const platforms = [...new Set(data.accounts.map((a) => platformName(a.platform)))];
  const synced = [data.synced_at, ga4?.synced_at, clarity?.synced_at].filter(Boolean).sort().at(-1);

  return (
    <>
      <div className="ptl-ph">
        <div>
          <h1>Performance</h1>
          <p>
            {tabs.length > 1 ? "Vos campagnes publicitaires, le trafic de votre site et le comportement de vos visiteurs." : `Les résultats de vos campagnes publicitaires${platforms.length ? ` (${platforms.join(", ")})` : ""}.`}
            {synced && <span suppressHydrationWarning> Données mises à jour {ago(synced)}.</span>}
          </p>
        </div>
        {(data.accounts.length > 0 || tabs.length > 1) && <PeriodPicker period={period} />}
      </div>

      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Rubriques de la performance" style={{ marginBottom: 20 }}>
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={view === t.id} className={`tab${view === t.id ? " on" : ""}`} onClick={() => setParam(t.id === fallback ? null : t.id)}>
              <t.icon size={14} aria-hidden /> {t.name}
            </button>
          ))}
        </div>
      )}

      {view === "site" && ga4 ? <SiteView ga4={ga4} period={period} /> : view === "behavior" && clarity ? <BehaviorView clarity={clarity} period={period} /> : <AdsView data={data} period={period} />}

      <Reports reports={data.reports} />
    </>
  );
}

const prevLabelOf = (period: Period) => `vs ${rangeLabel(period.prevStart, period.prevEnd).replace(/^./, (c) => c.toLowerCase())}`;

/** Trafic du site (Google Analytics 4). */
function SiteView({ ga4, period }: { ga4: Ga4Data; period: Period }) {
  const { cur } = useGa4(ga4, period);
  if (cur.sessions === 0)
    return (
      <div className="card">
        <Empty icon={<Globe size={18} />} title="Aucune visite mesurée sur cette période">
          Choisissez une autre période pour afficher le trafic de votre site.
        </Empty>
      </div>
    );
  return (
    <>
      <SiteKpis ga4={ga4} period={period} prevLabel={prevLabelOf(period)} />
      <div className="ptl-sec">
        <h2>Évolution quotidienne</h2>
      </div>
      <SiteTrend ga4={ga4} period={period} title="Sessions et conversion par jour" />
      <div className="ptl-sec">
        <h2>D&apos;où viennent vos visiteurs</h2>
      </div>
      <div className="rp-grid top" style={{ marginTop: 0, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div className="card" style={{ paddingTop: 14 }}>
          <ChannelShare ga4={ga4} period={period} />
        </div>
        <div className="card" style={{ paddingTop: 14 }}>
          <DeviceShare ga4={ga4} />
        </div>
      </div>
      <div className="ptl-sec">
        <h2>Pages d&apos;arrivée</h2>
      </div>
      <div className="card">
        <LandingTable ga4={ga4} period={period} limit={12} />
      </div>
      <Ga4Footnote ga4={ga4} />
    </>
  );
}

/** Comportement des visiteurs (Microsoft Clarity). */
function BehaviorView({ clarity, period }: { clarity: ClarityData; period: Period }) {
  const { cur } = useClarity(clarity, period);
  const insights = useInsights(clarity, period, 4);
  if (cur.sessions === 0)
    return (
      <div className="card">
        <Empty icon={<MousePointerClick size={18} />} title="Aucune session observée sur cette période">
          {clarity.first_day ? `Le suivi du comportement a commencé le ${fmtDate(clarity.first_day, true)}. Choisissez une période plus récente.` : "Le suivi du comportement vient de commencer : les premières données arrivent dès demain."}
        </Empty>
      </div>
    );
  return (
    <>
      <ClarityHistoryNote clarity={clarity} period={period} client />
      <FrictionCards clarity={clarity} period={period} prevLabel={prevLabelOf(period)} />
      {insights.length > 0 && (
        <>
          <div className="ptl-sec">
            <h2>Ce que nous observons</h2>
          </div>
          <div className="card" style={{ paddingTop: 14 }}>
            <InsightList insights={insights} />
          </div>
        </>
      )}
      <div className="ptl-sec">
        <h2>Pages à améliorer en priorité</h2>
      </div>
      <div className="card">
        <ProblemPages clarity={clarity} limit={8} />
      </div>
      <div className="ptl-sec">
        <h2>Par appareil</h2>
      </div>
      <div className="card" style={{ paddingTop: 14 }}>
        <DeviceFriction clarity={clarity} />
      </div>
      <p className="fainter" style={{ fontSize: 12, marginTop: 12 }}>
        Source : Microsoft Clarity. Un clic de rage est une série de clics rapprochés au même endroit, un clic mort un clic sans effet : les deux signalent un élément qui ne réagit pas comme attendu.
      </p>
    </>
  );
}

/** Performance publicitaire : indicateurs, évolution quotidienne, campagnes. */
function AdsView({ data, period }: { data: PortalReporting; period: Period }) {
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
