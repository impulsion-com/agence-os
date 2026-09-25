"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChartColumn, FilePlus2, FileText, Plug, Table2, Target, Upload } from "lucide-react";

import "@/styles/reporting.css";
import { useToast } from "@/components/ui/toast";
import { must, useWorkspace } from "@/lib/workspace/context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, fmtDate } from "@/lib/format";
import {
  KPI_LABEL,
  fmtKpi,
  kpi,
  periodQuery,
  platformColor,
  platformName,
  rangeLabel,
  type Kpi,
  type Period,
} from "@/lib/ads/metrics";
import { chartSeries, groupTotals, splitTotals } from "@/lib/ads/series";
import type { TrackedAccount } from "@/lib/ads/types";
import { DailyChart, ShareBars } from "./charts";
import { CompanyMark, Crumbs, ReportsTable, SortTh, SyncButton, useSort, type ReportItem } from "./common";
import { Delta, KpiCards } from "./kpi";
import { CsvImportModal, TargetsModal } from "./modals";
import { PeriodPicker } from "./period-picker";

interface Daily {
  ad_account_id: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}
interface Campaign {
  ad_account_id: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

interface Props {
  period: Period;
  company: { id: string; name: string; color: string; status: string };
  accounts: TrackedAccount[];
  rows: Daily[];
  campaigns: Campaign[];
  prevCampaigns: Campaign[];
  targets: { id: string; metric: string; target: number }[];
  reports: ReportItem[];
}

const CHART_METRICS: Kpi[] = ["conversions", "roas", "cpa", "ctr", "cpc"];
type CampCol = "name" | "spend" | "dspend" | "impressions" | "clicks" | "ctr" | "cpc" | "conversions" | "cpa" | "value" | "roas";

export function CompanyDashboard({ period, company, accounts, rows, campaigns, prevCampaigns, targets, reports }: Props) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const currency = ws.workspace.currency || "EUR";
  const [metric, setMetric] = useState<Kpi>(() => (campaigns.some((c) => c.conversion_value > 0) ? "roas" : "conversions"));
  const [view, setView] = useState<"chart" | "table">("chart");
  const [modal, setModal] = useState<"targets" | "csv" | null>(null);
  const [creating, setCreating] = useState(false);

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const { cur, prev } = useMemo(() => splitTotals(rows, period), [rows, period]);
  const series = useMemo(() => chartSeries(rows, period, metric), [rows, period, metric]);
  const targetMap = Object.fromEntries(targets.map((t) => [t.metric, t.target]));

  const curRows = rows.filter((r) => r.date >= period.start && r.date <= period.end);
  const byPlatform = groupTotals(curRows, (r) => accById.get(r.ad_account_id)?.platform ?? "other");
  const byAccount = groupTotals(curRows, (r) => r.ad_account_id);
  const prevByAccount = groupTotals(
    rows.filter((r) => r.date >= period.prevStart && r.date <= period.prevEnd),
    (r) => r.ad_account_id,
  );

  const prevCamp = useMemo(() => new Map(prevCampaigns.map((c) => [`${c.ad_account_id}|${c.campaign_id}`, c])), [prevCampaigns]);
  const { sort, toggle, apply } = useSort<CampCol>("spend");
  const campLines = campaigns.map((c) => ({
    ...c,
    t: { spend: c.spend, impressions: c.impressions, clicks: c.clicks, conversions: c.conversions, value: c.conversion_value },
    prevSpend: prevCamp.get(`${c.ad_account_id}|${c.campaign_id}`)?.spend ?? null,
  }));
  const sortedCamps = apply(campLines, (c, k) => {
    if (k === "name") return c.campaign_name;
    if (k === "dspend") return c.prevSpend ? (c.spend - c.prevSpend) / c.prevSpend : null;
    return kpi(c.t, k as Kpi);
  });

