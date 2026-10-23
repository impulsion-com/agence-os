"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChartNoAxesCombined, ChevronRight, Lightbulb, MousePointerClick } from "lucide-react";

import { useWorkspace } from "@/lib/workspace/context";
import { fmtKpi, kpi, periodQuery, platformColor, platformName, type Kpi, type Period } from "@/lib/ads/metrics";
import { buildTree, flatten, type AdTreeData, type CampaignAgg, type TreeLevel, type TreeNode } from "@/lib/ads/tree";
import type { TrackedAccount } from "@/lib/ads/types";
import { SortTh, useSort } from "./common";
import { Delta } from "./kpi";

type Col = "name" | "spend" | "dspend" | "ctr" | "cpc" | "conversions" | "cpa" | "roas" | "sales" | "revenue" | "rroas";

const LEVELS: { id: TreeLevel; name: string }[] = [
  { id: "campaign", name: "Campagnes" },
  { id: "adset", name: "Ensembles" },
  { id: "ad", name: "Publicités" },
];

const EMPTY: AdTreeData = { ads: [], prevAds: [], info: {}, attribution: {}, concepts: {} };

const FORMAT: Record<string, string> = { image: "Image", video: "Vidéo", carousel: "Carrousel", dpa: "Catalogue", search: "Annonce texte", other: "Autre" };

/**
 * Détail d'un client : campagnes dépliables en ensembles puis en publicités, ou liste à plat
 * d'un niveau. Les colonnes « suivies » (tracking) n'apparaissent que si des ventes remontent.
 */
