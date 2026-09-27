"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChartNoAxesCombined, Kanban, LayoutGrid, Plus, Search, SearchX, Table2, X } from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/creatives.css";
import { CompanyMark, Crumbs } from "@/components/reporting/common";
import { PeriodPicker } from "@/components/reporting/period-picker";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Menu, type MenuItem } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import { AWARE, AWARENESS, CREATIVE_PLATFORMS, FORMAT, FORMATS, STATUS, STATUSES, type ConceptStatus } from "@/lib/creatives/constants";
import { attributed, ck, fmtCk, type CKpi } from "@/lib/creatives/metrics";
import type { Concept } from "@/lib/creatives/types";
import { Analysis } from "./analysis";
import { ConceptCreateModal } from "./concept-create";
import { useModel, type LibraryData, type Model } from "./model";
import { Cover, FatigueBadge, FormatIcon, KpiPills, StatusBadge, useSignedUrls } from "./parts";

export type View = "gallery" | "table" | "board" | "analysis";

const VIEWS: { id: View; name: string; icon: ReactNode }[] = [
  { id: "gallery", name: "Galerie", icon: <LayoutGrid size={14} /> },
  { id: "table", name: "Tableau", icon: <Table2 size={14} /> },
  { id: "board", name: "Production", icon: <Kanban size={14} /> },
  { id: "analysis", name: "Analyse", icon: <ChartNoAxesCombined size={14} /> },
];

interface Filters {
  q: string;
  company: string[];
  angle: string[];
  format: string[];
  awareness: string[];
  persona: string[];
  status: string[];
  platform: string[];
}
const NO_FILTERS: Filters = { q: "", company: [], angle: [], format: [], awareness: [], persona: [], status: [], platform: [] };

