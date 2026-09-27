"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Copy, Ellipsis, FileText, Info, Sparkles, Trash2 } from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/creatives.css";
import { CompanyPicker, ProjectPicker } from "@/components/pickers";
import { DailyChart } from "@/components/reporting/charts";
import { CompanyMark, Crumbs } from "@/components/reporting/common";
import { PeriodPicker } from "@/components/reporting/period-picker";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addDays, fmtDate, iso, today } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { dayList, fmtKpi, kpi, type Kpi, type Period } from "@/lib/ads/metrics";
import { AWARENESS, AWARE, CREATIVE_PLATFORMS, FORMATS, STATUS, STATUSES, type Awareness, type Brief, type ConceptFormat, type ConceptStatus } from "@/lib/creatives/constants";
import {
  CK_HELP,
  CK_LABEL,
  CZERO,
  adKey,
  attributed,
  cadd,
  ck,
  cmerge,
  fatigue,
  fatigueEnd,
  fmtCk,
  fmtPct,
  suggestVerdict,
  totalsByAd,
  vsRef,
  type CKpi,
  type CTotals,
  type Fatigue,
} from "@/lib/creatives/metrics";
import type { AdDay, AdLink, Asset, Attribution, CatalogAd, Concept, Variant } from "@/lib/creatives/types";
import { ConceptAds } from "./concept-ads";
import { BriefSection, CommitField, VariantsSection } from "./concept-brief";
import { ConceptFiles } from "./concept-files";
import { Cover, FatigueBadge, StatusBadge, useSignedUrls } from "./parts";

export interface ConceptData {
  concept: Concept;
  variants: Variant[];
  assets: Asset[];
  links: AdLink[];
  taken: string[];
  catalog: CatalogAd[];
  rows: AdDay[];
  attribution: Attribution;
  task: { id: string; number: number; title: string; project_id: string; status: string } | null;
}

const CHART_METRICS: Kpi[] = ["roas", "cpa", "ctr", "conversions", "cpm"];
const MIN_SPEND = 50;

