"use client";

import "@/styles/calendar.css";

import { useMemo, useState, type ReactNode } from "react";
import { Building2, FolderKanban, Plus, Search, UserRound, X } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { Avatar } from "@/components/ui/avatar";
import { ObjIcon, PageHeader } from "@/components/ui/misc";
import { Popover } from "@/components/ui/overlay";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { CalendarView } from "./calendar-view";
import { TimelineView } from "./timeline-view";

interface Opt {
  id: string;
  label: string;
  icon?: ReactNode;
}

function FilterMenu({ icon, label, options, value, onChange }: { icon: ReactNode; label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const sel = options.filter((o) => value.includes(o.id));
  return (
    <Popover
      width={250}
      trigger={(open) => (
        <button type="button" className={`fbtn${value.length ? " on" : ""}`} onClick={open} aria-haspopup="dialog">
          {icon}
          {value.length === 1 ? sel[0]?.label ?? label : label}
          {value.length > 1 && <span className="n">{value.length}</span>}
        </button>
      )}
    >
      {() => (
        <div>
          <input autoFocus className="pop-search" placeholder={`${label}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.map((o) => {
            const on = value.includes(o.id);
            return (
              <button key={o.id} type="button" className="mi" onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}>
                <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
                {o.icon}
                <span className="trunc">{o.label}</span>
              </button>
            );
          })}
          {!shown.length && <div className="mi faint">Aucun résultat</div>}
          {value.length > 0 && (
            <>
              <div className="mi-sep" />
              <button type="button" className="mi" onClick={() => onChange([])}>
                Tout afficher
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Page Calendrier ou Timeline de l'espace : en-tête, filtres (projet, responsable, client) et vue. */
export function PlanningPage({ tasks, view }: { tasks: Task[]; view: "calendar" | "timeline" }) {
  const ws = useWorkspace();
  const ui = useUI();
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);

  const opts = useMemo(() => {
    const pids = new Set(tasks.map((t) => t.project_id));
    const ps = ws.projects.filter((p) => pids.has(p.id));
    const cids = new Set(ps.map((p) => p.company_id).filter(Boolean) as string[]);
    const hasNone = tasks.some((t) => !t.assignee_id);
    return {
      projects: ps.map((p) => ({ id: p.id, label: p.name, icon: <ObjIcon icon={p.icon} color={p.color} size={16} /> })),
      people: [
        ...ws.members.filter((m) => m.role !== "guest" || tasks.some((t) => t.assignee_id === m.user_id)).map((m) => ({
          id: m.user_id,
          label: m.profile.full_name + (m.user_id === ws.me.id ? " (moi)" : ""),
          icon: <Avatar profile={m.profile} size={16} title={false} />,
        })),
        ...(hasNone ? [{ id: "none", label: "Non assigné", icon: <Avatar profile={null} size={16} /> }] : []),
      ],
      clients: ws.companies
        .filter((c) => cids.has(c.id))
        .map((c) => ({
          id: c.id,
          label: c.name,
          icon: <span className="av" style={{ ["--s" as string]: "16px", ["--c" as string]: c.color, borderRadius: 4 }}>{c.name[0]}</span>,
        })),
    };
  }, [tasks, ws]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (projects.length && !projects.includes(t.project_id)) return false;
      if (people.length && !people.includes(t.assignee_id ?? "none")) return false;
      if (clients.length) {
        const c = ws.project(t.project_id)?.company_id;
        if (!c || !clients.includes(c)) return false;
      }
      if (needle) {
        const p = ws.project(t.project_id);
        if (!t.title.toLowerCase().includes(needle) && !`${p?.key}-${t.number}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, projects, people, clients, q, ws]);

  const active = projects.length + people.length + clients.length + (q ? 1 : 0);
  const onlyProject = projects.length === 1 ? projects[0] : undefined;

  return (
    <div className="plan-page">
      <div className="plan-head">
        <PageHeader
          title={view === "calendar" ? "Calendrier" : "Timeline"}
          sub={view === "calendar" ? "Les échéances et les jalons de tous les projets en cours." : "Le planning, les dépendances et les jalons de tous les projets en cours."}
        >
          {ws.canWrite && (
            <button className="btn btn-primary" onClick={() => ui.create({ kind: "task", defaults: { project_id: onlyProject } })}>
              <Plus size={14} />
              Nouvelle tâche
            </button>
          )}
        </PageHeader>
      </div>
      <div className="plan-filters" role="search">
        <label className="plan-search">
          <Search size={13} />
          <input placeholder="Rechercher une tâche" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une tâche" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Effacer la recherche" className="faint" style={{ display: "inline-flex" }}>
              <X size={13} />
            </button>
          )}
        </label>
        <FilterMenu icon={<FolderKanban size={13} />} label="Projet" options={opts.projects} value={projects} onChange={setProjects} />
        <FilterMenu icon={<UserRound size={13} />} label="Responsable" options={opts.people} value={people} onChange={setPeople} />
        {opts.clients.length > 0 && <FilterMenu icon={<Building2 size={13} />} label="Client" options={opts.clients} value={clients} onChange={setClients} />}
        {active > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setProjects([]);
              setPeople([]);
              setClients([]);
              setQ("");
            }}
          >
            Réinitialiser
          </button>
        )}
        <span className="count-l num">
          {shown.length} tâche{shown.length > 1 ? "s" : ""}
          {active > 0 && ` sur ${tasks.length}`}
        </span>
      </div>
      {view === "calendar" ? <CalendarView tasks={shown} projectId={onlyProject} /> : <TimelineView tasks={shown} projectId={onlyProject} />}
    </div>
  );
}