export function CreativeLibrary({ data, period, view, analysis }: { data: LibraryData; period: Period; view: View; analysis: { company: string | null; min: number } }) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const currency = ws.workspace.currency || "EUR";
  const model = useModel(data, period);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [creating, setCreating] = useState(false);
  // Statuts modifiés localement (glisser-déposer, menu) avant le rafraîchissement serveur
  const [local, setLocal] = useState<Record<string, ConceptStatus>>({});

  const concepts = useMemo(() => data.concepts.map((c) => (local[c.id] ? { ...c, status: local[c.id] } : c)), [data.concepts, local]);

  const setView = (v: View) => {
    const q = new URLSearchParams(sp.toString());
    if (v === "gallery") q.delete("view");
    else q.set("view", v);
    router.replace(`${path}?${q}`, { scroll: false });
  };

  const uniq = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const angles = uniq(concepts.map((c) => c.angle));
  const personas = uniq(concepts.map((c) => c.persona));
  const companies = ws.companies.filter((c) => concepts.some((x) => x.company_id === c.id));

  const shown = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    const has = (list: string[], v: string | null | undefined) => !list.length || list.includes(v ?? "");
    return concepts.filter(
      (c) =>
        has(f.company, c.company_id) &&
        has(f.angle, c.angle.trim()) &&
        has(f.format, c.format) &&
        has(f.awareness, c.awareness) &&
        has(f.persona, c.persona.trim()) &&
        has(f.status, c.status) &&
        (!f.platform.length || c.platforms.some((p) => f.platform.includes(p))) &&
        (!needle || [c.title, c.hook, c.angle, c.persona, ...c.tags].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [concepts, f]);

  const mutate = useMutate();
  const setStatus = async (c: Concept, status: ConceptStatus, position?: number) => {
    setLocal((l) => ({ ...l, [c.id]: status }));
    await mutate(
      async (sb) => must(await sb.from("creative_concepts").update({ status, ...(position !== undefined ? { position } : {}) }).eq("id", c.id).select("id")),
      { success: `${c.title} : ${STATUS[status].name}` },
    );
  };

  const filterMenu = (key: keyof Omit<Filters, "q">, label: string, options: { id: string; name: string }[]) => {
    const sel = f[key];
    const toggle = (id: string) => setF((x) => ({ ...x, [key]: sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id] }));
    const items: MenuItem[] = [
      ...options.map((o) => ({ label: o.name, checked: sel.includes(o.id), onSelect: () => toggle(o.id) })),
      ...(sel.length ? [{ separator: true, label: "" }, { label: "Effacer ce filtre", onSelect: () => setF((x) => ({ ...x, [key]: [] })) }] : []),
    ];
    if (!options.length) return null;
    return (
      <Menu
        items={items}
        search={options.length > 7 ? "Filtrer…" : undefined}
        trigger={(open, isOpen) => (
          <button type="button" className={`btn btn-sm${sel.length ? " on" : ""}`} onClick={open} aria-expanded={isOpen}>
            {label}
            {sel.length > 0 && <span className="n">{sel.length}</span>}
          </button>
        )}
      />
    );
  };
  const active = Object.entries(f).some(([k, v]) => (k === "q" ? !!v : (v as string[]).length));

  return (
    <div className="crv-page">
      <Crumbs items={[{ label: "Bibliothèque créa" }]} />
      <PageHeader title="Bibliothèque créa" sub="Concepts, briefs et performance de tes créas, client par client.">
        <PeriodPicker period={period} />
        {ws.canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nouveau concept
          </button>
        )}
      </PageHeader>

      <div className="crv-views">
        <nav className="tabs" aria-label="Vues">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={`tab${view === v.id ? " on" : ""}`} onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined}>
              {v.icon}
              {v.name}
            </button>
          ))}
        </nav>
      </div>

      {view === "analysis" ? (
        <Analysis data={data} model={model} period={period} company={analysis.company} min={analysis.min} />
      ) : (
        <>
          <div className="crv-bar" role="search">
            <label className="crv-search">
              <Search size={14} aria-hidden />
              <span className="sr">Rechercher un concept</span>
              <input value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} placeholder="Titre, hook, angle, étiquette…" />
            </label>
            {filterMenu("company", "Client", companies.map((c) => ({ id: c.id, name: c.name })))}
            {filterMenu("angle", "Angle", angles.map((a) => ({ id: a, name: a })))}
            {filterMenu("format", "Format", FORMATS.map((x) => ({ id: x.id, name: x.name })))}
            {filterMenu("awareness", "Conscience", AWARENESS.map((a) => ({ id: a.id, name: a.name })))}
            {filterMenu("persona", "Persona", personas.map((p) => ({ id: p, name: p })))}
            {view !== "board" && filterMenu("status", "Statut", STATUSES.map((s) => ({ id: s.id, name: s.name })))}
            {filterMenu("platform", "Plateforme", CREATIVE_PLATFORMS.filter((p) => concepts.some((c) => c.platforms.includes(p.id))))}
            {active && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF(NO_FILTERS)}>
                <X size={13} /> Réinitialiser
              </button>
            )}
            <span className="crv-count">
              {shown.length} concept{shown.length > 1 ? "s" : ""}
              {shown.length !== concepts.length ? ` sur ${concepts.length}` : ""}
            </span>
          </div>

          {!concepts.length ? (
            <div className="card">
              <EmptyState icon="palette" title="Aucun concept pour l'instant" text="Un concept regroupe un angle, un hook, un brief, les fichiers et les annonces qui le diffusent. La performance remonte toute seule depuis Meta et Google.">
                {ws.canWrite && (
                  <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                    <Plus size={14} /> Créer un concept
                  </button>
                )}
              </EmptyState>
            </div>
          ) : !shown.length && view !== "board" ? (
            <div className="card">
              <EmptyState icon="search" title="Aucun concept ne correspond" text="Change la recherche ou retire un filtre.">
                <button type="button" className="btn" onClick={() => setF(NO_FILTERS)}>
                  <SearchX size={14} /> Réinitialiser les filtres
                </button>
              </EmptyState>
            </div>
          ) : view === "table" ? (
            <ConceptTable concepts={shown} model={model} data={data} currency={currency} />
          ) : view === "board" ? (
            <Board concepts={shown} model={model} currency={currency} onMove={setStatus} />
          ) : (
            <Gallery concepts={shown} model={model} currency={currency} />
          )}
        </>
      )}

      {creating && <ConceptCreateModal onClose={() => setCreating(false)} angles={angles} defaults={f.company.length === 1 ? { company_id: f.company[0] } : undefined} />}
    </div>
  );
}

function useCovers(concepts: Concept[], model: Model) {
  const urls = useSignedUrls(concepts.map((c) => c.cover_path));
  return (c: Concept) => (c.cover_path ? urls[c.cover_path] : null) ?? model.thumb.get(c.id) ?? null;
}

