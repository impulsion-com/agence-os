"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, CircleAlert, Info, Lightbulb, ThumbsUp } from "lucide-react";

import { CompanyMark } from "@/components/reporting/common";
import { EmptyState } from "@/components/ui/misc";
import { Menu } from "@/components/ui/overlay";
import { useWorkspace } from "@/lib/workspace/context";
import { money } from "@/lib/format";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import { AWARENESS } from "@/lib/creatives/constants";
import {
  CK_HELP,
  CK_HIB,
  CK_LABEL,
  CZERO,
  adKey,
  ck,
  cmerge,
  fmtCk,
  fmtPct,
  groupBy,
  suggestions,
  vsRef,
  type CKpi,
  type CTotals,
  type Dim,
  type Group,
} from "@/lib/creatives/metrics";
import type { LibraryData, Model } from "./model";
import { Cover, FatigueBadge, MiniLine } from "./parts";

const RANK_METRICS: CKpi[] = ["roas", "cpa", "ctr", "hook", "hold"];

export function Analysis({ data, model, period, company, min }: { data: LibraryData; model: Model; period: Period; company: string | null; min: number }) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const currency = ws.workspace.currency || "EUR";
  const [metric, setMetric] = useState<CKpi>("roas");
  const [minDraft, setMinDraft] = useState(String(min));
  const [personaDim, setPersonaDim] = useState<"awareness" | "persona">("awareness");

  const go = (params: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`${path}?${q}`, { scroll: false });
  };

  // Client de l'analyse : celui choisi, sinon celui qui dépense le plus
  const companyAds = useMemo(() => {
    const m = new Map<string, string>(); // annonce → client
    for (const r of data.rows) m.set(adKey(r.platform, r.ad_id), r.company_id ?? "");
    return m;
  }, [data.rows]);
  const spendByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, t] of model.byAd) {
      const c = companyAds.get(k) ?? "";
      m.set(c, (m.get(c) ?? 0) + t.spend);
    }
    return m;
  }, [model.byAd, companyAds]);
  const withData = ws.companies.filter((c) => (spendByCompany.get(c.id) ?? 0) > 0).sort((a, b) => (spendByCompany.get(b.id) ?? 0) - (spendByCompany.get(a.id) ?? 0));
  const scope = company === "all" ? "all" : (withData.find((c) => c.id === company)?.id ?? withData[0]?.id ?? "all");
  const inScope = (k: string) => scope === "all" || companyAds.get(k) === scope;
  const co = scope === "all" ? null : ws.company(scope);

  const a = useMemo(() => {
    const byAd = new Map([...model.byAd].filter(([k]) => inScope(k)));
    const baseline = [...byAd.values()].reduce(cmerge, CZERO);
    const concepts = data.concepts.filter((c) => scope === "all" || c.company_id === scope);
    const conceptTotals = new Map([...model.byConcept].filter(([id]) => concepts.some((c) => c.id === id)));
    const groups = {
      angle: groupBy("angle", byAd, model.idx, model.concepts),
      format: groupBy("format", byAd, model.idx, model.concepts),
      hook: groupBy("hook", byAd, model.idx, model.concepts),
      awareness: groupBy("awareness", byAd, model.idx, model.concepts),
      persona: groupBy("persona", byAd, model.idx, model.concepts),
    };
    const ads = [...byAd].map(([k, t]) => {
      const link = model.idx.byAd.get(k);
      const cat = model.idx.catalog.get(k);
      const row = model.rowsByAd.get(k)?.[0];
      return {
        key: k,
        adId: k.split("|")[1],
        name: cat?.name || row?.ad_name || k.split("|")[1],
        campaign: cat?.campaign_name ?? "",
        thumb: cat?.thumbnail_url ?? null,
        conceptId: link?.concept_id ?? null,
        t,
        fatigue: model.adFatigue.get(k)!,
      };
    });
    return { byAd, baseline, concepts, conceptTotals, groups, ads };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, data.concepts, scope, companyAds]);

  const tips = useMemo(
    () =>
      suggestions({
        concepts: a.concepts,
        conceptTotals: a.conceptTotals,
        baseline: a.baseline,
        groups: { angle: a.groups.angle, format: a.groups.format },
        ads: a.ads,
        minSpend: min,
        currency,
        base: ws.base,
      }),
    [a, min, currency, ws.base],
  );

  if (!withData.length)
    return (
      <div className="card">
        <EmptyState
          icon="chart-column"
          title="Pas encore de données par annonce"
          text="Connecte Meta ou Google Ads dans Réglages > Connexions publicitaires : la synchro rapatrie la performance de chaque annonce. Lie ensuite tes annonces aux concepts pour les analyser par angle, format et hook."
        />
      </div>
    );

  const above = a.ads.filter((x) => x.t.spend >= min);
  const hib = CK_HIB[metric];
  const ranked = [...above].sort((x, y) => {
    const vx = ck(x.t, metric);
    const vy = ck(y.t, metric);
    if (vx === null) return 1;
    if (vy === null) return -1;
    return hib === false ? vx - vy : vy - vx;
  });
  const fatigued = a.ads.filter((x) => x.fatigue && x.fatigue.level !== "ok" && x.t.spend > 0).sort((x, y) => (y.fatigue.ctrDrop ?? 0) - (x.fatigue.ctrDrop ?? 0));
  const ref = (k: CKpi) => ck(a.baseline, k);
  const applyMin = () => {
    const v = Math.max(0, Math.round(Number(minDraft.replace(",", ".")) || 0));
    setMinDraft(String(v));
    go({ min: v === 50 ? null : String(v) });
  };

  return (
    <>
      <div className="crv-an-controls">
        <Menu
          search={withData.length > 7 ? "Client…" : undefined}
          items={[
            ...withData.map((c) => ({ label: c.name, checked: scope === c.id, sub: fmtKpi("spend", spendByCompany.get(c.id) ?? 0, currency), onSelect: () => go({ company: c.id }) })),
            { separator: true, label: "" },
            { label: "Tous les clients", checked: scope === "all", onSelect: () => go({ company: "all" }) },
          ]}
          trigger={(open, isOpen) => (
            <button type="button" className="btn" onClick={open} aria-expanded={isOpen}>
              {co ? <CompanyMark name={co.name} color={co.color} size={18} /> : null}
              {co?.name ?? "Tous les clients"}
              <ChevronDown size={13} className="faint" />
            </button>
          )}
        />
        <label className="crv-min" title="Les créas qui ont moins dépensé sont exclues du classement et des verdicts, pour éviter les faux gagnants">
          Seuil de dépense
          <input
            className="input"
            inputMode="numeric"
            value={minDraft}
            onChange={(e) => setMinDraft(e.target.value)}
            onBlur={applyMin}
            onKeyDown={(e) => e.key === "Enter" && applyMin()}
            aria-label="Seuil de dépense minimum"
          />
          <span className="faint">{currency === "EUR" ? "€" : currency}</span>
        </label>
        <span className="lbl">Classer par</span>
        <div className="seg" role="group" aria-label="Indicateur de classement">
          {RANK_METRICS.map((k) => (
            <button key={k} type="button" className={metric === k ? "on" : ""} onClick={() => setMetric(k)} title={CK_HELP[k]}>
              {CK_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="stats crv-stats" style={{ marginBottom: 16 }}>
        {(["spend", "roas", "cpa", "ctr", "hook", "hold"] as CKpi[]).map((k) => (
          <div className="stat" key={k}>
            <div className="k" title={CK_HELP[k]}>
              {CK_LABEL[k]} <Info size={12} className="fainter" aria-hidden />
            </div>
            <div className="v">{fmtCk(k, ck(a.baseline, k), currency)}</div>
            <div className="d">{k === "spend" ? `${a.ads.filter((x) => x.t.spend > 0).length} annonces diffusées` : "moyenne du compte"}</div>
          </div>
        ))}
      </div>

      <section className="card" aria-labelledby="crv-sugg-h">
        <div className="card-h">
          <h2 id="crv-sugg-h" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lightbulb size={16} className="faint" /> Ce que disent les chiffres
          </h2>
          <span className="faint" style={{ fontSize: 12 }}>{period.label}, seuil {money(min, currency)}</span>
        </div>
        {tips.length ? (
          <ul className="crv-sugg">
            {tips.map((s, i) => {
              const I = s.tone === "good" ? ThumbsUp : s.tone === "bad" ? CircleAlert : Info;
              return (
                <li key={i} className={s.tone}>
                  <I size={15} aria-hidden />
                  <span>{s.text}</span>
                  {s.href && <Link href={s.href}>Ouvrir</Link>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="crv-note">Rien de saillant sur cette période : pas assez de dépense au-dessus du seuil, ou des créas homogènes. Lie davantage d&apos;annonces à des concepts pour comparer les angles.</p>
        )}
      </section>

      <section className="card crv-sec" aria-labelledby="crv-rank-h">
        <div className="card-h">
          <h2 id="crv-rank-h">Classement des annonces</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            {above.length} au-dessus du seuil{a.ads.length > above.length ? `, ${a.ads.length - above.length} masquée${a.ads.length - above.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl crv-tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th className="crv-rank">#</th>
                <th>Annonce</th>
                <th>Concept</th>
                <th className="r">Dépense</th>
                <th className="r">ROAS</th>
                <th className="r" title="Chiffre d'affaires attribué par ton tracking / dépense">ROAS réel</th>
                <th className="r">CPA</th>
                <th className="r">CTR</th>
                <th className="r">Hook rate</th>
                <th className="r">Hold rate</th>
                <th>Fatigue</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 20).map((x, i) => {
                const c = x.conceptId ? model.concepts.get(x.conceptId) : null;
                const att = data.attribution[x.adId];
                return (
                  <tr key={x.key}>
                    <td className="crv-rank">{i + 1}</td>
                    <td>
                      <span className="name">
                        {x.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={x.thumb} alt="" width={34} height={34} style={{ borderRadius: 6, objectFit: "cover" }} />
                        ) : c ? (
                          <Cover title={c.title} hook={c.hook} format={c.format} color={ws.company(c.company_id)?.color} size="sm" />
                        ) : null}
                        <span style={{ minWidth: 0 }}>
                          <span className="t trunc" style={{ display: "block" }}>{x.name}</span>
                          <span className="s trunc" style={{ display: "block" }}>{x.campaign}</span>
                        </span>
                      </span>
                    </td>
                    <td className="trunc" style={{ maxWidth: 200 }}>
                      {c ? <Link href={`${ws.base}/creatives/${c.id}`} className="muted">{c.title}</Link> : <span className="fainter">Non liée</span>}
                    </td>
                    <td className="r">{fmtCk("spend", x.t.spend, currency)}</td>
                    <Cell k="roas" t={x.t} refV={ref("roas")} currency={currency} strong={metric === "roas"} />
                    <td className="r real">{att && x.t.spend ? <>{fmtCk("roas", att.revenue / x.t.spend)}<small>{att.sales} v.</small></> : <span className="fainter">–</span>}</td>
                    <Cell k="cpa" t={x.t} refV={ref("cpa")} currency={currency} strong={metric === "cpa"} />
                    <Cell k="ctr" t={x.t} refV={ref("ctr")} currency={currency} strong={metric === "ctr"} />
                    <Cell k="hook" t={x.t} refV={ref("hook")} currency={currency} strong={metric === "hook"} />
                    <Cell k="hold" t={x.t} refV={ref("hold")} currency={currency} strong={metric === "hold"} />
                    <td><FatigueBadge f={x.fatigue} showOk /></td>
                  </tr>
                );
              })}
              {!ranked.length && (
                <tr>
                  <td colSpan={11} className="faint" style={{ textAlign: "center", height: 60 }}>Aucune annonce au-dessus du seuil de dépense.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="crv-an-grid">
        <DimCard title="Par angle" dim="angle" groups={a.groups.angle} baseline={a.baseline} min={min} currency={currency} />
        <DimCard title="Par format" dim="format" groups={a.groups.format} baseline={a.baseline} min={min} currency={currency} />
        <DimCard title="Par hook" dim="hook" groups={a.groups.hook} baseline={a.baseline} min={min} currency={currency} />
        <DimCard
          title="Par persona"
          dim={personaDim}
          groups={personaDim === "awareness" ? a.groups.awareness : a.groups.persona}
          baseline={a.baseline}
          min={min}
          currency={currency}
          extra={
            <div className="seg" role="group" aria-label="Regrouper par">
              <button type="button" className={personaDim === "awareness" ? "on" : ""} onClick={() => setPersonaDim("awareness")}>Conscience</button>
              <button type="button" className={personaDim === "persona" ? "on" : ""} onClick={() => setPersonaDim("persona")}>Persona</button>
            </div>
          }
          foot={
            personaDim === "awareness" ? (
              <p className="crv-note">
                Couverture :{" "}
                {AWARENESS.map((x) => `${x.short} ${a.concepts.filter((c) => c.awareness === x.id).length}`).join(" · ")} concept(s).
              </p>
            ) : null
          }
        />
      </div>

      <section className="card crv-sec" aria-labelledby="crv-fat-h">
        <div className="card-h">
          <h2 id="crv-fat-h">Fatigue créative</h2>
          <span className="faint" style={{ fontSize: 12 }}>CTR et ROAS sur 7 jours glissants comparés à leur pic (60 derniers jours), fréquence 7 j</span>
        </div>
        {fatigued.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl crv-tbl" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Annonce</th>
                  <th>État</th>
                  <th>CTR 7 j glissants</th>
                  <th className="r">CTR vs pic</th>
                  <th className="r">ROAS vs pic</th>
                  <th className="r">Fréquence 7 j</th>
                  <th className="r">Dépense</th>
                </tr>
              </thead>
              <tbody>
                {fatigued.map((x) => (
                  <tr key={x.key}>
                    <td>
                      {x.conceptId ? (
                        <Link href={`${ws.base}/creatives/${x.conceptId}`} className="t">{x.name}</Link>
                      ) : (
                        <span className="t">{x.name}</span>
                      )}
                    </td>
                    <td><FatigueBadge f={x.fatigue} /></td>
                    <td><MiniLine values={x.fatigue.ctrSeries} width={120} label={`Évolution du CTR de ${x.name}`} /></td>
                    <td className="r">{x.fatigue.ctrDrop !== null ? `−${Math.round(x.fatigue.ctrDrop)} %` : "–"}</td>
                    <td className="r">{x.fatigue.roasDrop !== null ? `−${Math.round(x.fatigue.roasDrop)} %` : "–"}</td>
                    <td className="r">{x.fatigue.frequency !== null ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(x.fatigue.frequency) : "–"}</td>
                    <td className="r">{fmtCk("spend", x.t.spend, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="crv-note">Aucune annonce ne montre de signe de fatigue sur la période.</p>
        )}
      </section>
    </>
  );
}

function Cell({ k, t, refV, currency, strong }: { k: CKpi; t: CTotals; refV: number | null; currency: string; strong?: boolean }) {
  const v = ck(t, k);
  const d = vsRef(v, refV);
  const hib = CK_HIB[k];
  const tone = d === null || hib === null || Math.abs(d) < 10 ? "" : (d > 0) === hib ? "var(--green)" : "var(--red)";
  return (
    <td className="r" style={{ color: tone || undefined, fontWeight: strong ? 600 : undefined }}>
      {fmtCk(k, v, currency)}
    </td>
  );
}

function DimCard({
  title,
  dim,
  groups,
  baseline,
  min,
  currency,
  extra,
  foot,
}: {
  title: string;
  dim: Dim;
  groups: Group[];
  baseline: CTotals;
  min: number;
  currency: string;
  extra?: React.ReactNode;
  foot?: React.ReactNode;
}) {
  const max = Math.max(1, ...groups.map((g) => g.t.spend));
  const refRoas = ck(baseline, "roas");
  const refCpa = ck(baseline, "cpa");
  const shown = groups.slice(0, 8);
  return (
    <section className="card" aria-label={title}>
      <div className="card-h">
        <h3>{title}</h3>
        {extra}
      </div>
      {shown.length ? (
        <table className="crv-dim">
          <thead>
            <tr>
              <th>{dim === "hook" ? "Hook" : dim === "format" ? "Format" : dim === "angle" ? "Angle" : dim === "awareness" ? "Niveau de conscience" : "Persona"}</th>
              <th className="r">Dépense</th>
              <th className="r">ROAS</th>
              <th className="r">CPA</th>
              <th className="r">Hook</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => {
              const low = g.t.spend < min;
              const d = refRoas !== null ? vsRef(ck(g.t, "roas"), refRoas) : vsRef(ck(g.t, "cpa"), refCpa);
              const good = refRoas !== null ? (d ?? 0) >= 10 : (d ?? 0) <= -10;
              const bad = refRoas !== null ? (d ?? 0) <= -10 : (d ?? 0) >= 10;
              return (
                <tr key={g.key || "_"} style={low ? { opacity: 0.55 } : undefined} title={low ? "Sous le seuil de dépense : à ne pas interpréter" : undefined}>
                  <td className="k">
                    <span className="lab" title={g.label}>{dim === "hook" && g.key ? `« ${g.label} »` : g.label}</span>
                    <small>
                      {g.concepts.size} concept{g.concepts.size > 1 ? "s" : ""}, {g.ads.size} annonce{g.ads.size > 1 ? "s" : ""}
                    </small>
                    <span className="bar" aria-hidden>
                      <i style={{ ["--p" as string]: g.t.spend / max }} />
                    </span>
                  </td>
                  <td className="r">{fmtCk("spend", g.t.spend, currency)}</td>
                  <td className="r">
                    {fmtCk("roas", ck(g.t, "roas"))}
                    {refRoas !== null && d !== null && !low && <span className={`crv-idx ${good ? "good" : bad ? "bad" : "neutral"}`}>{fmtPct(d)}</span>}
                  </td>
                  <td className="r">
                    {fmtCk("cpa", ck(g.t, "cpa"), currency)}
                    {refRoas === null && d !== null && !low && <span className={`crv-idx ${good ? "good" : bad ? "bad" : "neutral"}`}>{fmtPct(d)}</span>}
                  </td>
                  <td className="r">{fmtCk("hook", ck(g.t, "hook"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="crv-note">Aucune annonce liée à un concept sur la période.</p>
      )}
      {groups.length > shown.length && <p className="crv-note">+ {groups.length - shown.length} autres</p>}
      {foot}
    </section>
  );
}
