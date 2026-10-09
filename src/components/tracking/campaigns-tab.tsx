"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plug, UsersRound } from "lucide-react";

import { Menu } from "@/components/ui/overlay";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import type { ModelId } from "@/lib/tracking/attribution";
import { nodeChannel, ratio, type CampNode } from "@/lib/tracking/campaigns";
import type { CampaignsData, SiteRow } from "@/lib/tracking/load";
import { useWorkspace } from "@/lib/workspace/context";
import { AttrFilters } from "./attribution-tab";
import { ChannelLabel, fmtConv, useQueryNav } from "./shared";

const dash = <span className="fainter">–</span>;

export function CampaignsTab({ site, period, model, window, data }: { site: SiteRow; period: Period; model: ModelId; window: number; data: CampaignsData }) {
  const ws = useWorkspace();
  const go = useQueryNav();
  const currency = ws.workspace.currency || "EUR";
  const { table, stages } = data;
  const [open, setOpen] = useState<Set<string>>(() => new Set(table.rows.length <= 3 ? table.rows.map((r) => r.id) : []));
  const sale = stages.filter((s) => s.kind === "sale");
  const hasValue = sale.length > 0;
  // Coût par résultat : sur la dernière étape de vente, sinon sur la dernière étape de l'entonnoir
  const result = sale.at(-1) ?? stages.at(-1);
  const sum = (n: { stages: Record<string, number> }, keys: { key: string }[]) => keys.reduce((s, k) => s + (n.stages[k.key] ?? 0), 0);

  const cells = (n: { stages: Record<string, number>; value: number; spend: number | null; pconv?: number | null }) => (
    <>
      <td className="r">{n.spend === null ? dash : fmtKpi("spend", n.spend, currency)}</td>
      {stages.map((s) => (
        <td key={s.key} className="r">{n.stages[s.key] ? fmtConv(n.stages[s.key]) : <span className="fainter">0</span>}</td>
      ))}
      {hasValue && <td className="r">{n.value ? fmtKpi("value", n.value, currency) : <span className="fainter">0</span>}</td>}
      {hasValue && <td className="r strong">{fmtKpi("roas", ratio(n.value, n.spend), currency)}</td>}
      {result && <td className="r">{fmtKpi("cpa", n.spend !== null && sum(n, [result]) > 0 ? n.spend / sum(n, [result]) : null, currency)}</td>}
      <td className="r muted">{n.pconv === null || n.pconv === undefined ? dash : fmtConv(n.pconv)}</td>
    </>
  );

  const line = (n: CampNode, lv: number) => {
    const kids = n.children.length > 0;
    const isOpen = open.has(n.id);
    return (
      <Fragment key={n.id}>
        <tr className={`lv${lv}`}>
          <td className="nm">
            <span className="trk-indent" style={{ ["--lv" as string]: lv }}>
              {kids ? (
                <button
                  type="button"
                  className="trk-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Replier" : "Déplier"} ${n.label}`}
                  onClick={() =>
                    setOpen((s) => {
                      const x = new Set(s);
                      if (x.has(n.id)) x.delete(n.id);
                      else x.add(n.id);
                      return x;
                    })
                  }
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="trk-toggle-sp" />
              )}
              {lv === 0 ? (
                <ChannelLabel channel={nodeChannel(n)}>{n.label}</ChannelLabel>
              ) : (
                <span className="trunc" title={n.label}>{n.label}</span>
              )}
            </span>
          </td>
          {cells(n)}
          <td className="r">
            {n.people.length ? (
              <Menu
                width={280}
                align="end"
                search={n.people.length > 8 ? "Rechercher…" : undefined}
                trigger={(o, isO) => (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={o} aria-haspopup="menu" aria-expanded={isO} aria-label={`Personnes créditées à ${n.label}`}>
                    <UsersRound size={12} /> {n.people.length}
                  </button>
                )}
                items={n.people.map((p) => ({ label: data.who[p] ?? "Visiteur anonyme", onSelect: () => /^[0-9a-f-]{36}$/.test(p) && go({ person: p }) }))}
              />
            ) : (
              dash
            )}
          </td>
        </tr>
        {kids && isOpen && n.children.map((c) => line(c, lv + 1))}
      </Fragment>
    );
  };

  const paidStages = Object.fromEntries(stages.map((s) => [s.key, (table.total.stages[s.key] ?? 0) - (table.organic.stages[s.key] ?? 0)]));
  const paid = { stages: paidStages, value: table.total.value - table.organic.value, spend: data.accounts ? table.total.spend : null };

  return (
    <div className="trk-col">
      <AttrFilters period={period} model={model} window={window} site={site} />

      {data.accounts === 0 && (
        <div className="rp-note warn" role="note">
          <Plug size={15} />
          <span>
            Aucun compte publicitaire n&apos;est associé à {ws.company(site.company_id)?.name ?? "l'agence"} : les campagnes apparaissent d&apos;après les liens, sans
            dépense ni ROAS.{" "}
            <Link href={`${ws.base}/settings/integrations`} style={{ textDecoration: "underline" }}>Associer un compte</Link>
          </span>
        </div>
      )}

      <section className="card">
        <div className="card-h">
          <h2>Campagnes, ensembles et publicités</h2>
        </div>
        {table.rows.length === 0 ? (
          <div className="empty" style={{ padding: 28 }}>
            <p>
              Aucune campagne sur la période. Une campagne apparaît dès qu&apos;un visiteur arrive par un lien payant (medium cpc, paid_social…) ou qu&apos;un compte
              publicitaire associé a dépensé.
            </p>
          </div>
        ) : (
          <div className="rp-scroll">
            <table className="tbl rp-tbl trk-tree" style={{ minWidth: 620 + stages.length * 110 }}>
              <thead>
                <tr>
                  <th>Campagne, ensemble, publicité</th>
                  <th className="r">Dépense</th>
                  {stages.map((s) => (
                    <th key={s.key} className="r" title={`Crédit attribué pour l'étape « ${s.label} » : une somme de poids, pas un compte de lignes`}>{s.label}</th>
                  ))}
                  {hasValue && <th className="r" title="Chiffre d'affaires des ventes, réparti selon le modèle d'attribution">CA attribué</th>}
                  {hasValue && <th className="r" title="CA attribué divisé par la dépense">ROAS réel</th>}
                  {result && <th className="r" title={`Dépense divisée par « ${result.label} »`}>Coût / {result.label.toLowerCase()}</th>}
                  <th className="r" title="Conversions que la régie déclare de son côté, au niveau campagne">Conv. régie</th>
                  <th className="r">Personnes</th>
                </tr>
              </thead>
              <tbody>{table.rows.map((r) => line(r, 0))}</tbody>
              <tfoot>
                <tr>
                  <td>Total publicité</td>
                  {cells({ ...paid, pconv: data.accounts ? table.rows.reduce((s, r) => s + (r.pconv ?? 0), 0) : null })}
                  <td />
                </tr>
                <tr>
                  <td title="Organique, direct, email, ou aucun point de contact dans la fenêtre">Hors publicité</td>
                  {cells({ ...table.organic, spend: null })}
                  <td />
                </tr>
                <tr>
                  <td>Toutes les conversions</td>
                  {cells({ stages: table.total.stages, value: table.total.value, spend: null })}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="card-b trk-prose" style={{ paddingTop: 12 }}>
          <p className="faint">
            Les trois lignes du bas se recoupent : publicité + hors publicité = toutes les conversions. Si « Hors publicité » pèse lourd sur les ventes, c&apos;est
            souvent que la source s&apos;est perdue en route : compare avec la colonne « Avec une source » de l&apos;onglet Entonnoir.
          </p>
          {!data.adLevel && table.rows.length > 0 && (
            <p className="faint">
              Pour descendre jusqu&apos;à la publicité, les URL des annonces doivent porter <code>utm_id</code>, <code>aos_adset</code> et <code>aos_ad</code> : ce
              sont les modèles UTM Meta et Google de <Link href={`${ws.base}/links`} style={{ textDecoration: "underline" }}>Liens trackés</Link>.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
