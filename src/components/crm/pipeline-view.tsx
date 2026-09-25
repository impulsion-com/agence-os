"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { BellRing, Ellipsis, Kanban, List, Plus, Search, X } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { DueText } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { Popover, MenuList } from "@/components/ui/overlay";
import { colorOf, DEAL_SOURCES } from "@/lib/constants";
import { diffDays, fmtDate, money, num, parseDay, pct, today } from "@/lib/format";
import { between } from "@/lib/tasks";
import { useWorkspace } from "@/lib/workspace/context";
import type { Deal, PipelineStage } from "@/lib/types";
import { useDealStageFlow } from "./deal-flow";
import { FollowUps, type FollowUp } from "./followups";
import { dealAmount, pipelineStats, stageOf, useSynced } from "./lib";
import { CompanyLink, SortTh, StageBadge } from "./shared";

type View = "board" | "list";

// Préférence locale « panneau À relancer ouvert », mémorisée dans le navigateur
const followPref = (() => {
  const subs = new Set<() => void>();
  let mem = false;
  return {
    get: () => {
      try {
        return localStorage.getItem("crm.follow") === "1";
      } catch {
        return mem;
      }
    },
    set: (v: boolean) => {
      mem = v;
      try {
        localStorage.setItem("crm.follow", v ? "1" : "0");
      } catch {}
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
})();
type Closing = "" | "overdue" | "month" | "30" | "quarter" | "none";
const CLOSINGS: { id: Closing; name: string }[] = [
  { id: "overdue", name: "En retard" },
  { id: "month", name: "Ce mois-ci" },
  { id: "30", name: "30 prochains jours" },
  { id: "quarter", name: "Ce trimestre" },
  { id: "none", name: "Sans date" },
];

interface Filters {
  q: string;
  owner: string[];
  source: string[];
  services: string[];
  closing: Closing;
}

function matchClosing(d: Deal, c: Closing) {
  if (!c) return true;
  const day = parseDay(d.expected_close);
  if (c === "none") return !day;
  if (!day) return false;
  const t = today();
  const n = diffDays(day, t);
  if (c === "overdue") return n < 0 && !d.closed_at;
  if (c === "30") return n >= 0 && n <= 30;
  if (c === "month") return day.getMonth() === t.getMonth() && day.getFullYear() === t.getFullYear();
  const q = Math.floor(t.getMonth() / 3);
  return Math.floor(day.getMonth() / 3) === q && day.getFullYear() === t.getFullYear();
}

export function PipelineView({
  stages,
  deals: initial,
  followUps,
  serviceNames,
  initialView,
}: {
  stages: PipelineStage[];
  deals: Deal[];
  followUps: FollowUp[];
  serviceNames: string[];
  initialView: View;
}) {
  const ws = useWorkspace();
  const ui = useUI();
  const cur = ws.workspace.currency;
  const [deals, setDeals] = useSynced(initial);
  const [view, setViewState] = useState<View>(initialView);
  const [f, setF] = useState<Filters>({ q: "", owner: [], source: [], services: [], closing: "" });
  const showFollow = useSyncExternalStore(followPref.subscribe, followPref.get, () => false);
  const setShowFollow = followPref.set;
  const overdueFollow = followUps.filter((x) => x.due_at && new Date(x.due_at) < new Date()).length;

  const setView = (v: View) => {
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === "list") url.searchParams.set("view", "list");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };

  const apply = useCallback((id: string, patch: Partial<Deal>) => setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d))), [setDeals]);
  const flow = useDealStageFlow(stages, apply);

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return deals.filter((d) => {
      if (q) {
        const co = ws.company(d.company_id)?.name ?? "";
        if (!d.title.toLowerCase().includes(q) && !co.toLowerCase().includes(q)) return false;
      }
      if (f.owner.length && !f.owner.includes(d.owner_id ?? "none")) return false;
      if (f.source.length && !f.source.includes(d.source || "none")) return false;
      if (f.services.length && !d.services.some((s) => f.services.includes(s))) return false;
      return matchClosing(d, f.closing);
    });
  }, [deals, f, ws]);

  const stats = pipelineStats(shown, stages);
  const active = f.owner.length + f.source.length + f.services.length + (f.closing ? 1 : 0);
  const sources = Array.from(new Set([...DEAL_SOURCES, ...deals.map((d) => d.source).filter(Boolean)]));
  const services = Array.from(new Set([...serviceNames, ...deals.flatMap((d) => d.services)]));

  return (
    <div className="crm-wrap">
      <div className="crm-top">
        <div className="ph">
          <div>
            <h1>Pipeline commercial</h1>
            <p>Suis tes opportunités de l&apos;appel découverte à la signature.</p>
          </div>
          <div className="actions">
            {ws.canWrite && (
              <button className="btn btn-primary" onClick={() => ui.create({ kind: "deal" })}>
                <Plus size={14} /> Nouveau deal <kbd className="crm-kbd">D</kbd>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="crm-pad">
        <div className="stats crm-stats">
          <Stat k="Pipeline ouvert" v={money(stats.open, cur)} d={`${stats.openCount} deal${stats.openCount > 1 ? "s" : ""} en cours`} />
          <Stat k="Pipeline pondéré" v={money(stats.weighted, cur)} d="Valeur × probabilité de l'étape" />
          <Stat k="MRR signé" v={money(stats.mrr, cur)} d={`${stats.wonCount} deal${stats.wonCount > 1 ? "s" : ""} gagné${stats.wonCount > 1 ? "s" : ""}`} />
          <Stat k="Taux de conversion" v={stats.conversion === null ? "-" : pct(stats.conversion, 0)} d={stats.closedCount ? `Sur ${stats.closedCount} deal${stats.closedCount > 1 ? "s" : ""} clos` : "Aucun deal clos"} />
          <Stat k="Cycle de vente moyen" v={stats.cycle === null ? "-" : `${num(stats.cycle)} j`} d="De la création à la signature" />
        </div>
      </div>

      <div className="toolbar crm-toolbar">
        <label className="crm-search">
          <Search size={14} className="faint" />
          <input placeholder="Rechercher un deal ou une entreprise" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Rechercher" />
          {f.q && (
            <button onClick={() => setF({ ...f, q: "" })} aria-label="Effacer la recherche">
              <X size={13} />
            </button>
          )}
        </label>
        <MultiFilter
          label="Responsable"
          value={f.owner}
          onChange={(owner) => setF({ ...f, owner })}
          options={[
            { id: "none", label: "Non assigné", icon: <Avatar profile={null} size={16} /> },
            ...ws.members.filter((m) => m.role !== "guest").map((m) => ({ id: m.user_id, label: m.profile.full_name, icon: <Avatar profile={m.profile} size={16} title={false} /> })),
          ]}
        />
        <MultiFilter label="Source" value={f.source} onChange={(source) => setF({ ...f, source })} options={[...sources.map((s) => ({ id: s, label: s })), { id: "none", label: "Sans source" }]} />
        <MultiFilter label="Services" value={f.services} onChange={(s) => setF({ ...f, services: s })} options={services.map((s) => ({ id: s, label: s }))} />
        <Popover
          trigger={(open) => (
            <button className={`btn btn-sm${f.closing ? " crm-on" : " btn-ghost"}`} onClick={open}>
              Closing{f.closing && ` : ${CLOSINGS.find((c) => c.id === f.closing)?.name.toLowerCase()}`}
            </button>
          )}
        >
          {(close) => (
            <MenuList
              onClose={close}
              items={[{ label: "Toutes les dates", checked: !f.closing, onSelect: () => setF({ ...f, closing: "" }) }, ...CLOSINGS.map((c) => ({ label: c.name, checked: f.closing === c.id, onSelect: () => setF({ ...f, closing: c.id }) }))]}
            />
          )}
        </Popover>
        {active > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setF({ q: f.q, owner: [], source: [], services: [], closing: "" })}>
            <X size={13} /> Effacer les filtres
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className={`btn btn-sm${showFollow ? " crm-on" : " btn-ghost"}`} aria-pressed={showFollow} onClick={() => setShowFollow(!showFollow)}>
          <BellRing size={14} /> À relancer
          {followUps.length > 0 && <span className={`count${overdueFollow ? " crm-count-warn" : ""}`}>{followUps.length}</span>}
        </button>
        <div className="seg" role="radiogroup" aria-label="Affichage">
          <button role="radio" aria-checked={view === "board"} className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
            <Kanban size={13} /> Kanban
          </button>
          <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
            <List size={13} /> Liste
          </button>
        </div>
      </div>

      <div className={`crm-body${showFollow ? " with-follow" : ""}`}>
        <div className="crm-main">
          {!stages.length ? (
            <EmptyState icon="kanban" title="Aucune étape de pipeline" text="Configure les étapes de ton pipeline pour commencer à suivre tes deals.">
              <Link className="btn" href={`${ws.base}/settings/pipeline`}>Configurer le pipeline</Link>
            </EmptyState>
          ) : !deals.length ? (
            <EmptyState icon="handshake" title="Ton pipeline est vide" text="Ajoute ton premier deal : un prospect rencontré, un appel découverte à venir, une recommandation.">
              {ws.canWrite && (
                <button className="btn btn-primary" onClick={() => ui.create({ kind: "deal" })}>
                  <Plus size={14} /> Nouveau deal
                </button>
              )}
            </EmptyState>
          ) : view === "board" ? (
            <Board stages={stages} deals={shown} move={flow.move} />
          ) : (
            <DealTable stages={stages} deals={shown} />
          )}
        </div>
        {showFollow && <FollowUps items={followUps} onClose={() => setShowFollow(false)} />}
      </div>
      {flow.element}
    </div>
  );
}

function Stat({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="d">{d}</div>
    </div>
  );
}

function MultiFilter({ label, value, onChange, options }: { label: string; value: string[]; onChange: (v: string[]) => void; options: { id: string; label: string; icon?: ReactNode }[] }) {
  return (
    <Popover
      trigger={(open) => (
        <button className={`btn btn-sm${value.length ? " crm-on" : " btn-ghost"}`} onClick={open} aria-haspopup="dialog">
          {label}
          {value.length > 0 && <span className="count accent">{value.length}</span>}
        </button>
      )}
    >
      {() => (
        <div>
          <input className="sr" aria-hidden readOnly autoFocus />
          {options.map((o) => {
            const on = value.includes(o.id);
            return (
              <button key={o.id} type="button" className="mi" onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}>
                <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
                {o.icon}
                <span className="trunc">{o.label}</span>
              </button>
            );
          })}
          {!options.length && <div className="mi faint">Aucune option</div>}
        </div>
      )}
    </Popover>
  );
}

