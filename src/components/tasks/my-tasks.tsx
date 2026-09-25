"use client";

import { useSearchParams } from "next/navigation";
import { CalendarClock, CalendarDays, CalendarRange, CircleCheck, CircleDashed, Plus, Sun } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { EmptyState } from "@/components/ui/misc";
import { dayBucket, diffDays, iso, parseDay, today } from "@/lib/format";
import { isOverdue, matchFilters, sortTasks } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { BulkBar } from "./bulk-bar";
import { TaskKit, useLocalTasks } from "./kit";
import { TaskList, type ListGroup } from "./task-list";
import { setUrlParams, useViewState } from "./view-state";
import { ViewToolbar } from "./view-toolbar";

import "@/styles/tasks.css";

type Tab = "upcoming" | "overdue" | "done";
const DEFAULTS = { sort: "due" as const, group: "none" as const };

/** Page Mes tâches : à venir (par horizon), en retard, terminées. */
export function MyTasks({ tasks: initial }: { tasks: Task[] }) {
  const [tasks, setTasks] = useLocalTasks(initial);
  return (
    <TaskKit tasks={tasks} setTasks={setTasks}>
      <MyTasksBody tasks={tasks} />
      <BulkBar />
    </TaskKit>
  );
}

function MyTasksBody({ tasks }: { tasks: Task[] }) {
  const ws = useWorkspace();
  const ui = useUI();
  const sp = useSearchParams();
  const tab = (["upcoming", "overdue", "done"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "upcoming") as Tab;
  const [view, setView] = useViewState(DEFAULTS);
  const t0 = today();
  const days = (t: Task) => (t.due_date ? diffDays(parseDay(t.due_date)!, t0) : null);

  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter(isOverdue);
  const upcoming = open.filter((t) => !isOverdue(t));
  const done = tasks.filter((t) => t.status === "done");
  const dueToday = upcoming.filter((t) => days(t) === 0).length;

  const src = tab === "overdue" ? overdue : tab === "done" ? done : upcoming;
  const shown = sortTasks(src.filter((t) => matchFilters(t, view.filters)), view.sort);
  const me = { assignee_id: ws.me.id };

  let groups: ListGroup[];
  if (tab === "upcoming") {
    const d = (t: Task) => days(t);
    groups = [
      { key: "today", label: "Aujourd'hui", icon: <Sun size={14} style={{ color: "var(--amber)" }} />, tasks: shown.filter((t) => d(t) === 0), defaults: { ...me, due_date: iso(t0) } },
      { key: "week", label: "Cette semaine", icon: <CalendarDays size={14} className="faint" />, tasks: shown.filter((t) => d(t) !== null && d(t)! > 0 && d(t)! <= 7), defaults: me },
      { key: "later", label: "Plus tard", icon: <CalendarRange size={14} className="faint" />, tasks: shown.filter((t) => d(t) !== null && d(t)! > 7), defaults: me },
      { key: "none", label: "Sans date", icon: <CircleDashed size={14} className="faint" />, tasks: shown.filter((t) => d(t) === null), defaults: me },
    ].filter((g) => g.tasks.length || g.key === "today");
  } else if (tab === "overdue") {
    groups = [{ key: "overdue", label: "En retard", icon: <CalendarClock size={14} style={{ color: "var(--red)" }} />, tasks: shown, tone: "var(--red)", addable: false }];
  } else {
    const byDone = [...shown].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    const buckets = ["Aujourd'hui", "Hier", "Cette semaine", "Plus ancien"];
    groups = buckets
      .map((b) => ({ key: b, label: b, icon: <CircleCheck size={14} style={{ color: "var(--green)" }} />, tasks: byDone.filter((t) => dayBucket(t.completed_at ?? t.updated_at) === b), addable: false }))
      .filter((g) => g.tasks.length);
  }

  const tabs: { id: Tab; name: string; n: number }[] = [
    { id: "upcoming", name: "À venir", n: upcoming.length },
    { id: "overdue", name: "En retard", n: overdue.length },
    { id: "done", name: "Terminées", n: done.length },
  ];

  const empty =
    tab === "upcoming"
      ? { icon: "circle-check", title: "Rien de prévu pour toi", text: "Toutes tes tâches sont bouclées. Profite-en pour avancer la veille créa ou préparer le prochain reporting." }
      : tab === "overdue"
        ? { icon: "sparkles", title: "Aucun retard", text: "Tout est dans les temps. Bravo !" }
        : { icon: "archive", title: "Aucune tâche terminée", text: "Les tâches que tu termines apparaîtront ici." };
  const filtered = !!view.filters.q || Object.keys(view.filters).length > 0;

  return (
    <div className="tk-page">
      <header className="tk-page-h">
        <div>
          <h1>Mes tâches</h1>
          <p className="faint">
            {dueToday} pour aujourd&apos;hui · <span style={overdue.length ? { color: "var(--red)" } : undefined}>{overdue.length} en retard</span> · {upcoming.length} à venir
          </p>
        </div>
        {ws.canWrite && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => ui.create({ kind: "task", defaults: { assignee_id: ws.me.id } })}>
            <Plus size={14} />
            Nouvelle tâche
          </button>
        )}
      </header>
      <nav className="tabs tk-tabs" aria-label="Filtrer mes tâches">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab${tab === t.id ? " on" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setUrlParams((p) => (t.id === "upcoming" ? p.delete("tab") : p.set("tab", t.id)))}
          >
            {t.name}
            <span className="count" style={t.id === "overdue" && t.n ? { color: "var(--red)" } : undefined}>{t.n}</span>
          </button>
        ))}
      </nav>
      <div className="tv tv-list">
        <ViewToolbar view={view} setView={setView} cats={["project", "status", "priority", "label", "due"]} groups={false} count={shown.length} />
        <div className="tv-body">
          {groups.some((g) => g.tasks.length) || (tab === "upcoming" && !filtered && src.length > 0) ? (
            <TaskList groups={groups} showProject />
          ) : filtered && src.length ? (
            <EmptyState icon="filter" title="Aucune tâche ne correspond" text="Essaie d'élargir la recherche ou de retirer un filtre.">
              <button type="button" className="btn" onClick={() => setView({ filters: {} })}>Effacer les filtres</button>
            </EmptyState>
          ) : (
            <EmptyState icon={empty.icon} title={empty.title} text={empty.text}>
              {tab === "upcoming" && ws.canWrite && (
                <button type="button" className="btn btn-primary" onClick={() => ui.create({ kind: "task", defaults: { assignee_id: ws.me.id } })}>
                  <Plus size={14} />
                  Nouvelle tâche
                </button>
              )}
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