  const connected = accounts.some((a) => a.connection_id && !a.external_id.startsWith("demo-"));
  const errors = accounts.filter((a) => a.sync_error);
  const lastSync = accounts.map((a) => a.last_synced_at).filter(Boolean).sort().at(-1);

  const newReport = async () => {
    setCreating(true);
    try {
      const sb = supabaseBrowser();
      const r = must(
        await sb
          .from("reports")
          .insert({
            workspace_id: ws.workspace.id,
            company_id: company.id,
            title: `Rapport ${company.name} · ${rangeLabel(period.start, period.end)}`,
            period_start: period.start,
            period_end: period.end,
          })
          .select("id")
          .single(),
      );
      router.push(`${ws.base}/reporting/reports/${r!.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <Crumbs items={[{ label: "Reporting", href: `${ws.base}/reporting?${periodQuery(period)}` }, { label: company.name }]} />
      <div className="ph">
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          <CompanyMark name={company.name} color={company.color} size={34} />
          <div style={{ minWidth: 0 }}>
            <h1 className="trunc" style={{ fontSize: "var(--fs-2xl)" }}>{company.name}</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              {accounts.length
                ? `${accounts.length} compte${accounts.length > 1 ? "s" : ""} publicitaire${accounts.length > 1 ? "s" : ""} · synchronisé ${lastSync ? ago(lastSync) : "jamais"}`
                : "Aucun compte publicitaire associé"}
            </p>
          </div>
        </div>
        {ws.canWrite && (
          <div className="actions">
            <button className="btn" onClick={() => setModal("targets")}>
              <Target size={14} /> Objectifs
            </button>
            <button className="btn" onClick={() => setModal("csv")}>
              <Upload size={14} /> Importer un CSV
            </button>
            {connected && <SyncButton />}
            <button className="btn btn-primary" onClick={newReport} disabled={creating}>
              <FilePlus2 size={14} /> Nouveau rapport
            </button>
          </div>
        )}
      </div>

      {!accounts.length ? (
        <div className="card">
          <div className="empty">
            <div className="ic">
              <Plug size={18} />
            </div>
            <h3>Aucun compte publicitaire pour {company.name}</h3>
            <p>Associe un compte Meta Ads ou Google Ads à ce client dans les connexions, ou importe un export CSV (TikTok, LinkedIn…).</p>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <Link className="btn btn-primary" href={`${ws.base}/settings/integrations`}>
                <Plug size={14} /> Associer un compte
              </Link>
              {ws.canWrite && (
                <button className="btn" onClick={() => setModal("csv")}>
                  <Upload size={14} /> Importer un CSV
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="rp-filters">
            <PeriodPicker period={period} />
          </div>
          {errors.length > 0 && (
            <div className="rp-note err" role="alert" style={{ marginBottom: 16 }}>
              <AlertTriangle size={15} />
              <span>
                {errors.map((a) => `${a.name} : ${a.sync_error}`).join(" · ")}{" "}
                <Link href={`${ws.base}/settings/integrations`} style={{ textDecoration: "underline" }}>
                  Voir les connexions
                </Link>
              </span>
            </div>
          )}

          <KpiCards cur={cur} prev={prev} targets={targetMap} days={period.days} currency={currency} />

          <div className="rp-grid">
            <div className="card" style={{ minWidth: 0 }}>
              <div className="card-h" style={{ flexWrap: "wrap" }}>
                <h2>Évolution quotidienne</h2>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {view === "chart" && (
                    <div className="seg" role="group" aria-label="Indicateur affiché">
                      {CHART_METRICS.map((m) => (
                        <button key={m} type="button" className={metric === m ? "on" : ""} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                          {KPI_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="seg" role="group" aria-label="Affichage">
                    <button type="button" className={view === "chart" ? "on" : ""} aria-pressed={view === "chart"} onClick={() => setView("chart")} title="Graphique">
                      <ChartColumn size={13} /> <span className="sr">Graphique</span>
                    </button>
                    <button type="button" className={view === "table" ? "on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")} title="Tableau">
                      <Table2 size={13} /> <span className="sr">Tableau</span>
                    </button>
                  </div>
                </div>
              </div>
              {view === "chart" ? (
                <DailyChart days={series.days} spend={series.spend} metric={metric} values={series.values} prev={series.prev} currency={currency} />
              ) : (
                <DailyTable rows={rows} period={period} currency={currency} />
              )}
            </div>

            <div className="rp-stack">
              <div className="card">
                <div className="card-h">
                  <h3>Par plateforme</h3>
                  <span className="faint" style={{ fontSize: 12 }}>Part de la dépense</span>
                </div>
                <ShareBars
                  items={[...byPlatform.entries()]
                    .sort((a, b) => b[1].spend - a[1].spend)
                    .map(([p, t]) => ({
                      key: p,
                      name: platformName(p),
                      color: platformColor(p),
                      value: t.spend,
                      display: fmtKpi("spend", t.spend, currency),
                      meta: `${fmtKpi("conversions", t.conversions, currency)} conv. · CPA ${fmtKpi("cpa", kpi(t, "cpa"), currency)}${t.value ? ` · ROAS ${fmtKpi("roas", kpi(t, "roas"), currency)}` : ""}`,
                    }))}
                />
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Par compte</h3>
                </div>
                <div className="rp-share" style={{ gap: 14 }}>
                  {accounts.map((a) => {
                    const t = byAccount.get(a.id);
                    const p = prevByAccount.get(a.id);
                    return (
                      <div key={a.id} className="row">
                        <span className="name">
                          <span className="rp-dot" style={{ ["--c" as string]: platformColor(a.platform) }} />
                          <span className="trunc">{a.name}</span>
                        </span>
                        <span className="val">{fmtKpi("spend", t?.spend ?? 0, currency)}</span>
                        <span className="meta" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span>{platformName(a.platform)}</span>
                          <Delta metric="spend" cur={t?.spend ?? 0} prev={p?.spend ?? null} />
                          <span>
                            {a.connection_id ? (a.last_synced_at ? `synchro ${ago(a.last_synced_at)}` : "jamais synchronisé") : a.external_id.startsWith("demo-") ? "démo" : "import CSV"}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="card rp-section">
            <div className="card-h">
              <h2>Campagnes</h2>
              <span className="faint" style={{ fontSize: 12 }}>{campaigns.length} campagne{campaigns.length > 1 ? "s" : ""} actives sur la période</span>
            </div>
            {campaigns.length ? (
              <div className="rp-scroll">
                <table className="tbl rp-tbl" style={{ minWidth: 1000 }}>
                  <thead>
                    <tr>
                      <SortTh k="name" sort={sort} onSort={toggle}>Campagne</SortTh>
                      <SortTh k="spend" sort={sort} onSort={toggle} right>Dépense</SortTh>
                      <SortTh k="dspend" sort={sort} onSort={toggle} right>Évol.</SortTh>
                      <SortTh k="impressions" sort={sort} onSort={toggle} right>Impr.</SortTh>
                      <SortTh k="clicks" sort={sort} onSort={toggle} right>Clics</SortTh>
                      <SortTh k="ctr" sort={sort} onSort={toggle} right>CTR</SortTh>
                      <SortTh k="cpc" sort={sort} onSort={toggle} right>CPC</SortTh>
                      <SortTh k="conversions" sort={sort} onSort={toggle} right>Conv.</SortTh>
                      <SortTh k="cpa" sort={sort} onSort={toggle} right>CPA</SortTh>
                      <SortTh k="value" sort={sort} onSort={toggle} right>Valeur</SortTh>
                      <SortTh k="roas" sort={sort} onSort={toggle} right>ROAS</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCamps.map((c) => {
                      const a = accById.get(c.ad_account_id);
                      return (
                        <tr key={`${c.ad_account_id}|${c.campaign_id}`}>
                          <td style={{ maxWidth: 320 }}>
                            <span className="client">
                              <span className="rp-dot" style={{ ["--c" as string]: platformColor(a?.platform ?? "other") }} title={platformName(a?.platform ?? "other")} />
                              <span style={{ minWidth: 0 }}>
                                <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{c.campaign_name || c.campaign_id}</span>
                                <span className="sub trunc" style={{ display: "block" }}>{a?.name}</span>
                              </span>
                            </span>
                          </td>
                          <td className="r" style={{ fontWeight: 500 }}>{fmtKpi("spend", c.spend, currency)}</td>
                          <td className="r"><Delta metric="spend" cur={c.spend} prev={c.prevSpend} /></td>
                          <td className="r">{fmtKpi("impressions", c.impressions, currency)}</td>
                          <td className="r">{fmtKpi("clicks", c.clicks, currency)}</td>
                          <td className="r">{fmtKpi("ctr", kpi(c.t, "ctr"), currency)}</td>
                          <td className="r">{fmtKpi("cpc", kpi(c.t, "cpc"), currency)}</td>
                          <td className="r">{fmtKpi("conversions", c.conversions, currency)}</td>
                          <td className="r">{fmtKpi("cpa", kpi(c.t, "cpa"), currency)}</td>
                          <td className="r">{fmtKpi("value", c.conversion_value, currency)}</td>
                          <td className="r">{fmtKpi("roas", kpi(c.t, "roas"), currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty" style={{ padding: 32 }}>
                <p>Aucune dépense sur la période.</p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="card rp-section">
        <div className="card-h">
          <h2>Rapports</h2>
          {ws.canWrite && (
            <button className="btn btn-sm" onClick={newReport} disabled={creating}>
              <FilePlus2 size={13} /> Nouveau rapport
            </button>
          )}
        </div>
        <ReportsTable
          reports={reports}
          showCompany={false}
          empty={
            <div className="empty" style={{ padding: 28 }}>
              <div className="ic">
                <FileText size={18} />
              </div>
              <p>Aucun rapport pour ce client. « Nouveau rapport » en crée un sur la période affichée.</p>
            </div>
          }
        />
      </div>

      {modal === "targets" && <TargetsModal companyId={company.id} targets={targets} onClose={() => setModal(null)} />}
      {modal === "csv" && <CsvImportModal companyId={company.id} accounts={accounts} onClose={() => setModal(null)} />}
    </div>
  );
}

/** Vue tableau du graphique (accessibilité, lecture exacte des valeurs). */
function DailyTable({ rows, period, currency }: { rows: Daily[]; period: Period; currency: string }) {
  const s = chartSeries(rows, period, "conversions");
  const byDay = groupTotals(
    rows.filter((r) => r.date >= period.start && r.date <= period.end),
    (r) => r.date,
  );
  return (
    <div className="rp-scroll" style={{ maxHeight: 380, overflowY: "auto" }}>
      <table className="tbl rp-tbl" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th>Jour</th>
            <th className="r">Dépense</th>
            <th className="r">Conv.</th>
            <th className="r">CPA</th>
            <th className="r">ROAS</th>
            <th className="r">CTR</th>
          </tr>
        </thead>
        <tbody>
          {[...s.days].reverse().map((d) => {
            const t = byDay.get(d) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 };
            return (
              <tr key={d}>
                <td>{fmtDate(d, true)}</td>
                <td className="r">{fmtKpi("spend", t.spend, currency)}</td>
                <td className="r">{fmtKpi("conversions", t.conversions, currency)}</td>
                <td className="r">{fmtKpi("cpa", kpi(t, "cpa"), currency)}</td>
                <td className="r">{fmtKpi("roas", kpi(t, "roas"), currency)}</td>
                <td className="r">{fmtKpi("ctr", kpi(t, "ctr"), currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
