"use client";

import { useMemo, useState } from "react";
import { Link2, Link2Off, Plus } from "lucide-react";

import { Popover } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { fmtKpi } from "@/lib/ads/metrics";
import { platformLabel } from "@/lib/creatives/constants";
import { adKey, ck, fmtCk, type CTotals, type Fatigue } from "@/lib/creatives/metrics";
import type { AdLink, Attribution, CatalogAd, Variant } from "@/lib/creatives/types";
import { FatigueBadge } from "./parts";

/** Annonces liées au concept : métriques de la période, ventes réelles, variante, fatigue. */
export function ConceptAds({
  conceptId,
  links,
  variants,
  catalog,
  taken,
  byAd,
  fatigue,
  attribution,
  currency,
}: {
  conceptId: string;
  links: AdLink[];
  variants: Variant[];
  catalog: CatalogAd[];
  taken: string[];
  byAd: Map<string, CTotals>;
  fatigue: Map<string, Fatigue>;
  attribution: Attribution;
  currency: string;
}) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const cat = useMemo(() => new Map(catalog.map((a) => [adKey(a.platform, a.ad_id), a])), [catalog]);

  const link = async (platform: string, adId: string) =>
    mutate(
      async (sb) =>
        must(await sb.from("creative_ads").insert({ workspace_id: ws.workspace.id, concept_id: conceptId, platform, ad_id: adId.trim() }).select("id")),
      { success: "Annonce liée" },
    );
  const unlink = (l: AdLink) => mutate(async (sb) => must(await sb.from("creative_ads").delete().eq("id", l.id).select("id")), { success: "Annonce déliée" });
  const setVariant = (l: AdLink, v: string | null) =>
    mutate(async (sb) => must(await sb.from("creative_ads").update({ variant_id: v }).eq("id", l.id).select("id")), { success: "Variante mise à jour" });

  const sorted = [...links].sort((a, b) => (byAd.get(adKey(b.platform, b.ad_id))?.spend ?? 0) - (byAd.get(adKey(a.platform, a.ad_id))?.spend ?? 0));

  return (
    <section className="card crv-sec" aria-labelledby="crv-ads-h">
      <div className="card-h">
        <h2 id="crv-ads-h">
          Annonces liées <span className="sub">{links.length ? `${links.length} annonce${links.length > 1 ? "s" : ""}` : ""}</span>
        </h2>
        {ws.canWrite && <AdPicker catalog={catalog} linked={new Set(links.map((l) => adKey(l.platform, l.ad_id)))} taken={new Set(taken)} onPick={link} />}
      </div>
      {links.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl crv-tbl crv-ads" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Annonce</th>
                <th>Variante</th>
                <th className="r">Dépense</th>
                <th className="r">ROAS</th>
                <th className="r" title="Ventes et chiffre d'affaires attribués par ton tracking (dernier clic publicitaire)">Ventes réelles</th>
                <th className="r">CPA</th>
                <th className="r">CTR</th>
                <th className="r">Hook</th>
                <th className="r">Hold</th>
                <th>Fatigue</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const k = adKey(l.platform, l.ad_id);
                const a = cat.get(k);
                const t = byAd.get(k);
                const att = attribution[l.ad_id];
                return (
                  <tr key={l.id} className={t?.spend ? undefined : "muted-row"}>
                    <td>
                      <span className="nm">
                        {a?.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.thumbnail_url} alt="" loading="lazy" />
                        ) : null}
                        <span style={{ minWidth: 0 }}>
                          <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{a?.name || `Annonce ${l.ad_id}`}</span>
                          <span className="s trunc" style={{ display: "block" }}>
                            {platformLabel(l.platform)} · {a?.campaign_name || "pas encore synchronisée"} · <span className="mono">{l.ad_id}</span>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>
                      {variants.length ? (
                        <select
                          className="select"
                          style={{ height: 26, fontSize: 12, width: 140 }}
                          value={l.variant_id ?? ""}
                          disabled={!ws.canWrite}
                          onChange={(e) => setVariant(l, e.target.value || null)}
                          aria-label="Variante"
                        >
                          <option value="">Aucune</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="fainter">–</span>
                      )}
                    </td>
                    <td className="r">{t?.spend ? fmtCk("spend", t.spend, currency) : "–"}</td>
                    <td className="r">{fmtCk("roas", t ? ck(t, "roas") : null)}</td>
                    <td className="r real">{att ? <>{att.sales} v.<small>{fmtKpi("value", att.revenue, currency)}</small></> : <span className="fainter">–</span>}</td>
                    <td className="r">{fmtCk("cpa", t ? ck(t, "cpa") : null, currency)}</td>
                    <td className="r">{fmtCk("ctr", t ? ck(t, "ctr") : null)}</td>
                    <td className="r">{fmtCk("hook", t ? ck(t, "hook") : null)}</td>
                    <td className="r">{fmtCk("hold", t ? ck(t, "hold") : null)}</td>
                    <td><FatigueBadge f={fatigue.get(k)} showOk={!!t?.spend} /></td>
                    <td className="r">
                      {ws.canWrite && (
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => unlink(l)} title="Délier cette annonce" aria-label="Délier cette annonce">
                          <Link2Off size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="crv-note" style={{ paddingTop: 0 }}>
          Lie les annonces Meta ou Google qui diffusent ce concept : leur performance (dépense, ROAS, hook rate, fatigue) et les ventes attribuées par ton tracking remontent ici.
        </p>
      )}
    </section>
  );
}

