"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, Plug, Upload } from "lucide-react";

import "@/styles/reporting.css";
import { PageHeader } from "@/components/ui/misc";
import { useWorkspace } from "@/lib/workspace/context";
import { ago } from "@/lib/format";
import {
  PLATFORM_META,
  STATE_LABEL,
  kpi,
  fmtKpi,
  periodQuery,
  platformColor,
  platformName,
  targetState,
  worst,
  type Kpi,
  type Period,
  type Totals,
} from "@/lib/ads/metrics";
import { byDay, splitTotals } from "@/lib/ads/series";
import type { TrackedAccount } from "@/lib/ads/types";
import type { KpiMetric } from "@/lib/types";
import { Sparkline } from "./charts";
import { CompanyMark, ReportsTable, SortTh, SyncButton, useSort, type ReportItem } from "./common";
import { Delta, StateBadge } from "./kpi";
import { CsvImportModal } from "./modals";
import { PeriodPicker } from "./period-picker";

interface Props {
  period: Period;
  tab: "clients" | "reports";
  accounts: TrackedAccount[];
  rows: { ad_account_id: string; date: string; spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number }[];
  targets: { company_id: string; metric: string; target: number }[];
  reports: ReportItem[];
  connections: number;
}

type Col = "name" | "spend" | "dspend" | "conversions" | "cpa" | "value" | "roas" | "ctr" | "cpc" | "state";

interface Line {
  id: string;
  name: string;
  color: string;
  platforms: string[];
  cur: Totals;
  prev: Totals;
  spark: number[];
  state: ReturnType<typeof worst>;
  stateDetail: string;
  synced: string | null;
  errors: number;
}

