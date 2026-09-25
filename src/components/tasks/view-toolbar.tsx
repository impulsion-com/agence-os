"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpDown, Calendar, ChevronLeft, ChevronRight, CircleDot, Filter, FolderKanban, Layers, Search, SignalHigh, Tag, UserRound, X } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { ObjIcon } from "@/components/ui/misc";
import { Menu, Popover } from "@/components/ui/overlay";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { GROUPS, PRIORITIES, SORTS, STATUSES, colorOf } from "@/lib/constants";
import type { GroupKey, TaskFilters } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import type { ViewState } from "./view-state";

type Cat = "status" | "priority" | "assignee" | "label" | "project" | "due";

const CATS: { id: Cat; name: string; icon: ReactNode }[] = [
  { id: "status", name: "Statut", icon: <CircleDot size={14} /> },
  { id: "priority", name: "Priorité", icon: <SignalHigh size={14} /> },
  { id: "assignee", name: "Responsable", icon: <UserRound size={14} /> },
  { id: "label", name: "Étiquette", icon: <Tag size={14} /> },
  { id: "project", name: "Projet", icon: <FolderKanban size={14} /> },
  { id: "due", name: "Échéance", icon: <Calendar size={14} /> },
];

const DUE: { id: NonNullable<TaskFilters["due"]>; name: string }[] = [
  { id: "overdue", name: "En retard" },
  { id: "today", name: "Aujourd'hui" },
  { id: "week", name: "7 prochains jours" },
  { id: "none", name: "Sans échéance" },
];

interface Opt {
  id: string;
  name: string;
  icon?: ReactNode;
}

function useOptions(): Record<Cat, Opt[]> {
  const ws = useWorkspace();
  return {
    status: STATUSES.map((s) => ({ id: s.id, name: s.name, icon: <StatusIcon status={s.id} /> })),
    priority: PRIORITIES.map((p) => ({ id: p.id, name: p.name, icon: <PriorityIcon priority={p.id} /> })),
    assignee: [
      { id: "none", name: "Non assigné", icon: <Avatar profile={null} size={16} /> },
      ...ws.members.filter((m) => m.role !== "guest").map((m) => ({ id: m.user_id, name: m.profile.full_name, icon: <Avatar profile={m.profile} size={16} title={false} /> })),
    ],
    label: ws.labels.map((l) => ({ id: l.id, name: l.name, icon: <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(l.color), flexShrink: 0 }} /> })),
    project: ws.projects.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.name, icon: <ObjIcon icon={p.icon} color={p.color} size={16} /> })),
    due: DUE.map((d) => ({ id: d.id, name: d.name })),
  };
}

const valuesOf = (f: TaskFilters, c: Cat): string[] => (c === "due" ? (f.due ? [f.due] : []) : ((f[c] as string[] | undefined) ?? []));

function withValues(f: TaskFilters, c: Cat, v: string[]): TaskFilters {
  const n = { ...f };
  if (c === "due") n.due = (v[v.length - 1] as TaskFilters["due"]) || undefined;
  else (n as Record<string, unknown>)[c] = v.length ? v : undefined;
  return n;
}

/** Liste à cocher d'une catégorie de filtre. */
function CatEditor({ cat, filters, onChange, onBack }: { cat: Cat; filters: TaskFilters; onChange: (f: TaskFilters) => void; onBack?: () => void }) {
  const opts = useOptions()[cat];
  const [q, setQ] = useState("");
  const vals = valuesOf(filters, cat);
  const shown = opts.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(withValues(filters, cat, cat === "due" ? (vals.includes(id) ? [] : [id]) : vals.includes(id) ? vals.filter((x) => x !== id) : [...vals, id]));
  return (
    <div>
      {onBack && (
        <button type="button" className="mi faint" onClick={onBack}>
          <ChevronLeft size={14} />
          {CATS.find((c) => c.id === cat)?.name}
        </button>
      )}
      {opts.length > 6 && <input autoFocus className="pop-search" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />}
      {shown.map((o) => (
        <button key={o.id} type="button" className="mi" onClick={() => toggle(o.id)}>
          <input type={cat === "due" ? "radio" : "checkbox"} className="check" readOnly checked={vals.includes(o.id)} tabIndex={-1} style={cat === "due" ? { borderRadius: "50%" } : undefined} />
          {o.icon}
          <span className="trunc">{o.name}</span>
        </button>
      ))}
      {!shown.length && <div className="mi faint">Aucun résultat</div>}
    </div>
  );
}