const byPos = (a: Deal, b: Deal) => a.position - b.position || a.created_at.localeCompare(b.created_at);

function Board({ stages, deals, move }: { stages: PipelineStage[]; deals: Deal[]; move: (d: Deal, stageId: string, position?: number) => void }) {
  const ws = useWorkspace();
  const ui = useUI();
  const cur = ws.workspace.currency;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: string; index: number } | null>(null);

  const cols = stages.map((s) => ({ stage: s, deals: deals.filter((d) => d.stage_id === s.id).sort(byPos) }));
  const orphans = deals.filter((d) => !stageOf(stages, d.stage_id));
  if (orphans.length && cols[0]) cols[0].deals.push(...orphans);

  const indexAt = (colEl: HTMLElement, y: number) => {
    const cards = [...colEl.querySelectorAll<HTMLElement>("[data-deal]")].filter((c) => c.dataset.deal !== drag);
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  };

  const drop = (stageId: string, index: number) => {
    const d = deals.find((x) => x.id === drag);
    setDrag(null);
    setOver(null);
    if (!d) return;
    const list = deals.filter((x) => x.stage_id === stageId && x.id !== d.id).sort(byPos);
    const pos = between(list[index - 1]?.position, list[index]?.position);
    move(d, stageId, pos);
  };

  return (
    <div className="crm-board" role="list" aria-label="Colonnes du pipeline">
      {cols.map(({ stage, deals: ds }) => {
        const total = ds.reduce((a, d) => a + Number(d.value), 0);
        const isOver = over?.stage === stage.id;
        return (
          <section
            key={stage.id}
            className={`col crm-col${isOver ? " drop" : ""}${stage.kind !== "open" ? " closed" : ""}`}
            role="listitem"
            aria-label={stage.name}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const index = indexAt(e.currentTarget, e.clientY);
              if (over?.stage !== stage.id || over.index !== index) setOver({ stage: stage.id, index });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.stage === stage.id ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(stage.id, indexAt(e.currentTarget, e.clientY));
            }}
          >
            <header className="col-h crm-col-h">
              <i className="crm-dot" style={{ ["--c" as string]: colorOf(stage.color) }} />
              <span className="trunc">{stage.name}</span>
              <span className="count">{ds.length}</span>
              {ws.canWrite && stage.kind === "open" && (
                <button
                  className="btn btn-ghost btn-sm btn-icon crm-col-add"
                  aria-label={`Nouveau deal dans ${stage.name}`}
                  onClick={() => ui.create({ kind: "deal", defaults: { stage_id: stage.id } })}
                >
                  <Plus size={14} />
                </button>
              )}
            </header>
            <div className="crm-col-sum">
              <span className="num">{money(total, cur)}</span>
              {stage.kind === "open" && <span className="fainter num">{stage.probability} %</span>}
            </div>
            <div className="col-b">
              {ds.map((d, i) => (
                <div key={d.id} style={{ display: "contents" }}>
                  {isOver && over.index === i && drag && <div className="crm-drop-line" />}
                  <DealCard deal={d} stage={stage} stages={stages} dragging={drag === d.id} onDragStart={() => setDrag(d.id)} onDragEnd={() => { setDrag(null); setOver(null); }} move={move} />
                </div>
              ))}
              {isOver && over.index >= ds.filter((x) => x.id !== drag).length && drag && <div className="crm-drop-line" />}
              {!ds.length && !isOver && <div className="crm-col-empty">{stage.kind === "won" ? "Glisse ici un deal signé" : stage.kind === "lost" ? "Aucun deal perdu" : "Aucun deal"}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DealCard({
  deal,
  stage,
  stages,
  dragging,
  onDragStart,
  onDragEnd,
  move,
}: {
  deal: Deal;
  stage: PipelineStage;
  stages: PipelineStage[];
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  move: (d: Deal, stageId: string) => void;
}) {
  const ws = useWorkspace();
  const owner = ws.member(deal.owner_id);
  const closed = stage.kind !== "open";
  return (
    <article
      className={`kcard crm-card${dragging ? " dragging" : ""}${stage.kind === "lost" ? " lost" : ""}`}
      data-deal={deal.id}
      draggable={ws.canWrite}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", deal.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="crm-card-top">
        <Link href={`${ws.base}/crm/deals/${deal.id}`} className="t crm-card-link" draggable={false}>
          {deal.title}
        </Link>
        {ws.canWrite && (
          <Popover
            align="end"
            trigger={(open) => (
              <button className="btn btn-ghost btn-sm btn-icon crm-card-menu" aria-label={`Déplacer ${deal.title}`} onClick={open}>
                <Ellipsis size={14} />
              </button>
            )}
          >
            {(close) => (
              <MenuList
                onClose={close}
                items={[
                  { label: "Déplacer vers", heading: true },
                  ...stages.map((s) => ({
                    label: s.name,
                    icon: <i className="crm-dot" style={{ ["--c" as string]: colorOf(s.color) }} />,
                    checked: s.id === deal.stage_id,
                    onSelect: () => move(deal, s.id),
                  })),
                ]}
              />
            )}
          </Popover>
        )}
      </div>
      {deal.company_id && (
        <div className="crm-card-co">
          <CompanyLink id={deal.company_id} />
        </div>
      )}
      <div className="crm-card-val num">{dealAmount(deal, ws.workspace.currency)}</div>
      {deal.services.length > 0 && (
        <div className="crm-chips">
          {deal.services.slice(0, 3).map((s) => (
            <span key={s} className="chip">{s}</span>
          ))}
          {deal.services.length > 3 && <span className="chip">+{deal.services.length - 3}</span>}
        </div>
      )}
      <div className="meta">
        {closed ? (
          <span className="num">{stage.kind === "won" ? "Signé" : "Perdu"} le {fmtDate(deal.closed_at ? deal.closed_at.slice(0, 10) : null) || "-"}</span>
        ) : deal.expected_close ? (
          <DueText date={deal.expected_close} />
        ) : (
          <span className="fainter">Pas de closing prévu</span>
        )}
        <span style={{ marginLeft: "auto" }}>
          <Avatar profile={owner?.profile} size={20} />
        </span>
      </div>
    </article>
  );
}

type SortCol = "title" | "company" | "stage" | "value" | "prob" | "owner" | "close" | "source";

function DealTable({ stages, deals }: { stages: PipelineStage[]; deals: Deal[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: "stage", dir: 1 });
  const stageIdx = (d: Deal) => stages.findIndex((s) => s.id === d.stage_id);
  const key = (d: Deal): string | number => {
    switch (sort.col) {
      case "title": return d.title.toLowerCase();
      case "company": return (ws.company(d.company_id)?.name ?? "~").toLowerCase();
      case "stage": return stageIdx(d) * 1e9 + d.position;
      case "value": return Number(d.value);
      case "prob": return stageOf(stages, d.stage_id)?.probability ?? 0;
      case "owner": return ws.member(d.owner_id)?.profile.full_name ?? "~";
      case "close": return d.expected_close ?? "9999";
      case "source": return d.source || "~";
    }
  };
  const rows = [...deals].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const total = deals.reduce((a, d) => a + Number(d.value), 0);
  return (
    <div className="crm-table-wrap card">
      <table className="tbl crm-tbl">
        <thead>
          <tr>
            <SortTh sort={sort} onSort={setSort} col="title">Deal</SortTh>
            <SortTh sort={sort} onSort={setSort} col="company" cls="crm-hide-sm">Entreprise</SortTh>
            <SortTh sort={sort} onSort={setSort} col="stage">Étape</SortTh>
            <SortTh sort={sort} onSort={setSort} col="value" r>Valeur</SortTh>
            <SortTh sort={sort} onSort={setSort} col="prob" r cls="crm-hide-md">Probabilité</SortTh>
            <SortTh sort={sort} onSort={setSort} col="owner" cls="crm-hide-md">Responsable</SortTh>
            <SortTh sort={sort} onSort={setSort} col="close" cls="crm-hide-sm">Closing</SortTh>
            <SortTh sort={sort} onSort={setSort} col="source" cls="crm-hide-md">Source</SortTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const s = stageOf(stages, d.stage_id);
            const owner = ws.member(d.owner_id);
            const href = `${ws.base}/crm/deals/${d.id}`;
            return (
              <tr key={d.id} className="crm-tr" onClick={() => router.push(href)}>
                <td className="crm-td-title">
                  <Link href={href} onClick={(e) => e.stopPropagation()} className="trunc">{d.title}</Link>
                </td>
                <td className="crm-hide-sm" onClick={(e) => e.stopPropagation()}>
                  {d.company_id ? <CompanyLink id={d.company_id} /> : <span className="fainter">-</span>}
                </td>
                <td><StageBadge stage={s} /></td>
                <td className="r num nowrap">{dealAmount(d, ws.workspace.currency)}</td>
                <td className="r num crm-hide-md">{s ? `${s.probability} %` : "-"}</td>
                <td className="crm-hide-md">
                  <span className="crm-owner">
                    <Avatar profile={owner?.profile} size={18} title={false} />
                    <span className="trunc">{owner?.profile.full_name ?? "Non assigné"}</span>
                  </span>
                </td>
                <td className="crm-hide-sm">{s?.kind === "open" ? (d.expected_close ? <DueText date={d.expected_close} /> : <span className="fainter">-</span>) : <span className="faint num">{fmtDate(d.closed_at?.slice(0, 10))}</span>}</td>
                <td className="crm-hide-md">{d.source || <span className="fainter">-</span>}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={8} className="faint" style={{ textAlign: "center", height: 80 }}>
                Aucun deal ne correspond à ces filtres.
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td className="faint">{rows.length} deal{rows.length > 1 ? "s" : ""}</td>
              <td className="crm-hide-sm" />
              <td />
              <td className="r num"><b>{money(total, ws.workspace.currency)}</b></td>
              <td colSpan={4} className="crm-hide-md" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

