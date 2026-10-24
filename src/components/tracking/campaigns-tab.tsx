"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plug, UsersRound } from "lucide-react";

import { Menu } from "@/components/ui/overlay";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import { MODELS, type ModelId } from "@/lib/tracking/attribution";
import { nodeChannel, ratio, type CampNode } from "@/lib/tracking/campaigns";
import type { CampaignsScreen, SiteRow } from "@/lib/tracking/load";
import { HORIZONS, type Horizon } from "@/lib/tracking/ltv";
import { useWorkspace } from "@/lib/workspace/context";
import { AttrFilters } from "./attribution-tab";
import { ChannelLabel, fmtConv, useQueryNav } from "./shared";

const dash = <span className="fainter">–</span>;

/** Écart du mesuré au déclaré, en % : négatif = la régie s'attribue plus que ce que ton tracking voit. */
const gap = (measured: number, reported: number | null | undefined) => (reported && reported > 0 ? ((measured - reported) / reported) * 100 : null);
const fmtGap = (g: number | null) => {
  if (g === null) return dash;
  const r = Math.round(g);
  return <span className={Math.abs(g) < 10 ? "muted" : g < 0 ? "trk-gap neg" : "trk-gap pos"}>{`${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} %`}</span>;
};

export function CampaignsTab({ site, period, model, window, data }: { site: SiteRow; period: Period; model: ModelId; window: number; data: CampaignsScreen }) {
  const ws = useWorkspace();
  const go = useQueryNav();
  const currency = ws.workspace.currency || "EUR";
  const { table, stages } = data;
  const [open, setOpen] = useState<Set<string>>(() => new Set(table.rows.length <= 3 ? table.rows.map((r) => r.id) : []));
  const [horizon, setHorizon] = useState<Horizon>(30);
  const hasLtv = data.hasSales && Object.keys(data.ltv).length > 0;
  const sale = stages.filter((s) => s.kind === "sale");
  const hasValue = sale.length > 0;
  // Coût par résultat : sur la dernière étape de vente, sinon sur la dernière étape de l'entonnoir
  const result = sale.at(-1) ?? stages.at(-1);
  const sum = (n: { stages: Record<string, number> }, keys: { key: string }[]) => keys.reduce((s, k) => s + (n.stages[k.key] ?? 0), 0);

  const cells = (n: { id?: string; stages: Record<string, number>; value: number; spend: number | null; pconv?: number | null; pvalue?: number | null }) => {
    const l = n.id ? data.ltv[n.id] : undefined;
    const v = l?.value[horizon] ?? null;
    const cpl = l && n.spend !== null && l.people > 0 ? n.spend / l.people : null;
    return (
      <>
        <td className="r">{n.spend === null ? dash : fmtKpi("spend", n.spend, currency)}</td>
        {stages.map((s) => (
          <td key={s.key} className="r">{n.stages[s.key] ? fmtConv(n.stages[s.key]) : <span className="fainter">0</span>}</td>
        ))}
        {hasValue && <td className="r">{n.value ? fmtKpi("value", n.value, currency) : <span className="fainter">0</span>}</td>}
        {hasValue && <td className="r strong">{fmtKpi("roas", ratio(n.value, n.spend), currency)}</td>}
        {hasValue && <td className="r muted">{n.pvalue === null || n.pvalue === undefined ? dash : fmtKpi("value", n.pvalue, currency)}</td>}
        {hasValue && <td className="r">{n.pvalue === null || n.pvalue === undefined ? dash : fmtGap(gap(n.value, n.pvalue))}</td>}
        {result && <td className="r">{fmtKpi("cpa", n.spend !== null && sum(n, [result]) > 0 ? n.spend / sum(n, [result]) : null, currency)}</td>}
        <td className="r muted">{n.pconv === null || n.pconv === undefined ? dash : fmtConv(n.pconv)}</td>
        {hasLtv && (
          <td className="r" title={l ? `${l.people} prospect${l.people > 1 ? "s" : ""} entré${l.people > 1 ? "s" : ""} au premier clic, ${l.buyers} acheteur${l.buyers > 1 ? "s" : ""} ; ${l.matured[horizon]} dont la fenêtre de ${horizon} jours est écoulée` : undefined}>
            {v === null ? dash : fmtKpi("value", v, currency)}
          </td>
        )}
        {hasLtv && (
          <td className="r" title="Valeur par prospect divisée par le coût d'un prospect : au-dessus de 1, chaque prospect rapporte plus qu'il ne coûte">
            {v !== null && cpl ? <span className={v / cpl >= 1 ? "trk-gap pos" : "trk-gap neg"}>{new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v / cpl)}</span> : dash}
          </td>
        )}
      </>
    );
  };

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
      {hasLtv && (
        <div className="trk-horizon">
          <span className="faint">Valeur par prospect à</span>
          <div className="seg" role="group" aria-label="Horizon de la valeur par prospect">
            {HORIZONS.map((h) => (
              <button key={h} type="button" className={horizon === h ? "on" : ""} onClick={() => setHorizon(h)}>
                {h} jours
              </button>
            ))}
          </div>
        </div>
      )}

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
            <table className="tbl rp-tbl trk-tree" style={{ minWidth: 620 + stages.length * 110 + (hasValue ? 220 : 0) + (hasLtv ? 220 : 0) }}>
              <thead>
                <tr>
                  <th>Campagne, ensemble, publicité</th>
                  <th className="r">Dépense</th>
                  {stages.map((s) => (
                    <th key={s.key} className="r" title={`Crédit attribué pour l'étape « ${s.label} » : une somme de poids, pas un compte de lignes`}>{s.label}</th>
                  ))}
                  {hasValue && <th className="r" title="Chiffre d'affaires des ventes, réparti selon le modèle d'attribution">CA attribué</th>}
                  {hasValue && <th className="r" title="CA attribué divisé par la dépense">ROAS réel</th>}
                  {hasValue && <th className="r" title="Chiffre d'affaires que la régie s'attribue de son côté (sa propre fenêtre d'attribution)">CA régie</th>}
                  {hasValue && <th className="r" title="CA mesuré par ton tracking face au CA déclaré par la régie : négatif = la régie s'attribue plus que ce que tu mesures">Écart</th>}
                  {result && <th className="r" title={`Dépense divisée par « ${result.label} »`}>Coût / {result.label.toLowerCase()}</th>}
                  <th className="r" title="Conversions que la régie déclare de son côté">Conv. régie</th>
                  {hasLtv && <th className="r" title={`Ce que rapporte en moyenne une personne entrée par cette ligne (premier clic), dans les ${horizon} jours qui suivent, non-acheteurs compris`}>Valeur / prospect {horizon} j</th>}
                  {hasLtv && <th className="r" title="Valeur par prospect divisée par le coût d'un prospect">Valeur ÷ coût</th>}
                  <th className="r">Personnes</th>
                </tr>
              </thead>
              <tbody>{table.rows.map((r) => line(r, 0))}</tbody>
              <tfoot>
                <tr>
                  <td>Total publicité</td>
                  {cells({ ...paid, pconv: data.accounts ? table.rows.reduce((s, r) => s + (r.pconv ?? 0), 0) : null, pvalue: data.accounts ? table.rows.reduce((s, r) => s + (r.pvalue ?? 0), 0) : null })}
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

      {data.hasSales && table.rows.length > 0 && <ModelCompare data={data} model={model} currency={currency} />}
      {hasLtv && data.cohorts.length > 0 && <Cohorts data={data} currency={currency} />}
    </div>
  );
}