// ---------------------------------------------------------------------
// Galerie
// ---------------------------------------------------------------------
function Gallery({ concepts, model, currency }: { concepts: Concept[]; model: Model; currency: string }) {
  const ws = useWorkspace();
  const cover = useCovers(concepts, model);
  return (
    <div className="crv-grid">
      {concepts.map((c) => {
        const co = ws.company(c.company_id);
        return (
          <Link key={c.id} href={`${ws.base}/creatives/${c.id}`} className="crv-card">
            <Cover title={c.title} hook={c.hook} format={c.format} color={co?.color} src={cover(c)}>
              <span className="st">
                <StatusBadge status={c.status} />
              </span>
            </Cover>
            <div className="body">
              <div className="t">{c.title}</div>
              <div className="sub">
                {co && <CompanyMark name={co.name} color={co.color} size={16} />}
                <span className="trunc">{[co?.name, c.angle].filter(Boolean).join(" · ") || "Sans client"}</span>
                <FatigueBadge f={model.conceptFatigue.get(c.id)} />
              </div>
              <KpiPills t={model.byConcept.get(c.id)} baseline={model.baseline.get(c.company_id ?? "")} currency={currency} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Tableau
// ---------------------------------------------------------------------
type Col = "title" | "status" | "angle" | "format" | "awareness" | "ads" | "spend" | "roas" | "real" | "cpa" | "ctr" | "hook" | "hold" | "fatigue";

function ConceptTable({ concepts, model, data, currency }: { concepts: Concept[]; model: Model; data: LibraryData; currency: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const cover = useCovers(concepts, model);
  const [sort, setSort] = useState<{ key: Col; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const rank = { ok: 0, watch: 1, fatigued: 2 };
  const val = (c: Concept, k: Col): number | string | null => {
    const t = model.byConcept.get(c.id);
    switch (k) {
      case "title":
        return c.title;
      case "status":
        return STATUSES.findIndex((s) => s.id === c.status);
      case "angle":
        return c.angle || null;
      case "format":
        return FORMAT[c.format].name;
      case "awareness":
        return c.awareness ? AWARENESS.findIndex((a) => a.id === c.awareness) : null;
      case "ads":
        return model.idx.byConcept.get(c.id)?.length ?? 0;
      case "real": {
        const a = attributed(data.attribution, model.idx.byConcept.get(c.id));
        return a && t?.spend ? a.revenue / t.spend : null;
      }
      case "fatigue": {
        const f = model.conceptFatigue.get(c.id);
        return f ? rank[f.level] : null;
      }
      default:
        return t ? ck(t, k as CKpi) : null;
    }
  };
  const sorted = [...concepts].sort((a, b) => {
    const x = val(a, sort.key);
    const y = val(b, sort.key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const d = typeof x === "string" ? x.localeCompare(String(y), "fr") : x - (y as number);
    return sort.dir === "asc" ? d : -d;
  });
  const th = (k: Col, label: string, right = false, help?: string) => (
    <th className={right ? "r" : undefined} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} title={help}>
      <button type="button" onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "title" || k === "angle" ? "asc" : "desc" }))}>
        {label}
        {sort.key === k && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
  return (
    <div className="crv-tbl-wrap">
      <table className="tbl crv-tbl">
        <thead>
          <tr>
            {th("title", "Concept")}
            {th("status", "Statut")}
            {th("angle", "Angle")}
            {th("format", "Format")}
            {th("awareness", "Conscience")}
            {th("ads", "Annonces", true)}
            {th("spend", "Dépense", true)}
            {th("roas", "ROAS", true, "ROAS déclaré par la plateforme")}
            {th("real", "ROAS réel", true, "Chiffre d'affaires attribué par ton tracking / dépense")}
            {th("cpa", "CPA", true)}
            {th("ctr", "CTR", true)}
            {th("hook", "Hook rate", true, "Vues de 3 s / impressions")}
            {th("hold", "Hold rate", true, "ThruPlay / vues de 3 s")}
            {th("fatigue", "Fatigue")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const co = ws.company(c.company_id);
            const t = model.byConcept.get(c.id);
            const a = attributed(data.attribution, model.idx.byConcept.get(c.id));
            const href = `${ws.base}/creatives/${c.id}`;
            return (
              <tr key={c.id} className="link" onClick={() => router.push(href)}>
                <td>
                  <Link href={href} className="name" onClick={(e) => e.stopPropagation()}>
                    <Cover title={c.title} hook={c.hook} format={c.format} color={co?.color} src={cover(c)} size="sm" />
                    <span style={{ minWidth: 0 }}>
                      <span className="t trunc" style={{ display: "block" }}>{c.title}</span>
                      <span className="s trunc" style={{ display: "block" }}>{co?.name ?? "Sans client"}</span>
                    </span>
                  </Link>
                </td>
                <td><StatusBadge status={c.status} /></td>
                <td className="muted trunc" style={{ maxWidth: 170 }}>{c.angle || <span className="fainter">–</span>}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} className="muted">
                    <FormatIcon format={c.format} size={13} /> {FORMAT[c.format].name}
                  </span>
                </td>
                <td className="muted">{c.awareness ? AWARE[c.awareness].short : <span className="fainter">–</span>}</td>
                <td className="r">{model.idx.byConcept.get(c.id)?.length ?? 0}</td>
                <td className="r">{t?.spend ? fmtCk("spend", t.spend, currency) : <span className="fainter">–</span>}</td>
                <td className="r">{fmtCk("roas", t ? ck(t, "roas") : null)}</td>
                <td className="r real" title={a ? `${a.sales} vente${a.sales > 1 ? "s" : ""}, ${fmtKpi("value", a.revenue, currency)}` : undefined}>
                  {a && t?.spend ? (
                    <>
                      {fmtCk("roas", a.revenue / t.spend)}
                      <small>{a.sales} v.</small>
                    </>
                  ) : (
                    <span className="fainter">–</span>
                  )}
                </td>
                <td className="r">{fmtCk("cpa", t ? ck(t, "cpa") : null, currency)}</td>
                <td className="r">{fmtCk("ctr", t ? ck(t, "ctr") : null)}</td>
                <td className="r">{fmtCk("hook", t ? ck(t, "hook") : null)}</td>
                <td className="r">{fmtCk("hold", t ? ck(t, "hold") : null)}</td>
                <td><FatigueBadge f={model.conceptFatigue.get(c.id)} showOk /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Production (kanban par statut)
// ---------------------------------------------------------------------
function Board({ concepts, model, currency, onMove }: { concepts: Concept[]; model: Model; currency: string; onMove: (c: Concept, s: ConceptStatus, position: number) => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<ConceptStatus | null>(null);
  const byStatus = (s: ConceptStatus) => concepts.filter((c) => c.status === s).sort((a, b) => a.position - b.position);
  return (
    <div className="crv-board">
      <div className="board">
        {STATUSES.map((s) => {
          const list = byStatus(s.id);
          return (
            <section
              key={s.id}
              className={`col${over === s.id ? " drop" : ""}`}
              aria-label={s.name}
              onDragOver={(e) => {
                if (!drag || !ws.canWrite) return;
                e.preventDefault();
                setOver(s.id);
              }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const c = concepts.find((x) => x.id === drag);
                setOver(null);
                setDrag(null);
                if (!c || c.status === s.id) return;
                const last = list.at(-1)?.position ?? 0;
                onMove(c, s.id, last + 1000);
              }}
            >
              <div className="col-h">
                <span className="rp-dot" style={{ ["--c" as string]: s.color, borderRadius: "50%" }} />
                {s.name}
                <span className="count">{list.length}</span>
              </div>
              <div className="col-b">
                {!list.length && <div className="empty-col">{s.help}</div>}
                {list.map((c) => {
                  const co = ws.company(c.company_id);
                  const t = model.byConcept.get(c.id);
                  return (
                    <article
                      key={c.id}
                      className={`kcard${drag === c.id ? " dragging" : ""}`}
                      draggable={ws.canWrite}
                      onDragStart={(e) => {
                        setDrag(c.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", c.id);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                      onClick={() => router.push(`${ws.base}/creatives/${c.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") router.push(`${ws.base}/creatives/${c.id}`);
                      }}
                      tabIndex={0}
                      aria-label={c.title}
                    >
                      <div className="top">
                        <Cover title={c.title} hook={c.hook} format={c.format} color={co?.color} src={model.thumb.get(c.id)} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="t">{c.title}</div>
                          <div className="ang trunc">{[co?.name, c.angle].filter(Boolean).join(" · ")}</div>
                        </div>
                      </div>
                      {t?.spend ? <KpiPills t={t} baseline={model.baseline.get(c.company_id ?? "")} keys={["spend", "roas", "hook"]} currency={currency} /> : null}
                      <div className="meta">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <FormatIcon format={c.format} size={12} /> {FORMAT[c.format].name}
                        </span>
                        {c.task_id && <span title="Lié à une tâche">Tâche</span>}
                        <FatigueBadge f={model.conceptFatigue.get(c.id)} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