export function CampaignTree({
  period,
  company,
  accounts,
  campaigns,
  prevCampaigns,
  data,
}: {
  period: Period;
  company: { id: string; name: string };
  accounts: TrackedAccount[];
  campaigns: CampaignAgg[];
  prevCampaigns: CampaignAgg[];
  data: AdTreeData | null;
}) {
  const ws = useWorkspace();
  const currency = ws.workspace.currency || "EUR";
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const [level, setLevel] = useState<TreeLevel>("campaign");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { sort, toggle, apply } = useSort<Col>("spend");

  const tree = useMemo(() => buildTree(campaigns, prevCampaigns, data ?? EMPTY), [campaigns, prevCampaigns, data]);
  const tracked = Object.keys(data?.attribution ?? {}).length > 0;

  // nom des parents, pour situer un ensemble ou une publicité dans les vues à plat
  const parents = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of tree)
      for (const s of c.children) {
        m.set(s.id, c.name);
        for (const a of s.children) m.set(a.id, `${c.name} › ${s.name}`);
      }
    return m;
  }, [tree]);

  const get = (n: TreeNode, k: Col): number | string | null => {
    if (k === "name") return n.name;
    if (k === "dspend") return n.prevSpend ? (n.t.spend - n.prevSpend) / n.prevSpend : null;
    if (k === "sales") return n.sales;
    if (k === "revenue") return n.revenue;
    if (k === "rroas") return n.t.spend ? n.revenue / n.t.spend : null;
    return kpi(n.t, k as Kpi);
  };
  const sorted = (nodes: TreeNode[]) => apply(nodes, get);

  const rows = level === "campaign" ? sorted(tree) : sorted(flatten(tree, level));
  const canExpand = level !== "ad";
  const flip = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOpen = tree.length > 0 && tree.every((c) => !c.children.length || open.has(c.id));
  const expandAll = () => setOpen(allOpen ? new Set() : new Set(tree.flatMap((c) => [c.id, ...c.children.map((s) => s.id)])));
  const total = level === "campaign" ? tree.length : rows.length;
  const unit = LEVELS.find((l) => l.id === level)!.name.toLowerCase();

  const line = (n: TreeNode, depth: number): ReactNode => {
    const acc = accById.get(n.accountId);
    const kids = n.children.length > 0 && canExpand && (level === "campaign" || depth === 0);
    const isOpen = open.has(n.id);
    const sub =
      n.level === "ad" && n.ad
        ? [n.ad.format ? FORMAT[n.ad.format] ?? n.ad.format : null, n.ad.status, n.ad.frequency ? `fréq. 7 j ${n.ad.frequency.toFixed(1)}` : null, depth === 0 ? parents.get(n.id) : null]
            .filter(Boolean)
            .join(" · ")
        : depth === 0 && n.level === "adset"
          ? parents.get(n.id)
          : n.level === "campaign"
            ? `${acc?.name ?? ""}${!n.children.length ? " · pas de détail par publicité" : ""}`
            : `${n.children.length} publicité${n.children.length > 1 ? "s" : ""}`;
    return (
      <Fragment key={n.id}>
        <tr className={`tr-${n.level}${kids ? " link" : ""}`} onClick={kids ? () => flip(n.id) : undefined}>
          <td style={{ maxWidth: 340 }}>
            <span className="client" style={{ paddingLeft: depth * 22 }}>
              {kids ? (
                <button
                  type="button"
                  className="tr-tog"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Replier ${n.name}` : `Déplier ${n.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    flip(n.id);
                  }}
                >
                  <ChevronRight size={13} style={{ transform: isOpen ? "rotate(90deg)" : undefined, transition: "transform var(--dur)" }} />
                </button>
              ) : (
                <span className="tr-tog" aria-hidden />
              )}
              {n.level === "ad" && n.ad?.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.ad.thumb} alt="" width={30} height={30} className="tr-thumb" />
              ) : n.level === "campaign" ? (
                <span className="rp-dot" style={{ ["--c" as string]: platformColor(acc?.platform ?? "other") }} title={platformName(acc?.platform ?? "other")} />
              ) : null}
              <span style={{ minWidth: 0 }}>
                <span className="trunc" style={{ display: "block", fontWeight: n.level === "campaign" ? 500 : 400 }} title={n.name}>
                  {n.name}
                </span>
                {sub && (
                  <span className="sub trunc" style={{ display: "block" }}>
                    {sub}
                  </span>
                )}
              </span>
              {n.ad?.conceptId && ws.has("creatives") && (
                <Link href={`${ws.base}/creatives/${n.ad.conceptId}`} className="tr-concept" title="Ouvrir le concept créa" onClick={(e) => e.stopPropagation()}>
                  <Lightbulb size={12} /> Concept
                </Link>
              )}
            </span>
          </td>
          <td className="r" style={{ fontWeight: 500 }}>{fmtKpi("spend", n.t.spend, currency)}</td>
          <td className="r"><Delta metric="spend" cur={n.t.spend} prev={n.prevSpend} /></td>
          <td className="r">{fmtKpi("ctr", kpi(n.t, "ctr"), currency)}</td>
          <td className="r">{fmtKpi("cpc", kpi(n.t, "cpc"), currency)}</td>
          <td className="r">{fmtKpi("conversions", n.t.conversions, currency)}</td>
          <td className="r">{fmtKpi("cpa", kpi(n.t, "cpa"), currency)}</td>
          <td className="r">{fmtKpi("roas", kpi(n.t, "roas"), currency)}</td>
          {tracked && (
            <>
              <td className="r tr-att">{n.sales ? fmtKpi("conversions", n.sales, currency) : "–"}</td>
              <td className="r tr-att">{n.revenue ? fmtKpi("value", n.revenue, currency) : "–"}</td>
              <td className="r tr-att">{n.t.spend && n.revenue ? fmtKpi("roas", n.revenue / n.t.spend, currency) : "–"}</td>
            </>
          )}
        </tr>
        {kids && isOpen && sorted(n.children).map((c) => line(c, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="card rp-section">
      <div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2>Détail</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            {total} {unit} sur la période
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="seg" role="group" aria-label="Niveau affiché">
            {LEVELS.map((l) => (
              <button key={l.id} type="button" className={level === l.id ? "on" : ""} aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
          {level === "campaign" && tree.some((c) => c.children.length) && (
            <button type="button" className="btn btn-sm" onClick={expandAll}>
              {allOpen ? "Tout replier" : "Tout déplier"}
            </button>
          )}
          {ws.has("creatives") && (
            <Link className="btn btn-sm" href={`${ws.base}/creatives?view=analysis&company=${company.id}&${periodQuery(period)}`}>
              <ChartNoAxesCombined size={13} /> Analyse créa
            </Link>
          )}
        </div>
      </div>
      {rows.length ? (
        <div className="rp-scroll">
          <table className="tbl rp-tbl tr-tbl" style={{ minWidth: tracked ? 1040 : 820 }}>
            <thead>
              <tr>
                <SortTh k="name" sort={sort} onSort={toggle}>{LEVELS.find((l) => l.id === level)!.name.slice(0, -1)}</SortTh>
                <SortTh k="spend" sort={sort} onSort={toggle} right>Dépense</SortTh>
                <SortTh k="dspend" sort={sort} onSort={toggle} right>Évol.</SortTh>
                <SortTh k="ctr" sort={sort} onSort={toggle} right>CTR</SortTh>
                <SortTh k="cpc" sort={sort} onSort={toggle} right>CPC</SortTh>
                <SortTh k="conversions" sort={sort} onSort={toggle} right>Conv.</SortTh>
                <SortTh k="cpa" sort={sort} onSort={toggle} right>CPA</SortTh>
                <SortTh k="roas" sort={sort} onSort={toggle} right>ROAS</SortTh>
                {tracked && (
                  <>
                    <SortTh k="sales" sort={sort} onSort={toggle} right className="tr-att">Ventes suivies</SortTh>
                    <SortTh k="revenue" sort={sort} onSort={toggle} right className="tr-att">CA suivi</SortTh>
                    <SortTh k="rroas" sort={sort} onSort={toggle} right className="tr-att">ROAS réel</SortTh>
                  </>
                )}
              </tr>
            </thead>
            <tbody>{rows.map((n) => line(n, 0))}</tbody>
          </table>
        </div>
      ) : (
        <div className="empty" style={{ padding: 32 }}>
          <p>Aucune dépense sur la période.</p>
        </div>
      )}
      <p className="faint tr-foot">
        {tracked ? (
          <>Conv. et ROAS : chiffres déclarés par les plateformes. Ventes suivies : ventes et deals gagnés que ton tracking relie au dernier clic sur une publicité.</>
        ) : ws.has("tracking") ? (
          <>
            <MousePointerClick size={12} /> Les ventes réelles par publicité s&apos;afficheront ici dès que le tracking recevra des ventes.{" "}
            <Link href={`${ws.base}/tracking`} style={{ textDecoration: "underline" }}>
              Configurer l&apos;attribution
            </Link>
          </>
        ) : (
          <>Conv. et ROAS : chiffres déclarés par les plateformes.</>
        )}
      </p>
    </div>
  );
}