export function ConceptPage({ data, period }: { data: ConceptData; period: Period }) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const toast = useToast();
  const mutate = useMutate();
  const currency = ws.workspace.currency || "EUR";
  const [c, setC] = useState(data.concept);
  const [prev, setPrev] = useState(data.concept);
  if (data.concept !== prev) {
    setPrev(data.concept);
    setC(data.concept);
  }
  const [metric, setMetric] = useState<Kpi>("roas");
  const [deleting, setDeleting] = useState(false);
  const co = ws.company(c.company_id);

  const save = async (patch: Partial<Concept>, success?: string) => {
    setC((x) => ({ ...x, ...patch }));
    await mutate(async (sb) => must(await sb.from("creative_concepts").update(patch as never).eq("id", c.id).select("id")), { success, refresh: !!success });
  };

  // ----- Performance -----
  const perf = useMemo(() => {
    const keys = new Set(data.links.map((l) => adKey(l.platform, l.ad_id)));
    const byAd = totalsByAd(data.rows, period.start, period.end);
    const byAdPrev = totalsByAd(data.rows, period.prevStart, period.prevEnd);
    let t = CZERO;
    let tp = CZERO;
    for (const k of keys) {
      t = cmerge(t, byAd.get(k) ?? CZERO);
      tp = cmerge(tp, byAdPrev.get(k) ?? CZERO);
    }
    let baseline = CZERO;
    for (const r of data.rows) if (r.date >= period.start && r.date <= period.end) baseline = cadd(baseline, r);
    const end = fatigueEnd(period, iso(addDays(today(), -1)));
    const cat = new Map(data.catalog.map((a) => [adKey(a.platform, a.ad_id), a]));
    const fat = new Map<string, Fatigue>();
    for (const k of keys) fat.set(k, fatigue(data.rows.filter((r) => adKey(r.platform, r.ad_id) === k), end, cat.get(k)?.frequency_7d ?? null));
    const rank = { ok: 0, watch: 1, fatigued: 2 };
    const worst = [...fat.entries()].filter(([k]) => (byAd.get(k)?.spend ?? 0) > 0).map(([, f]) => f).sort((a, b) => rank[b.level] - rank[a.level])[0] ?? null;
    const freq = Math.max(0, ...[...keys].map((k) => cat.get(k)?.frequency_7d ?? 0)) || null;

    // Série quotidienne des annonces liées
    const mine = data.rows.filter((r) => keys.has(adKey(r.platform, r.ad_id)));
    const dayTotals = (a: string, b: string) => {
      const days = dayList(a, b);
      const m = new Map<string, CTotals>(days.map((d) => [d, CZERO]));
      for (const r of mine) if (m.has(r.date)) m.set(r.date, cadd(m.get(r.date)!, r));
      return days.map((d) => m.get(d)!);
    };
    const cur = dayTotals(period.start, period.end);
    const prv = dayTotals(period.prevStart, period.prevEnd);
    return { byAd, t, tp, baseline, fat, worst, freq, cur, prv, days: dayList(period.start, period.end) };
  }, [data, period]);

  const att = attributed(data.attribution, data.links);
  const verdict = suggestVerdict(perf.t.spend ? perf.t : undefined, perf.baseline, perf.worst, MIN_SPEND);
  const toT = (x: CTotals) => ({ spend: x.spend, impressions: x.impressions, clicks: x.clicks, conversions: x.conversions, value: x.value });
  const covers = useSignedUrls([c.cover_path]);
  const thumb = (c.cover_path ? covers[c.cover_path] : null) ?? data.links.map((l) => data.catalog.find((a) => a.ad_id === l.ad_id && a.platform === l.platform)?.thumbnail_url).find(Boolean) ?? null;
  const isCur = (s: ConceptStatus) => c.status === s;

  const duplicate = async () => {
    const sb = supabaseBrowser();
    try {
      const { id: _id, created_at: _ca, updated_at: _ua, is_demo: _d, ...rest } = c;
      void _id;
      void _ca;
      void _ua;
      void _d;
      const row = must(
        await sb
          .from("creative_concepts")
          .insert({ ...rest, title: `${c.title} (copie)`, status: "idea", verdict: "", launched_at: null, cover_path: null, position: Date.now() / 1000 } as never)
          .select("id")
          .single(),
      ) as { id: string };
      if (data.variants.length)
        must(await sb.from("creative_variants").insert(data.variants.map((v) => ({ workspace_id: ws.workspace.id, concept_id: row.id, name: v.name, hook: v.hook, notes: v.notes, position: v.position }))).select("id"));
      toast("Concept dupliqué");
      router.push(`${ws.base}/creatives/${row.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    }
  };
  const remove = async () => {
    const sb = supabaseBrowser();
    if (data.assets.length) await sb.storage.from("attachments").remove(data.assets.map((a) => a.path));
    const ok = await mutate(async (s) => must(await s.from("creative_concepts").delete().eq("id", c.id).select("id")), { success: "Concept supprimé", refresh: false });
    if (ok) router.push(`${ws.base}/creatives`);
  };

  const kpiCell = (k: CKpi, sub?: React.ReactNode) => {
    const v = ck(perf.t, k);
    const d = k === "spend" ? vsRef(v, ck(perf.tp, k)) : vsRef(v, ck(perf.baseline, k));
    return (
      <div className="crv-mkpi" key={k}>
        <div className="k" title={CK_HELP[k]}>
          {CK_LABEL[k]} <Info size={11} className="fainter" aria-hidden />
        </div>
        <div className="v">{fmtCk(k, v, currency)}</div>
        <div className="d">{sub ?? (d === null ? " " : k === "spend" ? `${fmtPct(d)} vs période préc.` : `${fmtPct(d)} vs moyenne client`)}</div>
      </div>
    );
  };

  return (
    <div className="crv-page">
      <Crumbs items={[{ label: "Bibliothèque créa", href: `${ws.base}/creatives` }, { label: c.title }]} />
      <Link href={`${ws.base}/creatives`} className="btn btn-ghost btn-sm" style={{ marginBottom: 12, marginLeft: -8 }}>
        <ArrowLeft size={14} /> Bibliothèque
      </Link>

      <header className="crv-head">
        <Cover title={c.title} hook={c.hook} format={c.format} color={co?.color} src={thumb} />
        <div className="main">
          <label className="sr" htmlFor="crv-title">Titre du concept</label>
          <CommitField id="crv-title" className="crv-title" value={c.title} disabled={!ws.canWrite} onCommit={(title) => title.trim() && save({ title: title.trim() })} />
          <div className="meta">
            <Menu
              items={STATUSES.map((s) => ({ label: s.name, sub: s.help, checked: isCur(s.id), onSelect: () => save({ status: s.id }, `Statut : ${s.name}`) }))}
              trigger={(open) => <StatusBadge status={c.status} onClick={ws.canWrite ? open : undefined} />}
            />
            {co && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <CompanyMark name={co.name} color={co.color} size={18} /> {co.name}
              </span>
            )}
            {c.angle && <span className="faint">Angle : {c.angle}</span>}
            {c.launched_at && <span className="faint">Lancé le {fmtDate(c.launched_at, true)}</span>}
            <FatigueBadge f={perf.worst} />
          </div>
          <div className="actions">
            <PeriodPicker period={period} />
            <Link href={`${ws.base}/creatives/${c.id}/brief`} className="btn">
              <FileText size={14} /> Brief créateur
            </Link>
            {ws.canWrite && (
              <Menu
                align="end"
                items={[
                  { label: "Dupliquer", icon: <Copy size={14} />, onSelect: duplicate },
                  { separator: true, label: "" },
                  { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(true) },
                ]}
                trigger={(open) => (
                  <button type="button" className="btn btn-icon" onClick={open} aria-label="Plus d'actions">
                    <Ellipsis size={15} />
                  </button>
                )}
              />
            )}
          </div>
        </div>
      </header>

      <div className="crv-concept">
        <div style={{ minWidth: 0 }}>
          <section className="card" aria-labelledby="crv-perf-h">
            <div className="card-h">
              <h2 id="crv-perf-h">
                Performance <span className="sub">{period.label}, annonces liées</span>
              </h2>
            </div>
            <div className="crv-mkpis">
              {kpiCell("spend")}
              {kpiCell("roas")}
              <div className="crv-mkpi">
                <div className="k" title="Ventes et chiffre d'affaires attribués par ton tracking first-party (dernier clic publicitaire)">
                  Ventes réelles <Info size={11} className="fainter" aria-hidden />
                </div>
                <div className="v">{att ? `${att.sales} vente${att.sales > 1 ? "s" : ""}` : "–"}</div>
                <div className="d">{att ? `${fmtKpi("value", att.revenue, currency)}${perf.t.spend ? `, ROAS réel ${fmtCk("roas", att.revenue / perf.t.spend)}` : ""}` : "Aucune vente attribuée par le tracking"}</div>
              </div>
              {kpiCell("cpa")}
              {kpiCell("ctr")}
              {kpiCell("hook")}
              {kpiCell("hold")}
              <div className="crv-mkpi">
                <div className="k" title="Nombre moyen d'affichages par personne sur 7 jours (Meta). Au-delà de 3, la créa lasse souvent.">
                  Fréquence 7 j <Info size={11} className="fainter" aria-hidden />
                </div>
                <div className="v">{perf.freq ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(perf.freq) : "–"}</div>
                <div className="d">{perf.worst?.reason || " "}</div>
              </div>
            </div>
            {perf.t.spend > 0 ? (
              <>
                <div className="crv-chart-h">
                  <span className="faint" style={{ fontSize: 12 }}>Par jour</span>
                  <div className="seg" role="group" aria-label="Indicateur du graphique">
                    {CHART_METRICS.map((m) => (
                      <button key={m} type="button" className={metric === m ? "on" : ""} onClick={() => setMetric(m)}>
                        {m === "roas" ? "ROAS" : m === "cpa" ? "CPA" : m === "ctr" ? "CTR" : m === "cpm" ? "CPM" : "Conversions"}
                      </button>
                    ))}
                  </div>
                </div>
                <DailyChart
                  days={perf.days}
                  spend={perf.cur.map((x) => x.spend)}
                  metric={metric}
                  values={perf.cur.map((x) => kpi(toT(x), metric))}
                  prev={perf.days.map((_, i) => (perf.prv[i] ? kpi(toT(perf.prv[i]), metric) : null))}
                  currency={currency}
                />
              </>
            ) : (
              <p className="crv-note">Aucune dépense sur la période pour les annonces liées.</p>
            )}
          </section>

          <ConceptAds
            conceptId={c.id}
            links={data.links}
            variants={data.variants}
            catalog={data.catalog}
            taken={data.taken}
            byAd={perf.byAd}
            fatigue={perf.fat}
            attribution={data.attribution}
            currency={currency}
          />
          <BriefSection conceptId={c.id} brief={c.brief ?? {}} onSave={(brief: Brief) => save({ brief })} />
          <VariantsSection conceptId={c.id} variants={data.variants} links={data.links} assets={data.assets} />
          <ConceptFiles conceptId={c.id} assets={data.assets} variants={data.variants} coverPath={c.cover_path} onCover={(p) => save({ cover_path: p }, p ? "Couverture mise à jour" : undefined)} />
        </div>

        <aside className="crv-side">
          <section className="card" aria-labelledby="crv-verdict-h">
            <div className="card-h">
              <h3 id="crv-verdict-h">Verdict du test</h3>
            </div>
            <div className="crv-verdict">
              <div className="sugg">
                <Sparkles size={14} aria-hidden />
                <span>
                  {verdict.text}
                  {verdict.status && verdict.status !== c.status ? ` Suggestion : ${STATUS[verdict.status].name}.` : ""}
                </span>
              </div>
              {ws.canWrite && (
                <div className="btns">
                  {(["winner", "loser", "fatigued"] as ConceptStatus[]).map((s) => (
                    <button key={s} type="button" className={`btn btn-sm${verdict.status === s && !isCur(s) ? " btn-primary" : ""}`} disabled={isCur(s)} onClick={() => save({ status: s }, `Statut : ${STATUS[s].name}`)}>
                      {STATUS[s].name}
                    </button>
                  ))}
                </div>
              )}
              <CommitField value={c.verdict} rows={3} placeholder="Ce que le test a appris (hook, angle, format), et la suite à donner" disabled={!ws.canWrite} onCommit={(verdict) => save({ verdict })} />
            </div>
          </section>

          <section className="card" aria-labelledby="crv-props-h">
            <div className="card-h">
              <h3 id="crv-props-h">Concept</h3>
            </div>
            <div className="crv-props">
              <div className="field">
                <span className="label">Client</span>
                <CompanyPicker
                  value={c.company_id}
                  onChange={(v) => save({ company_id: v }, "Client mis à jour")}
                  trigger={(open) => (
                    <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={open} disabled={!ws.canWrite}>
                      {co && <CompanyMark name={co.name} color={co.color} size={16} />}
                      <span className="trunc">{co?.name ?? "Choisir un client"}</span>
                    </button>
                  )}
                />
              </div>
              <div className="field">
                <label htmlFor="crv-angle">Angle</label>
                <CommitField id="crv-angle" value={c.angle} disabled={!ws.canWrite} placeholder="Ex. Routine simplifiée" onCommit={(angle) => save({ angle: angle.trim() })} />
              </div>
              <div className="field">
                <label htmlFor="crv-hook">Hook</label>
                <CommitField id="crv-hook" value={c.hook} rows={3} disabled={!ws.canWrite} placeholder="La phrase ou l'image des 3 premières secondes" onCommit={(hook) => save({ hook: hook.trim() })} />
              </div>
              <div className="field">
                <label htmlFor="crv-persona">Persona</label>
                <CommitField id="crv-persona" value={c.persona} disabled={!ws.canWrite} placeholder="Ex. Active 30-45 ans, peu de temps" onCommit={(persona) => save({ persona: persona.trim() })} />
              </div>
              <div className="field">
                <label htmlFor="crv-aw">Niveau de conscience</label>
                <select id="crv-aw" className="select" value={c.awareness ?? ""} disabled={!ws.canWrite} onChange={(e) => save({ awareness: (e.target.value || null) as Awareness | null })}>
                  <option value="">Non renseigné</option>
                  {AWARENESS.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                {c.awareness && <span className="hint">{AWARE[c.awareness].help}</span>}
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="crv-format">Format</label>
                  <select id="crv-format" className="select" value={c.format} disabled={!ws.canWrite} onChange={(e) => save({ format: e.target.value as ConceptFormat })}>
                    {FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="crv-launch">Lancé le</label>
                  <input id="crv-launch" type="date" className="input" value={c.launched_at ?? ""} disabled={!ws.canWrite} onChange={(e) => save({ launched_at: e.target.value || null })} />
                </div>
              </div>
              <div className="field">
                <span className="label">Plateformes</span>
                <div className="crv-plats" role="group" aria-label="Plateformes">
                  {CREATIVE_PLATFORMS.map((p) => {
                    const on = c.platforms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={on ? "on" : ""}
                        aria-pressed={on}
                        disabled={!ws.canWrite}
                        onClick={() => save({ platforms: on ? c.platforms.filter((x) => x !== p.id) : [...c.platforms, p.id] })}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field">
                <span className="label">Étiquettes</span>
                <Tags value={c.tags} disabled={!ws.canWrite} onChange={(tags) => save({ tags })} />
              </div>
              <div className="field">
                <span className="label">Projet</span>
                <ProjectPicker
                  value={c.project_id}
                  onChange={(v) => save({ project_id: v }, "Projet mis à jour")}
                  trigger={(open) => (
                    <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={open} disabled={!ws.canWrite}>
                      <span className="trunc">{ws.project(c.project_id)?.name ?? "Aucun projet"}</span>
                    </button>
                  )}
                />
              </div>
              {data.task && (
                <div className="field">
                  <span className="label">Tâche liée</span>
                  <Link href={`${path}?task=${data.task.id}`} scroll={false} className="btn" style={{ justifyContent: "flex-start" }}>
                    <span className="faint mono">{ws.project(data.task.project_id)?.key}-{data.task.number}</span>
                    <span className="trunc">{data.task.title}</span>
                  </Link>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      {deleting && (
        <ConfirmModal
          title="Supprimer ce concept ?"
          text={`${c.title}, son brief, ses variantes et ses fichiers seront supprimés. Les annonces ne sont pas touchées.`}
          onConfirm={remove}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

function Tags({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().replace(/,$/, "");
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="crv-tags">
      {value.map((t) => (
        <span className="crv-tag" key={t}>
          {t}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Retirer ${t}`}>
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={draft}
          placeholder={value.length ? "" : "Ajouter une étiquette"}
          onChange={(e) => {
            const v = e.target.value;
            if (!v.includes(",")) return setDraft(v);
            const t = v.replace(/,/g, "").trim();
            if (t && !value.includes(t)) onChange([...value, t]);
            setDraft("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add()}
          aria-label="Nouvelle étiquette"
        />
      )}
    </div>
  );
}
