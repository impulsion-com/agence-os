"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { EmptyState } from "@/components/ui/misc";
import { groupTasks, matchFilters, sortTasks } from "@/lib/tasks";
import type { GroupKey, Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { useGroupMeta } from "./bits";
import { BulkBar } from "./bulk-bar";
import { CalendarView } from "./calendar-view";
import { TaskKit, useLocalTasks } from "./kit";
import { TaskBoard } from "./task-board";
import { TaskList, type ListGroup } from "./task-list";
import { TaskTable } from "./task-table";
import { TimelineView } from "./timeline-view";
import { countFilters, useViewState, type ViewDefaults } from "./view-state";
import { ViewToolbar } from "./view-toolbar";

import "@/styles/tasks.css";

export type Layout = "board" | "list" | "table" | "calendar" | "timeline";

const PROJECT_GROUPS: GroupKey[] = ["status", "priority", "assignee", "label", "none"];
const WS_GROUPS: GroupKey[] = ["project", "status", "priority", "assignee", "label", "none"];

/**
 * Vue de tâches complète : barre d'outils (état dans l'URL), disposition
 * (tableau, liste, table, calendrier, timeline), sélection et actions groupées.
 */
export function TaskViews({
  tasks: initial,
  layout,
  projectId,
  defaults,
  toolbarLeft,
  toolbarRight,
}: {
  tasks: Task[];
  layout: Layout;
  projectId?: string;
  defaults?: ViewDefaults;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const [tasks, setTasks] = useLocalTasks(initial);
  return (
    <TaskKit tasks={tasks} setTasks={setTasks} projectId={projectId}>
      <ViewsBody tasks={tasks} layout={layout} projectId={projectId} defaults={defaults} toolbarLeft={toolbarLeft} toolbarRight={toolbarRight} />
      <BulkBar />
    </TaskKit>
  );
}

function ViewsBody({ tasks, layout, projectId, defaults = {}, toolbarLeft, toolbarRight }: { tasks: Task[]; layout: Layout; projectId?: string; defaults?: ViewDefaults; toolbarLeft?: ReactNode; toolbarRight?: ReactNode }) {
  const ws = useWorkspace();
  const ui = useUI();
  const meta = useGroupMeta();
  const [view, setView] = useViewState(defaults);
  const showProject = !projectId && !(layout === "list" && view.group === "project");
  const shown = tasks.filter((t) => matchFilters(t, view.filters));
  const filtered = countFilters(view.filters) > 0 || !!view.filters.q;

  let body: ReactNode;
  if (!tasks.length) {
    body = (
      <EmptyState icon="list-checks" title="Aucune tâche pour l'instant" text="Découpe le travail en tâches : briefs créa, mises en ligne, rapports… Appuie sur C pour en créer une depuis n'importe où.">
        {ws.canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => ui.create({ kind: "task", defaults: { project_id: projectId } })}>
            <Plus size={14} />
            Nouvelle tâche
          </button>
        )}
      </EmptyState>
    );
  } else if (!shown.length && layout !== "board" && layout !== "calendar" && layout !== "timeline") {
    body = (
      <EmptyState icon="filter" title="Aucune tâche ne correspond" text="Essaie d'élargir la recherche ou de retirer un filtre.">
        <button type="button" className="btn" onClick={() => setView({ filters: {} })}>
          Effacer les filtres
        </button>
      </EmptyState>
    );
  } else if (layout === "board") {
    body = <TaskBoard tasks={shown} sort={view.sort} defaults={{ project_id: projectId }} showProject={showProject} />;
  } else if (layout === "table") {
    body = <TaskTable tasks={shown} sort={view.sort} showProject={showProject} />;
  } else if (layout === "calendar") {
    body = <CalendarView tasks={shown} />;
  } else if (layout === "timeline") {
    body = <TimelineView tasks={shown} group="status" />;
  } else {
    const sorted = sortTasks(shown, view.sort);
    const groups: ListGroup[] = groupTasks(sorted, view.group)
      .filter((g) => g.tasks.length || (view.group === "status" && !filtered))
      .map((g) => {
        const m = meta(view.group, g.key);
        return { key: g.key, label: m.label, icon: m.icon, tasks: g.tasks, defaults: { ...m.defaults, project_id: m.defaults.project_id ?? projectId }, collapsed: view.group === "status" && g.key === "done" && g.tasks.length > 8 };
      });
    body = <TaskList groups={groups} showProject={showProject} hideHeaders={view.group === "none"} />;
  }

  const hasGroups = layout === "list";
  const hasSort = layout === "list" || layout === "board" || layout === "table";
  return (
    <div className={`tv tv-${layout}`}>
      <ViewToolbar
        view={view}
        setView={setView}
        cats={projectId ? ["status", "priority", "assignee", "label", "due"] : ["project", "status", "priority", "assignee", "label", "due"]}
        groups={hasGroups ? (projectId ? PROJECT_GROUPS : WS_GROUPS) : false}
        sort={hasSort}
        count={shown.length}
        left={toolbarLeft}
      >
        {toolbarRight}
      </ViewToolbar>
      <div className="tv-body">{body}</div>
    </div>
  );
}