function AdPicker({ catalog, linked, taken, onPick }: { catalog: CatalogAd[]; linked: Set<string>; taken: Set<string>; onPick: (platform: string, adId: string) => void }) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
  const [platform, setPlatform] = useState("meta");
  const needle = q.trim().toLowerCase();
  const list = catalog
    .filter((a) => !linked.has(adKey(a.platform, a.ad_id)))
    .filter((a) => !needle || [a.name, a.campaign_name, a.adset_name, a.ad_id].some((s) => s?.toLowerCase().includes(needle)))
    .sort((a, b) => Number(taken.has(adKey(a.platform, a.ad_id))) - Number(taken.has(adKey(b.platform, b.ad_id))) || a.name.localeCompare(b.name, "fr"))
    .slice(0, 60);
  return (
    <Popover
      align="end"
      width={360}
      trigger={(open, isOpen) => (
        <button type="button" className="btn btn-sm" onClick={open} aria-expanded={isOpen}>
          <Link2 size={13} /> Lier une annonce
        </button>
      )}
    >
      {(close) => (
        <div>
          <input autoFocus className="pop-search" placeholder="Nom, campagne ou identifiant…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {list.map((a) => {
              const k = adKey(a.platform, a.ad_id);
              return (
                <button
                  key={k}
                  type="button"
                  className="mi"
                  style={{ alignItems: "flex-start", padding: "6px 8px" }}
                  onClick={() => {
                    onPick(a.platform, a.ad_id);
                    close();
                  }}
                >
                  {a.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnail_url} alt="" width={28} height={28} style={{ borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                  ) : null}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="trunc" style={{ display: "block" }}>{a.name || a.ad_id}</span>
                    <span className="trunc faint" style={{ display: "block", fontSize: 11 }}>
                      {platformLabel(a.platform)} · {a.campaign_name}
                      {taken.has(k) ? " · déjà liée à un autre concept" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {!list.length && <div className="mi faint">{catalog.length ? "Aucune annonce ne correspond" : "Aucune annonce synchronisée pour ce client"}</div>}
          </div>
          <form
            style={{ borderTop: "1px solid var(--divider)", margin: "4px -4px 0", padding: "10px 12px 8px", display: "grid", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^\d{5,25}$/.test(manual.trim())) return;
              onPick(platform, manual.trim());
              close();
            }}
          >
            <span className="label">Ou par identifiant (annonce pas encore synchronisée)</span>
            <div style={{ display: "flex", gap: 6 }}>
              <select className="select" style={{ width: 110, height: 28, fontSize: 12 }} value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Plateforme">
                <option value="meta">Meta</option>
                <option value="google">Google</option>
              </select>
              <input className="input mono" style={{ height: 28, fontSize: 12 }} placeholder="ID de l'annonce" value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" aria-label="Identifiant de l'annonce" />
              <button className="btn btn-sm btn-primary" type="submit" disabled={!/^\d{5,25}$/.test(manual.trim())} aria-label="Lier">
                <Plus size={13} />
              </button>
            </div>
          </form>
        </div>
      )}
    </Popover>
  );
}
