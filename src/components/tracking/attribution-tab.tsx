"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Info, Plug, Radar } from "lucide-react";

import { DailyChart } from "@/components/reporting/charts";
import { SortTh, useSort } from "@/components/reporting/common";
import { Delta } from "@/components/reporting/kpi";
import { PeriodPicker } from "@/components/reporting/period-picker";
import { Menu } from "@/components/ui/overlay";
import { useWorkspace } from "@/lib/workspace/context";
import { fmtKpi, type Kpi, type Period } from "@/lib/ads/metrics";
import { MODELS, WINDOWS, modelName, type ModelId } from "@/lib/tracking/attribution";
import { channelName, isPaid } from "@/lib/tracking/channels";
import type { AttrRow, DailyPoint, FlatRow, Goal, Kpis, Overview, SiteRow } from "@/lib/tracking/load";
import { ChannelLabel, fmtConv, fmtPct, useQueryNav } from "./shared";

// ---------------------------------------------------------------------
// Barre de filtres (partagée avec l'onglet Parcours)
// ---------------------------------------------------------------------
export function AttrFilters({ period, model, window, goal, site }: { period: Period; model: ModelId; window: number; goal: Goal; site: SiteRow }) {
  const go = useQueryNav();
  return (
    <div className="trk-filters">
      <PeriodPicker period={period} />
      <Menu
        width={300}
        trigger={(open, isOpen) => (
          <button type="button" className="btn" onClick={open} aria-haspopup="menu" aria-expanded={isOpen}>
            <span className="faint">Modèle</span> {modelName(model)}
            <ChevronDown size={13} className="faint" />
          </button>
        )}
        items={MODELS.map((m) => ({
          label: m.name,
          sub: m.id === site.settings.model ? "par défaut" : undefined,
          checked: m.id === model,
          onSelect: () => go({ model: m.id === site.settings.model ? null : m.id }),
        }))}
      />
      <Menu
        width={220}
        trigger={(open, isOpen) => (
          <button type="button" className="btn" onClick={open} aria-haspopup="menu" aria-expanded={isOpen}>
            <span className="faint">Fenêtre</span> {window} j
            <ChevronDown size={13} className="faint" />
          </button>
        )}
        items={WINDOWS.map((w) => ({
          label: `${w} jour${w > 1 ? "s" : ""}`,
          sub: w === site.settings.window_days ? "par défaut" : undefined,
          checked: w === window,
          onSelect: () => go({ window: w === site.settings.window_days ? null : String(w) }),
        }))}
      />
      <div className="seg" role="group" aria-label="Objectif">
        <button type="button" className={goal === "sales" ? "on" : ""} aria-pressed={goal === "sales"} onClick={() => go({ goal: null })}>
          Ventes
        </button>
        <button type="button" className={goal === "leads" ? "on" : ""} aria-pressed={goal === "leads"} onClick={() => go({ goal: "leads" })}>
          Prospects
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function Card({ label, help, value, delta, foot }: { label: string; help: string; value: string; delta?: ReactNode; foot?: ReactNode }) {
  return (
    <div className="rp-kpi">
      <div className="k">
        {label}
        <span title={help} className="fainter" style={{ display: "inline-flex" }}>
          <Info size={12} aria-label={help} />
        </span>
      </div>
      <div className="v">{value}</div>
      {delta && <div className="d">{delta}</div>}
      {foot && <div className="tg">{foot}</div>}
    </div>
  );
}

function KpiGrid({ cur, prev, currency, goal }: { cur: Kpis; prev: Kpis; currency: string; goal: Goal }) {
  const vs = <span>vs période précédente</span>;
  const roas = ratio(cur.paidValue, cur.spend);
  const proas = ratio(cur.platformValue, cur.spend);
  const cpa = ratio(cur.spend, cur.paidConv);
  const pcpa = ratio(cur.spend, cur.platformConv);
  const rate = cur.visitors ? ((goal === "leads" ? cur.leads : cur.sales) / cur.visitors) * 100 : null;
  const prate = prev.visitors ? ((goal === "leads" ? prev.leads : prev.sales) / prev.visitors) * 100 : null;
  return (
    <div className="rp-kpis trk-kpis">
      <Card label="Visiteurs" help="Visiteurs uniques arrivés sur le site pendant la période" value={fmtKpi("impressions", cur.visitors)} delta={<><Delta metric="clicks" cur={cur.visitors} prev={prev.visitors} />{vs}</>} />
      <Card label="Prospects" help="Personnes identifiées (formulaire, identify) ou ayant déclenché un évènement lead ou booking" value={fmtKpi("impressions", cur.leads)} delta={<><Delta metric="conversions" cur={cur.leads} prev={prev.leads} />{vs}</>} />
      <Card label="Ventes" help="Achats et deals gagnés enregistrés sur la période, toutes sources confondues" value={fmtKpi("conversions", cur.sales)} delta={<><Delta metric="conversions" cur={cur.sales} prev={prev.sales} />{vs}</>} />
      <Card label="Chiffre d'affaires" help="Somme des achats et deals gagnés de la période" value={fmtKpi("value", cur.revenue, currency)} delta={<><Delta metric="value" cur={cur.revenue} prev={prev.revenue} />{vs}</>} />
      <Card
        label="Taux de conversion"
        help={goal === "leads" ? "Prospects divisés par les visiteurs" : "Ventes divisées par les visiteurs"}
        value={fmtPct(rate)}
        delta={<><Delta metric="ctr" cur={rate} prev={prate} />{vs}</>}
      />
      <Card label="Dépense publicitaire" help="Dépense des comptes publicitaires du client sur la période" value={fmtKpi("spend", cur.spend, currency)} delta={<><Delta metric="spend" cur={cur.spend} prev={prev.spend} />{vs}</>} />
      {goal === "sales" ? (
        <>
          <Card
            label="ROAS réel"
            help="Chiffre d'affaires attribué aux canaux payants par le modèle choisi, divisé par la dépense"
            value={fmtKpi("roas", roas)}
            delta={<><Delta metric="roas" cur={roas} prev={ratio(prev.paidValue, prev.spend)} />{vs}</>}
            foot={<span>CPA réel {fmtKpi("cpa", cpa, currency)}</span>}
          />
          <Card
            label="ROAS plateforme"
            help="Valeur de conversion déclarée par Meta, Google… divisée par la dépense"
            value={fmtKpi("roas", proas)}
            delta={
              <>
                <Delta metric="spend" cur={roas} prev={proas} title="Écart entre ROAS réel et ROAS déclaré" />
                <span>écart du réel</span>
              </>
            }
            foot={<span>CPA plateforme {fmtKpi("cpa", pcpa, currency)}</span>}
          />
        </>
      ) : (
        <>
          <Card
            label="CPA réel"
            help="Dépense divisée par les prospects attribués aux canaux payants"
            value={fmtKpi("cpa", cpa, currency)}
            delta={<><Delta metric="cpa" cur={cpa} prev={ratio(prev.spend, prev.paidConv)} />{vs}</>}
            foot={<span>{fmtConv(cur.paidConv)} prospects attribués aux pubs</span>}
          />
          <Card
            label="CPA plateforme"
            help="Dépense divisée par les conversions déclarées par les plateformes"
            value={fmtKpi("cpa", pcpa, currency)}
            delta={
              <>
                <Delta metric="spend" cur={cpa} prev={pcpa} title="Écart entre CPA réel et CPA déclaré" />
                <span>écart du réel</span>
              </>
            }
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Onglet
// ---------------------------------------------------------------------
type View = "tree" | "source_medium" | "adset" | "link";
const VIEWS: { id: View; name: string }[] = [
  { id: "tree", name: "Canaux et campagnes" },
  { id: "source_medium", name: "Source / medium" },
  { id: "adset", name: "Ensembles" },
  { id: "link", name: "Liens courts" },
];

export function AttributionTab({ site, period, model, window, goal, overview }: { site: SiteRow; period: Period; model: ModelId; window: number; goal: Goal; overview: Overview }) {
  const ws = useWorkspace();
  const currency = ws.workspace.currency || "EUR";
  const sales = goal === "sales";
  const metrics: Kpi[] = sales ? ["conversions", "value", "roas", "cpa"] : ["conversions", "cpa"];
  const [metric, setMetric] = useState<Kpi>("conversions");
  const shown = metrics.includes(metric) ? metric : "conversions";
  const [view, setView] = useState<View>("tree");
  const { cur, prev } = overview.kpis;

  const val = (p: DailyPoint | undefined): number | null => {
    if (!p) return null;
    switch (shown) {
      case "value":
        return p.value;
      case "roas":
        return ratio(p.paidValue, p.spend);
      case "cpa":
        return ratio(p.spend, p.paidConv);
      default:
        return p.conv;
    }
  };
  const empty = cur.visitors === 0 && overview.convCount === 0 && prev.visitors === 0;

  return (
    <>
      <AttrFilters period={period} model={model} window={window} goal={goal} site={site} />
      {empty ? (
        <div className="card">
          <div className="empty">
            <div className="ic">
              <Radar size={18} />
            </div>
            <h3>Aucune donnée sur la période</h3>
            <p>Le script n&apos;a encore rien envoyé pour ce site sur cette période. Vérifie l&apos;installation avec le testeur en direct.</p>
            <Link className="btn btn-primary" href={`${ws.base}/tracking/${site.id}?tab=install`} style={{ marginTop: 8 }}>
              Ouvrir l&apos;installation
            </Link>
          </div>
        </div>
      ) : (
        <>
          <KpiGrid cur={cur} prev={prev} currency={currency} goal={goal} />

          <div className="card rp-section" style={{ minWidth: 0 }}>
            <div className="card-h" style={{ flexWrap: "wrap" }}>
              <h2>Évolution quotidienne</h2>
              <div className="seg" role="group" aria-label="Indicateur affiché">
                {metrics.map((m) => (
                  <button key={m} type="button" className={shown === m ? "on" : ""} aria-pressed={shown === m} onClick={() => setMetric(m)}>
                    {m === "conversions" ? (sales ? "Ventes" : "Prospects") : m === "value" ? "Chiffre d'affaires" : m === "roas" ? "ROAS réel" : "CPA réel"}
                  </button>
                ))}
              </div>
            </div>
            <DailyChart
              days={overview.days}
              spend={overview.daily.map((p) => p.spend)}
              metric={shown}
              values={overview.daily.map(val)}
              prev={overview.days.map((_, i) => val(overview.prevDaily[i]))}
              currency={currency}
            />
          </div>

          {overview.accounts === 0 && (
            <div className="rp-note warn rp-section" role="note">
              <Plug size={15} />
              <span>
                Aucun compte publicitaire n&apos;est associé à {ws.company(site.company_id)?.name ?? "l'agence"} : la dépense, le CPA et le ROAS ne sont pas calculables.{" "}
                <Link href={`${ws.base}/settings/integrations`} style={{ textDecoration: "underline" }}>
                  Associer un compte
                </Link>
              </span>
            </div>
          )}

          <div className="card rp-section">
            <div className="card-h" style={{ flexWrap: "wrap" }}>
              <h2>Attribution {sales ? "des ventes" : "des prospects"}</h2>
              <div className="seg trk-views" role="group" aria-label="Regroupement">
                {VIEWS.map((v) => (
                  <button key={v.id} type="button" className={view === v.id ? "on" : ""} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
            {view === "tree" ? (
              <TreeTable rows={overview.tree} currency={currency} sales={sales} />
            ) : (
              <FlatTable rows={overview.flat[view]} currency={currency} sales={sales} view={view} />
            )}
            <div className="trk-foot">
              <Check size={12} aria-hidden />
              <span>
              Crédit réparti selon le modèle « {modelName(model)} » sur une fenêtre de {window} jour{window > 1 ? "s" : ""}, en suivant la
              personne sur tous ses appareils. Les conversions plateforme sont celles déclarées par Meta, Google… avec leur propre fenêtre (souvent 7 jours après clic et 1 jour
              après vue), d&apos;où l&apos;écart.
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Tableau dépliable canal → campagne → annonce
// ---------------------------------------------------------------------
type Col = "name" | "spend" | "conversions" | "value" | "cpa" | "roas" | "pconv" | "proas" | "gap";

function metricsOf(r: { spend: number | null; conversions: number; value: number; pconv: number | null; pvalue: number | null }) {
  const spend = r.spend ?? 0;
  return {
    cpa: r.spend !== null ? ratio(spend, r.conversions) : null,
    roas: r.spend !== null ? ratio(r.value, spend) : null,
    proas: r.spend !== null && r.pvalue !== null ? ratio(r.pvalue, spend) : null,
    gap: r.pconv ? ((r.conversions - r.pconv) / r.pconv) * 100 : null,
  };
}

function TreeTable({ rows, currency, sales }: { rows: AttrRow[]; currency: string; sales: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(rows.filter((r) => isPaid(r.channel)).map((r) => r.id)));
  const { sort, toggle, apply } = useSort<Col>(sales ? "value" : "conversions");
  const get = (r: AttrRow, k: Col): number | string | null => {
    if (k === "name") return channelName(r.label);
    if (k === "spend") return r.spend;
    if (k === "conversions") return r.conversions;
    if (k === "value") return r.value;
    if (k === "pconv") return r.pconv;
    return metricsOf(r)[k];
  };
  const sorted = useMemo(() => apply(rows, get), [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce(
    (t, r) => ({
      spend: t.spend + (r.spend ?? 0),
      conversions: t.conversions + r.conversions,
      value: t.value + r.value,
      pconv: t.pconv + (r.pconv ?? 0),
      pvalue: t.pvalue + (r.pvalue ?? 0),
    }),
    { spend: 0, conversions: 0, value: 0, pconv: 0, pvalue: 0 },
  );
  const hasSpend = rows.some((r) => r.spend !== null);

  if (!rows.length) return <div className="empty" style={{ padding: 28 }}><p>Aucune conversion sur la période.</p></div>;

  const line = (r: AttrRow): ReactNode => {
    const m = metricsOf(r);
    const kids = r.level < 2 && r.children.length > 0;
    const isOpen = open.has(r.id);
    const name = r.level === 0 ? channelName(r.label) : r.label;
    return (
      <Fragment key={r.id}>
        <tr className={`lv${r.level}`}>
          <td className="nm">
            <span className="trk-indent" style={{ ["--lv" as string]: r.level }}>
              {kids ? (
                <button
                  type="button"
                  className="trk-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Replier" : "Déplier"} ${name}`}
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(r.id)) n.delete(r.id);
                      else n.add(r.id);
                      return n;
                    })
                  }
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="trk-toggle-sp" />
              )}
              {r.level === 0 ? (
                <ChannelLabel channel={r.channel}>{name}</ChannelLabel>
              ) : (
                <span style={{ minWidth: 0 }}>
                  <span className="trunc" style={{ display: "block" }} title={name}>{name}</span>
                  {r.sub && <span className="sub trunc" style={{ display: "block" }}>{r.sub}</span>}
                </span>
              )}
            </span>
          </td>
          <td className="r">{r.spend === null ? <span className="fainter">–</span> : fmtKpi("spend", r.spend, currency)}</td>
          <td className="r strong">{fmtConv(r.conversions)}</td>
          {sales && <td className="r">{fmtKpi("value", r.value, currency)}</td>}
          <td className="r">{fmtKpi("cpa", m.cpa, currency)}</td>
          {sales && <td className="r strong">{fmtKpi("roas", m.roas, currency)}</td>}
          <td className="r muted">{r.pconv === null ? <span className="fainter">–</span> : fmtConv(r.pconv)}</td>
          {sales && <td className="r muted">{fmtKpi("roas", m.proas, currency)}</td>}
          <td className="r">{m.gap === null ? <span className="fainter">–</span> : <Delta metric="spend" cur={r.conversions} prev={r.pconv} title="Conversions attribuées vs déclarées par la plateforme" />}</td>
        </tr>
        {kids && isOpen && r.children.map(line)}
      </Fragment>
    );
  };

  const tm = metricsOf({ ...total, spend: hasSpend ? total.spend : null });
  return (
    <div className="rp-scroll">
      <table className="tbl rp-tbl trk-tree" style={{ minWidth: sales ? 980 : 760 }}>
        <thead>
          <tr>
            <SortTh k="name" sort={sort} onSort={toggle}>Canal, campagne, annonce</SortTh>
            <SortTh k="spend" sort={sort} onSort={toggle} right>Dépense</SortTh>
            <SortTh k="conversions" sort={sort} onSort={toggle} right>{sales ? "Ventes" : "Prospects"}</SortTh>
            {sales && <SortTh k="value" sort={sort} onSort={toggle} right>Valeur</SortTh>}
            <SortTh k="cpa" sort={sort} onSort={toggle} right>CPA</SortTh>
            {sales && <SortTh k="roas" sort={sort} onSort={toggle} right>ROAS réel</SortTh>}
            <SortTh k="pconv" sort={sort} onSort={toggle} right>Conv. plateforme</SortTh>
            {sales && <SortTh k="proas" sort={sort} onSort={toggle} right>ROAS plateforme</SortTh>}
            <SortTh k="gap" sort={sort} onSort={toggle} right>Écart</SortTh>
          </tr>
        </thead>
        <tbody>{sorted.map(line)}</tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="r">{hasSpend ? fmtKpi("spend", total.spend, currency) : "–"}</td>
            <td className="r">{fmtConv(total.conversions)}</td>
            {sales && <td className="r">{fmtKpi("value", total.value, currency)}</td>}
            <td className="r">{hasSpend ? fmtKpi("cpa", ratio(total.spend, rows.filter((r) => r.spend !== null).reduce((s, r) => s + r.conversions, 0)), currency) : "–"}</td>
            {sales && <td className="r">{hasSpend ? fmtKpi("roas", ratio(rows.filter((r) => r.spend !== null).reduce((s, r) => s + r.value, 0), total.spend), currency) : "–"}</td>}
            <td className="r">{hasSpend ? fmtConv(total.pconv) : "–"}</td>
            {sales && <td className="r">{fmtKpi("roas", tm.proas, currency)}</td>}
            <td className="r" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Vues à plat (source / medium, ensembles, liens courts)
// ---------------------------------------------------------------------
function FlatTable({ rows, currency, sales, view }: { rows: FlatRow[]; currency: string; sales: boolean; view: View }) {
  const totalC = rows.reduce((s, r) => s + r.conversions, 0);
  if (!rows.length)
    return (
      <div className="empty" style={{ padding: 28 }}>
        <p>
          {view === "link"
            ? "Aucune conversion issue d'un lien court sur la période. Les liens courts créés dans « Liens trackés » transmettent aos_lid au site."
            : view === "adset"
              ? "Aucun ensemble de publicités identifié. Ajoute aos_adset (modèles UTM Meta et Google) à tes URL."
              : "Aucune conversion sur la période."}
        </p>
      </div>
    );
  return (
    <div className="rp-scroll">
      <table className="tbl rp-tbl" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th>{view === "source_medium" ? "Source / medium" : view === "adset" ? "Ensemble de publicités" : "Lien court"}</th>
            <th className="r">{sales ? "Ventes" : "Prospects"}</th>
            <th className="r">Part</th>
            {sales && <th className="r">Valeur</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ maxWidth: 380 }}>
                <ChannelLabel channel={r.channel ?? "direct"}>
                  <span className="trunc" style={{ display: "block" }}>{r.label}</span>
                </ChannelLabel>
                {r.sub && <span className="sub trunc" style={{ display: "block", paddingLeft: 15 }}>{r.sub}</span>}
              </td>
              <td className="r strong">{fmtConv(r.conversions)}</td>
              <td className="r muted">{fmtPct(totalC ? (r.conversions / totalC) * 100 : null)}</td>
              {sales && <td className="r">{fmtKpi("value", r.value, currency)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

