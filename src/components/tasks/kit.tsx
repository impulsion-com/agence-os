"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ConfirmModal } from "@/components/ui/overlay";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { useTaskActions, type LocalUpdate, type TaskActions } from "./actions";
import { getNavIds } from "./nav";
import { TaskContextMenu } from "./task-menu";

/** État local optimiste d'une liste de tâches, réaligné quand le serveur renvoie de nouvelles données. */
export function useLocalTasks(initial: Task[]) {
  const [tasks, setTasks] = useState(initial);
  const [src, setSrc] = useState(initial);
  if (src !== initial) {
    setSrc(initial);
    setTasks(initial);
  }
  return [tasks, setTasks as LocalUpdate] as const;
}

interface Kit {
  tasks: Task[];
  actions: TaskActions;
  selected: Set<string>;
  select: (id: string, e?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  setSelected: (s: Set<string>) => void;
  clearSelection: () => void;
  menu: (e: React.MouseEvent, t: Task) => void;
  confirmDelete: (list: Task[]) => void;
  /** Projet par défaut pour l'ajout rapide (page projet) */
  projectId?: string;
  canWrite: boolean;
}

const Ctx = createContext<Kit | null>(null);

export function useKit() {
  const k = useContext(Ctx);
  if (!k) throw new Error("useKit hors de TaskKit");
  return k;
}

/** Fournit aux vues (tableau, liste, table) les actions, la sélection et le menu contextuel. */
export function TaskKit({ tasks, setTasks, projectId, children }: { tasks: Task[]; setTasks: LocalUpdate; projectId?: string; children: ReactNode }) {
  const ws = useWorkspace();
  const actions = useTaskActions(setTasks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ at: { x: number; y: number } | DOMRect; list: Task[] } | null>(null);
  const [del, setDel] = useState<Task[] | null>(null);

  // Retire de la sélection les tâches qui ont disparu (archivées, supprimées, filtrées côté serveur)
  const ids = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const live = useMemo(() => new Set([...selected].filter((id) => ids.has(id))), [selected, ids]);

  const select = useCallback(
    (id: string, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) => {
      setSelected((cur) => {
        const next = new Set(cur);
        if (e.shiftKey && anchor) {
          const order = getNavIds();
          const a = order.indexOf(anchor);
          const b = order.indexOf(id);
          if (a >= 0 && b >= 0) {
            for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(id);
    },
    [anchor],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  useEffect(() => {
    if (!live.size) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".pop, .modal, .drawer")) clearSelection();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [live.size, clearSelection]);

  const menu = useCallback(
    (e: React.MouseEvent, t: Task) => {
      if (!ws.canWrite) return;
      e.preventDefault();
      e.stopPropagation();
      const list = live.has(t.id) && live.size > 1 ? tasks.filter((x) => live.has(x.id)) : [t];
      const at = e.type === "contextmenu" ? { x: e.clientX, y: e.clientY } : (e.currentTarget as HTMLElement).getBoundingClientRect();
      setCtx({ at, list });
    },
    [ws.canWrite, live, tasks],
  );

  const value = useMemo<Kit>(
    () => ({ tasks, actions, selected: live, select, setSelected, clearSelection, menu, confirmDelete: setDel, projectId, canWrite: ws.canWrite }),
    [tasks, actions, live, select, clearSelection, menu, projectId, ws.canWrite],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {ctx && <TaskContextMenu at={ctx.at} tasks={ctx.list} actions={actions} onClose={() => setCtx(null)} onDelete={(l) => setDel(l)} />}
      {del && (
        <ConfirmModal
          title={del.length > 1 ? `Supprimer ${del.length} tâches ?` : "Supprimer la tâche ?"}
          text={
            del.length > 1
              ? "Les tâches, leurs sous-tâches, commentaires et pièces jointes seront définitivement supprimés. Pour les garder de côté, archive-les plutôt."
              : `« ${del[0].title} » sera définitivement supprimée, avec ses sous-tâches et commentaires. Pour la garder de côté, archive-la plutôt.`
          }
          onConfirm={async () => {
            await actions.remove(del);
            clearSelection();
          }}
          onClose={() => setDel(null)}
        />
      )}
    </Ctx.Provider>
  );
}