/** Le même chiffre d'affaires réparti par chaque modèle, campagne par campagne (Compare Attribution Modes de Hyros). */
function ModelCompare({ data, model, currency }: { data: CampaignsScreen; model: ModelId; currency: string }) {
  const rows = useMemo(
    () =>
      data.table.rows
        .filter((r) => data.models[r.id])
        .map((r) => ({ id: r.id, label: r.label, node: r, v: data.models[r.id] }))
        .sort((a, b) => b.v[model] - a.v[model])
        .slice(0, 10),
    [data, model],
  );
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-h">
        <h2>Comparer les modèles</h2>
        <span className="faint" style={{ fontSize: 12 }}>CA attribué à chaque campagne selon le modèle ; l&apos;écart dit combien une campagne dépend de sa place dans le parcours</span>
      </div>
      <div className="rp-scroll">
        <table className="tbl rp-tbl" style={{ minWidth: 300 + MODELS.length * 110 }}>
          <thead>
            <tr>
              <th>Campagne</th>
              {MODELS.map((m) => (
                <th key={m.id} className={`r${m.id === model ? " trk-cur" : ""}`} title={m.help}>
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const vals = MODELS.map((m) => r.v[m.id]);
              const max = Math.max(...vals);
              const min = Math.min(...vals);
              return (
                <tr key={r.id}>
                  <td>
                    <ChannelLabel channel={nodeChannel(r.node)}>{r.label}</ChannelLabel>
                  </td>
                  {MODELS.map((m) => {
                    const v = r.v[m.id];
                    return (
                      <td
                        key={m.id}
                        className={`r${m.id === model ? " trk-cur strong" : ""}${max > min && v === max ? " trk-max" : max > min && v === min ? " trk-min" : ""}`}
                        title={r.node.spend ? `ROAS réel : ${fmtKpi("roas", ratio(v, r.node.spend), currency)}` : undefined}
                      >
                        {v ? fmtKpi("value", v, currency) : <span className="fainter">0</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Cohortes par mois d'entrée : ce que rapportent les prospects venus de la publicité face à la dépense du mois. */
function Cohorts({ data, currency }: { data: CampaignsScreen; currency: string }) {
  return (
    <section className="card">
      <div className="card-h">
        <h2>Cohortes</h2>
        <span className="faint" style={{ fontSize: 12 }}>Personnes entrées chaque mois de la période ; la valeur ne compte que celles dont la fenêtre est écoulée</span>
      </div>
      <div className="rp-scroll">
        <table className="tbl rp-tbl" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Mois d&apos;entrée</th>
              <th className="r">Prospects</th>
              <th className="r" title="Prospects venus de la publicité (premier clic payant)">dont publicité</th>
              <th className="r">Dépense</th>
              <th className="r" title="Dépense du mois divisée par les prospects venus de la publicité">Coût / prospect</th>
              {HORIZONS.map((h) => (
                <th key={h} className="r" title={`Valeur moyenne d'un prospect publicité dans les ${h} jours suivant son premier clic`}>
                  Valeur {h} j
                </th>
              ))}
              <th className="r" title="Ventes à ce jour des prospects publicité, divisées par la dépense du mois">ROAS à date</th>
            </tr>
          </thead>
          <tbody>
            {data.cohorts.map((c) => (
              <tr key={c.month}>
                <td>{new Date(c.month + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                <td className="r">{fmtConv(c.people)}</td>
                <td className="r">{fmtConv(c.paid)}</td>
                <td className="r">{fmtKpi("spend", c.spend, currency)}</td>
                <td className="r">{c.paid ? fmtKpi("cpa", c.spend / c.paid, currency) : dash}</td>
                {HORIZONS.map((h) => (
                  <td key={h} className="r">{c.value[h] === null ? dash : fmtKpi("value", c.value[h]!, currency)}</td>
                ))}
                <td className="r strong">{c.paid ? fmtKpi("roas", ratio(c.revenue, c.spend), currency) : dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
