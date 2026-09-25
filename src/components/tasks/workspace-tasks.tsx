"use client";

import { useSearchParams } from "next/navigation";
import { Kanban, List, Plus, Table } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { TaskViews, type Layout } from "./task-views";
import { setUrlParams } from "./view-state";

const LAYOUTS: { id: Layout; name: string; icon: React.ReactNode }[] = [
  { id: "list", name: "Liste", icon: <List size={13} /> },
  { id: "board", name: "Tableau", icon: <Kanban size={13} /> },
  { id: "table", name: "Table", icon: <Table size={13} /> },
];

/** Page /tasks : toutes les tâches de l'espace. */
export function WorkspaceTasks({ tasks }: { tasks: Task[] }) {
  const ws = useWorkspace();
  const ui = useUI();
  const sp = useSearchParams();
  const layout = (LAYOUTS.find((l) => l.id === sp.get("layout"))?.id ?? "list") as Layout;
  const open = tasks.filter((t) => t.status !== "done").length;
  const projects = new Set(tasks.map((t) => t.project_id)).size;

  return (
    <div className="tk-page">
      <header className="tk-page-h">
        <div>
          <h1>Tâches</h1>
          <p className="faint">
            {open} ouverte{open > 1 ? "s" : ""} sur {tasks.length} · {projects} projet{projects > 1 ? "s" : ""}
          </p>
        </div>
        <div className="tk-page-acts">
          <div className="seg" role="group" aria-label="Disposition">
            {LAYOUTS.map((l) => (
              <button key={l.id} type="button" className={layout === l.id ? "on" : ""} aria-pressed={layout === l.id} onClick={() => setUrlParams((p) => (l.id === "list" ? p.delete("layout") : p.set("layout", l.id)))}>
                {l.icon}
                <span className="tv-hide-sm">{l.name}</span>
              </button>
            ))}
          </div>
          {ws.canWrite && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => ui.create({ kind: "task" })}>
              <Plus size={14} />
              Nouvelle tâche
            </button>
          )}
        </div>
      </header>
      <TaskViews key={layout} tasks={tasks} layout={layout} defaults={{ group: "project", sort: "manual" }} />
    </div>
  );
}
