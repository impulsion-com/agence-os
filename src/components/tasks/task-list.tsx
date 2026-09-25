"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";

import type { Task } from "@/lib/types";
import type { NewTask } from "./actions";
import { QuickAdd } from "./bits";
import { useKit } from "./kit";
import { useNavIds } from "./nav";
import { TaskRow } from "./task-row";

export interface ListGroup {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  tasks: Task[];
  defaults?: Partial<NewTask>;
  collapsed?: boolean;
  tone?: string;
  /** Position de fin de groupe pour l'ajout rapide */
  addable?: boolean;
}

/** Liste groupée, groupes repliables, ajout rapide par groupe, sélection multiple. */
export function TaskList({ groups, showProject, hideHeaders }: { groups: ListGroup[]; showProject?: boolean; hideHeaders?: boolean }) {
  const kit = useKit();
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const isCollapsed = (g: ListGroup) => (toggled.has(g.key) ? !g.collapsed : !!g.collapsed);
  useNavIds(groups.flatMap((g) => (isCollapsed(g) ? [] : g.tasks.map((t) => t.id))));

  const flip = (k: string) =>
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="tk-list" role="grid">
      {groups.map((g) => {
        const closed = isCollapsed(g);
        const allSel = g.tasks.length > 0 && g.tasks.every((t) => kit.selected.has(t.id));
        return (
          <section key={g.key} className="tk-group">
            {!hideHeaders && (
              <div className="tk-group-h" style={g.tone ? { ["--tone" as string]: g.tone } : undefined}>
                <button type="button" className="tk-group-toggle" aria-expanded={!closed} onClick={() => flip(g.key)}>
                  <ChevronRight size={14} className={`tk-chev${closed ? "" : " open"}`} />
                  {g.icon}
                  <span className="trunc">{g.label}</span>
                  <span className="count">{g.tasks.length}</span>
                </button>
                {kit.canWrite && g.tasks.length > 0 && (
                  <input
                    type="checkbox"
                    className="check tk-group-check"
                    checked={allSel}
                    aria-label="Sélectionner le groupe"
                    onChange={() => {
                      const n = new Set(kit.selected);
                      for (const t of g.tasks) {
                        if (allSel) n.delete(t.id);
                        else n.add(t.id);
                      }
                      kit.setSelected(n);
                    }}
                  />
                )}
                {kit.canWrite && g.addable !== false && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{ ["--h" as string]: "22px", marginLeft: "auto" }}
                    aria-label="Ajouter une tâche dans ce groupe"
                    onClick={() => {
                      if (closed) flip(g.key);
                      setAdding(g.key + ":" + Date.now());
                    }}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            )}
            {!closed && (
              <div className="tk-group-b">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} t={t} showProject={showProject} />
                ))}
                {kit.canWrite && g.addable !== false && (
                  <QuickAdd
                    key={adding?.startsWith(g.key + ":") ? adding : g.key}
                    className="add-row tk-add-row"
                    defaults={g.defaults ?? {}}
                    position={() => g.tasks.reduce((m, x) => Math.max(m, x.position), 0) + 1000}
                    startOpen={!!adding?.startsWith(g.key + ":")}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