function FilterMenu({ filters, onChange, cats }: { filters: TaskFilters; onChange: (f: TaskFilters) => void; cats: Cat[] }) {
  const [cat, setCat] = useState<Cat | null>(null);
  if (cat) return <CatEditor cat={cat} filters={filters} onChange={onChange} onBack={() => setCat(null)} />;
  return (
    <div>
      <div className="mi-h">Filtrer par</div>
      {CATS.filter((c) => cats.includes(c.id)).map((c) => {
        const n = valuesOf(filters, c.id).length;
        return (
          <button key={c.id} type="button" className="mi" onClick={() => setCat(c.id)}>
            {c.icon}
            {c.name}
            <span className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {n > 0 && <span className="count accent">{n}</span>}
              <ChevronRight size={13} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({ cat, filters, onChange }: { cat: Cat; filters: TaskFilters; onChange: (f: TaskFilters) => void }) {
  const opts = useOptions()[cat];
  const vals = valuesOf(filters, cat);
  const meta = CATS.find((c) => c.id === cat)!;
  const names = vals.map((v) => opts.find((o) => o.id === v)?.name ?? "?");
  const text = names.length > 2 ? `${names.length} valeurs` : names.join(", ");
  return (
    <span className="tv-fchip">
      <Popover
        width={240}
        trigger={(open) => (
          <button type="button" onClick={open} className="tv-fchip-b">
            {meta.icon}
            <span className="faint">{meta.name}</span>
            <span className="trunc" style={{ maxWidth: 180 }}>{text}</span>
          </button>
        )}
      >
        {() => <CatEditor cat={cat} filters={filters} onChange={onChange} />}
      </Popover>
      <button type="button" className="tv-fchip-x" aria-label={`Retirer le filtre ${meta.name}`} onClick={() => onChange(withValues(filters, cat, []))}>
        <X size={12} />
      </button>
    </span>
  );
}

export interface ToolbarProps {
  view: ViewState;
  setView: (p: Partial<ViewState>) => void;
  cats?: Cat[];
  groups?: GroupKey[] | false;
  sort?: boolean;
  left?: ReactNode;
  children?: ReactNode;
  count?: number;
}

/** Barre d'outils de vue : recherche, filtres multi-critères, tri, regroupement, puces actives. */
export function ViewToolbar({ view, setView, cats = ["status", "priority", "assignee", "label", "due"], groups = ["status", "priority", "assignee", "label", "none"], sort = true, left, children, count }: ToolbarProps) {
  const [q, setQ] = useState(view.filters.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filters = view.filters;
  const setFilters = (f: TaskFilters) => setView({ filters: f });
  const active = cats.filter((c) => valuesOf(filters, c).length);

  // Synchronise le champ quand l'URL change ailleurs (vue enregistrée, retour arrière)
  const [urlQ, setUrlQ] = useState(view.filters.q ?? "");
  const [written, setWritten] = useState<string | null>(null);
  if ((view.filters.q ?? "") !== urlQ) {
    setUrlQ(view.filters.q ?? "");
    if ((view.filters.q ?? "") !== written) setQ(view.filters.q ?? "");
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const onSearch = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setWritten(v);
      setView({ filters: { ...filters, q: v || undefined } });
    }, 160);
  };

  return (
    <div className="tv-toolbar">
      <div className="tv-tb-row">
        {left}
        <label className="tv-search">
          <Search size={14} />
          <input
            placeholder="Rechercher des tâches"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.stopPropagation();
                onSearch("");
              }
            }}
            aria-label="Rechercher des tâches"
          />
          {q && (
            <button type="button" aria-label="Effacer la recherche" onClick={() => onSearch("")}>
              <X size={12} />
            </button>
          )}
        </label>
        <Popover
          width={250}
          trigger={(open, isOpen) => (
            <button type="button" className={`btn btn-ghost btn-sm${isOpen ? " on" : ""}`} onClick={open}>
              <Filter size={14} />
              <span className="tv-hide-sm">Filtrer</span>
              {active.length > 0 && <span className="count accent">{active.length}</span>}
            </button>
          )}
        >
          {() => <FilterMenu filters={filters} onChange={setFilters} cats={cats} />}
        </Popover>
        {sort && (
          <Menu
            trigger={(open) => (
              <button type="button" className="btn btn-ghost btn-sm" onClick={open}>
                <ArrowUpDown size={14} />
                <span className="tv-hide-sm">Tri :</span>
                <span className="tv-hide-sm" style={{ color: "var(--text)" }}>{SORTS.find((s) => s.id === view.sort)?.name}</span>
              </button>
            )}
            items={[{ label: "Trier par", heading: true }, ...SORTS.map((s) => ({ label: s.name, checked: s.id === view.sort, onSelect: () => setView({ sort: s.id }) }))]}
          />
        )}
        {groups && (
          <Menu
            trigger={(open) => (
              <button type="button" className="btn btn-ghost btn-sm" onClick={open}>
                <Layers size={14} />
                <span className="tv-hide-sm">Groupe :</span>
                <span className="tv-hide-sm" style={{ color: "var(--text)" }}>{GROUPS.find((g) => g.id === view.group)?.name}</span>
              </button>
            )}
            items={[
              { label: "Regrouper par", heading: true },
              ...GROUPS.filter((g) => groups.includes(g.id)).map((g) => ({ label: g.name, checked: g.id === view.group, onSelect: () => setView({ group: g.id }) })),
            ]}
          />
        )}
        {count !== undefined && <span className="faint num tv-hide-sm" style={{ fontSize: "var(--fs-xs)", marginLeft: 4 }}>{count} tâche{count > 1 ? "s" : ""}</span>}
        <span style={{ flex: 1 }} />
        {children}
      </div>
      {active.length > 0 && (
        <div className="tv-tb-row tv-chips">
          {active.map((c) => (
            <FilterChip key={c} cat={c} filters={filters} onChange={setFilters} />
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ q: filters.q })}>
            Tout effacer
          </button>
        </div>
      )}
    </div>
  );
}