export function ReportingOverview({ period, tab, accounts, rows, targets, reports, connections }: Props) {
  const ws = useWorkspace();
  const router = useRouter();
  const currency = ws.workspace.currency || "EUR";
  const q = periodQuery(period);

  const { lines, total, prevTotal, unassigned } = useMemo(() => {
    const accCompany = new Map(accounts.map((a) => [a.id, a.company_id]));
    const byCompany = new Map<string, TrackedAccount[]>();
    for (const a of accounts) if (a.company_id) byCompany.set(a.company_id, [...(byCompany.get(a.company_id) ?? []), a]);
    const lines: Line[] = [];
    for (const [cid, accs] of byCompany) {
      const c = ws.company(cid);
      const rs = rows.filter((r) => accCompany.get(r.ad_account_id) === cid);
      const { cur, prev } = splitTotals(rs, period);
      const spark = byDay(rs, period.start, period.end).totals.map((t) => t.spend);
      const tg = targets.filter((t) => t.company_id === cid);
      const states = tg.map((t) => ({ t, s: targetState(t.metric as KpiMetric, kpi(cur, t.metric as Kpi), t.target, period.days) }));
      const synced = accs.map((a) => a.last_synced_at).filter(Boolean).sort().at(0) ?? null;
      lines.push({
        id: cid,
        name: c?.name ?? "Client supprimé",
        color: c?.color ?? "gray",
        platforms: [...new Set(accs.map((a) => a.platform))],
        cur,
        prev,
        spark,
        state: worst(states.map((x) => x.s)),
        stateDetail: states
          .filter((x) => x.s)
          .map((x) => `${x.t.metric.toUpperCase()} : ${STATE_LABEL[x.s!].toLowerCase()}`)
          .join(" · "),
        synced,
        errors: accs.filter((a) => a.sync_error).length,
      });
    }
    const { cur: total, prev: prevTotal } = splitTotals(
      rows.filter((r) => accCompany.get(r.ad_account_id)),
      period,
    );
    return { lines, total, prevTotal, unassigned: accounts.filter((a) => !a.company_id) };
  }, [accounts, rows, targets, period, ws]);

  const { sort, toggle, apply } = useSort<Col>("spend");
  const sorted = apply(lines, (l, k) => {
    if (k === "name") return l.name;
    if (k === "dspend") return l.prev.spend ? (l.cur.spend - l.prev.spend) / l.prev.spend : null;
    if (k === "state") return l.state === "good" ? 3 : l.state === "near" ? 2 : l.state === "far" ? 1 : null;
    return kpi(l.cur, k as Kpi);
  });

  const setTab = (t: string) => router.push(`${ws.base}/reporting?${q}${t === "reports" ? "&tab=reports" : ""}`, { scroll: false });
  const hasAccounts = accounts.length > 0;
  const errors = accounts.filter((a) => a.sync_error).length;

  return (
    <div className="page">
      <PageHeader title="Reporting" sub="Performance publicitaire de tous tes clients, comparée à la période précédente.">
        <Link href={`${ws.base}/settings/integrations`} className="btn">
          <Plug size={14} /> Connexions
        </Link>
        {accounts.some((a) => a.connection_id) && <SyncButton label="Tout synchroniser" />}
      </PageHeader>

      <div className="rp-tabs-row">
        <div className="tabs" role="tablist" aria-label="Vues du reporting">
          <button role="tab" aria-selected={tab === "clients"} className={`tab${tab === "clients" ? " on" : ""}`} onClick={() => setTab("clients")}>
            Clients <span className="count">{lines.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "reports"} className={`tab${tab === "reports" ? " on" : ""}`} onClick={() => setTab("reports")}>
            Rapports <span className="count">{reports.length}</span>
          </button>
        </div>
        {tab === "clients" && hasAccounts && <PeriodPicker period={period} />}
      </div>

      {tab === "reports" ? (
        <div className="card">
          <ReportsTable
            reports={reports}
            empty={
              <div className="empty">
                <div className="ic">
                  <FileText size={18} />
                </div>
                <h3>Aucun rapport pour l&apos;instant</h3>
                <p>Ouvre la fiche reporting d&apos;un client puis clique sur « Nouveau rapport » pour préparer un rapport à partager.</p>
              </div>
            }
          />
        </div>
      ) : !hasAccounts ? (
        <NoAccounts connections={connections} />
      ) : (
        <>
          {errors > 0 && (
            <div className="rp-note err" style={{ marginBottom: 16 }} role="alert">
              <span>
                {errors} compte{errors > 1 ? "s" : ""} en erreur de synchronisation.{" "}
                <Link href={`${ws.base}/settings/integrations`} style={{ textDecoration: "underline" }}>
                  Voir les connexions
                </Link>
              </span>
            </div>
          )}

          <div className="card rp-hero" aria-label="Total agence">
            <div>
              <div className="lbl">Dépense totale · {period.label.toLowerCase()}</div>
              <div className="big">{fmtKpi("spend", total.spend, currency)}</div>
              <div style={{ marginTop: 6, fontSize: 12, display: "flex", gap: 6, alignItems: "center" }} className="faint">
                <Delta metric="spend" cur={total.spend} prev={prevTotal.spend} /> vs période précédente
              </div>
            </div>
            <div className="figs">
              {(["conversions", "cpa", "value", "roas"] as Kpi[]).map((k) => (
                <div key={k}>
                  <div className="lbl">{{ conversions: "Conversions", cpa: "CPA moyen", value: "Valeur générée", roas: "ROAS" }[k as string]}</div>
                  <div className="v num">{fmtKpi(k, kpi(total, k), currency)}</div>
                  <div style={{ marginTop: 2 }}>
                    <Delta metric={k} cur={kpi(total, k)} prev={kpi(prevTotal, k)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card rp-section">
            <div className="card-h">
              <h2>Clients</h2>
              <span className="faint" style={{ fontSize: 12 }}>
                {lines.length} client{lines.length > 1 ? "s" : ""} avec des comptes publicitaires
              </span>
            </div>
            <div className="rp-scroll">
              <table className="tbl rp-tbl" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <SortTh k="name" sort={sort} onSort={toggle}>Client</SortTh>
                    <SortTh k="spend" sort={sort} onSort={toggle} right>Dépense</SortTh>
                    <SortTh k="dspend" sort={sort} onSort={toggle} right>Évol.</SortTh>
                    <th>Tendance</th>
                    <SortTh k="conversions" sort={sort} onSort={toggle} right>Conv.</SortTh>
                    <SortTh k="cpa" sort={sort} onSort={toggle} right>CPA</SortTh>
                    <SortTh k="value" sort={sort} onSort={toggle} right>Valeur</SortTh>
                    <SortTh k="roas" sort={sort} onSort={toggle} right>ROAS</SortTh>
                    <SortTh k="ctr" sort={sort} onSort={toggle} right>CTR</SortTh>
                    <SortTh k="cpc" sort={sort} onSort={toggle} right>CPC</SortTh>
                    <SortTh k="state" sort={sort} onSort={toggle}>Objectifs</SortTh>
                    <th aria-label="Ouvrir" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((l) => {
                    const href = `${ws.base}/reporting/${l.id}?${q}`;
                    return (
                      <tr key={l.id} className="link" onClick={() => router.push(href)}>
                        <td>
                          <Link href={href} className="client" onClick={(e) => e.stopPropagation()}>
                            <CompanyMark name={l.name} color={l.color} />
                            <span style={{ minWidth: 0 }}>
                              <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{l.name}</span>
                              <span className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {l.platforms.map((p) => (
                                  <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <i className="rp-dot" style={{ ["--c" as string]: platformColor(p) }} />
                                    {PLATFORM_META[p as keyof typeof PLATFORM_META]?.short ?? p}
                                  </span>
                                ))}
                                {l.errors > 0 && <span style={{ color: "var(--red)" }}>erreur de synchro</span>}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="r" style={{ fontWeight: 500 }}>{fmtKpi("spend", l.cur.spend, currency)}</td>
                        <td className="r"><Delta metric="spend" cur={l.cur.spend} prev={l.prev.spend} /></td>
                        <td><Sparkline values={l.spark} label={`Dépense quotidienne de ${l.name}`} /></td>
                        <td className="r">
                          {fmtKpi("conversions", l.cur.conversions, currency)}
                          <div><Delta metric="conversions" cur={l.cur.conversions} prev={l.prev.conversions} /></div>
                        </td>
                        <td className="r">{fmtKpi("cpa", kpi(l.cur, "cpa"), currency)}</td>
                        <td className="r">{fmtKpi("value", l.cur.value, currency)}</td>
                        <td className="r">{fmtKpi("roas", kpi(l.cur, "roas"), currency)}</td>
                        <td className="r">{fmtKpi("ctr", kpi(l.cur, "ctr"), currency)}</td>
                        <td className="r">{fmtKpi("cpc", kpi(l.cur, "cpc"), currency)}</td>
                        <td>{l.state ? <StateBadge state={l.state} short title={l.stateDetail} /> : <span className="fainter" style={{ fontSize: 12 }}>Aucun objectif</span>}</td>
                        <td className="r"><ChevronRight size={14} className="fainter" /></td>
                      </tr>
                    );
                  })}
                </tbody>
                {lines.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total agence</td>
                      <td className="r">{fmtKpi("spend", total.spend, currency)}</td>
                      <td className="r"><Delta metric="spend" cur={total.spend} prev={prevTotal.spend} /></td>
                      <td />
                      <td className="r">{fmtKpi("conversions", total.conversions, currency)}</td>
                      <td className="r">{fmtKpi("cpa", kpi(total, "cpa"), currency)}</td>
                      <td className="r">{fmtKpi("value", total.value, currency)}</td>
                      <td className="r">{fmtKpi("roas", kpi(total, "roas"), currency)}</td>
                      <td className="r">{fmtKpi("ctr", kpi(total, "ctr"), currency)}</td>
                      <td className="r">{fmtKpi("cpc", kpi(total, "cpc"), currency)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {unassigned.length > 0 && (
            <div className="rp-note rp-section">
              <Plug size={15} />
              <span>
                {unassigned.length} compte{unassigned.length > 1 ? "s" : ""} suivi{unassigned.length > 1 ? "s" : ""} sans client associé (
                {unassigned.slice(0, 3).map((a) => `${a.name} · ${platformName(a.platform)}`).join(", ")}
                {unassigned.length > 3 ? "…" : ""}) : ses données ne comptent pas dans ce tableau.{" "}
                <Link href={`${ws.base}/settings/integrations`} style={{ textDecoration: "underline" }}>
                  Associer à un client
                </Link>
              </span>
            </div>
          )}
          <p className="fainter" style={{ fontSize: 12, marginTop: 12 }}>
            Dernière synchronisation :{" "}
            {(() => {
              const last = accounts.map((a) => a.last_synced_at).filter(Boolean).sort().at(-1);
              return last ? ago(last) : "jamais";
            })()}
            . Montants en {currency}, conversions telles que remontées par chaque régie.
          </p>
        </>
      )}
    </div>
  );
}

function NoAccounts({ connections }: { connections: number }) {
  const ws = useWorkspace();
  const [csv, setCsv] = useState(false);
  return (
    <div className="card">
      <div className="empty" style={{ padding: "48px 24px 36px" }}>
        <div className="ic">
          <Plug size={18} />
        </div>
        <h3>Aucun compte publicitaire suivi</h3>
        <p>
          {connections
            ? "Ta connexion est prête : choisis maintenant les comptes à suivre et associe chacun à un client."
            : "Connecte Meta Ads ou Google Ads pour voir les performances de tes clients ici, mises à jour chaque jour."}
        </p>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href={`${ws.base}/settings/integrations`} className="btn btn-primary">
            <Plug size={14} /> {connections ? "Choisir les comptes" : "Connecter une plateforme"}
          </Link>
        </div>
        <div className="rp-guide">
          <div className="st">
            <span className="n">1</span>
            <h4>Configure les clés</h4>
            <p>Crée une app Meta et un projet Google Cloud, puis renseigne les variables d&apos;environnement (guide dans docs/reporting.md).</p>
          </div>
          <div className="st">
            <span className="n">2</span>
            <h4>Connecte tes comptes</h4>
            <p>Dans Réglages &gt; Connexions publicitaires, autorise l&apos;accès en lecture à tes comptes Meta et Google Ads.</p>
          </div>
          <div className="st">
            <span className="n">3</span>
            <h4>Associe-les à tes clients</h4>
            <p>Coche les comptes à suivre et choisis le client de chacun : 90 jours d&apos;historique sont importés.</p>
          </div>
        </div>
        {ws.canWrite && (
          <p className="faint" style={{ fontSize: 12.5, marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            Autre régie (TikTok, LinkedIn…) ou pas encore d&apos;accès API ?
            <button className="btn btn-sm" onClick={() => setCsv(true)}>
              <Upload size={12} /> Importer un CSV
            </button>
          </p>
        )}
      </div>
      {csv && <CsvImportModal companyId={null} accounts={[]} onClose={() => setCsv(false)} />}
    </div>
  );
}
