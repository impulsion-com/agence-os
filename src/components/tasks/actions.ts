"use client";

import { useCallback, useMemo } from "react";

import { useToast } from "@/components/ui/toast";
import { addDays, iso, parseDay, today } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TASK_SELECT, normalizeTask } from "@/lib/tasks";
import type { Json, TablesInsert } from "@/lib/database.types";
import type { Priority, Task, TaskStatus } from "@/lib/types";
import { must, useMutate, useWorkspace, type DB } from "@/lib/workspace/context";

export type TaskPatch = Partial<
  Pick<Task, "status" | "priority" | "assignee_id" | "due_date" | "start_date" | "title" | "description" | "milestone" | "recurrence" | "position" | "archived_at">
>;
export type LocalUpdate = (fn: (ts: Task[]) => Task[]) => void;

export interface NewTask {
  project_id: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignee_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  milestone?: boolean;
  recurrence?: Task["recurrence"];
  position?: number;
  label_ids?: string[];
}

const RECUR_DAYS: Record<NonNullable<Task["recurrence"]>, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 0 };

export const RECURRENCES: { id: NonNullable<Task["recurrence"]>; name: string }[] = [
  { id: "daily", name: "Tous les jours" },
  { id: "weekly", name: "Toutes les semaines" },
  { id: "biweekly", name: "Toutes les deux semaines" },
  { id: "monthly", name: "Tous les mois" },
];

function shift(day: string | null, r: NonNullable<Task["recurrence"]>) {
  if (!day) return null;
  const d = parseDay(day)!;
  if (r === "monthly") return iso(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  return iso(addDays(d, RECUR_DAYS[r]));
}

/** Insère une tâche (le numéro est attribué par le trigger), avec ses étiquettes. */
export async function insertTask(sb: DB, workspaceId: string, t: NewTask): Promise<Task> {
  let position = t.position;
  if (position === undefined) {
    const last = must(await sb.from("tasks").select("position").eq("project_id", t.project_id).order("position", { ascending: false }).limit(1));
    position = (last?.[0]?.position ?? 0) + 1000;
  }
  const { label_ids, ...rest } = t;
  const row = { ...rest, workspace_id: workspaceId, position } as unknown as TablesInsert<"tasks">;
  const created = must(await sb.from("tasks").insert(row).select("id").single())!;
  if (label_ids?.length) must(await sb.from("task_labels").insert(label_ids.map((label_id) => ({ task_id: created.id, label_id }))));
  const full = must(await sb.from("tasks").select(TASK_SELECT).eq("id", created.id).single());
  return normalizeTask(full);
}

const keyOf = (t: Task, projectKey?: string) => (projectKey ? `${projectKey}-${t.number}` : `#${t.number}`);

/**
 * Actions sur les tâches, partagées par toutes les vues et le tiroir.
 * `local` applique la mise à jour optimiste sur l'état de la vue avant l'appel réseau.
 */
export function useTaskActions(local?: LocalUpdate) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();

  const apply = useCallback(
    (ids: string[], fn: (t: Task) => Task) => local?.((ts) => ts.map((t) => (ids.includes(t.id) ? fn(t) : t))),
    [local],
  );

  const log = useCallback(
    async (sb: DB, list: Task[], patch: TaskPatch) => {
      const rows: TablesInsert<"activity">[] = [];
      for (const t of list) {
        const meta = { title: t.title, key: keyOf(t, ws.project(t.project_id)?.key) };
        if (patch.status && patch.status !== t.status)
          rows.push({
            workspace_id: ws.workspace.id, project_id: t.project_id, task_id: t.id,
            verb: patch.status === "done" ? "task.completed" : "task.status",
            meta: { ...meta, from: t.status, to: patch.status } as Json,
          });
        if (patch.assignee_id !== undefined && patch.assignee_id !== t.assignee_id)
          rows.push({
            workspace_id: ws.workspace.id, project_id: t.project_id, task_id: t.id, verb: "task.assigned",
            meta: { ...meta, from: t.assignee_id, to: patch.assignee_id } as Json,
          });
      }
      if (rows.length) await sb.from("activity").insert(rows);
    },
    [ws],
  );

  // Tâche récurrente terminée : crée l'occurrence suivante et retire la récurrence de l'ancienne.
  const spawnNext = useCallback(
    async (sb: DB, list: Task[]) => {
      for (const t of list) {
        if (!t.recurrence) continue;
        const r = t.recurrence;
        const due = shift(t.due_date ?? iso(today()), r);
        await insertTask(sb, ws.workspace.id, {
          project_id: t.project_id, title: t.title, description: t.description, status: "todo", priority: t.priority,
          assignee_id: t.assignee_id, start_date: shift(t.start_date, r), due_date: due, recurrence: r,
          milestone: t.milestone, label_ids: t.label_ids,
        });
        await sb.from("tasks").update({ recurrence: null }).eq("id", t.id);
      }
      if (list.some((t) => t.recurrence)) toast("Prochaine occurrence créée");
    },
    [ws, toast],
  );

  const update = useCallback(
    async (list: Task[], patch: TaskPatch, opt: { toast?: string; undo?: boolean } = {}) => {
      if (!list.length) return;
      const ids = list.map((t) => t.id);
      const now = new Date().toISOString();
      apply(ids, (t) => ({
        ...t,
        ...patch,
        completed_at: patch.status ? (patch.status === "done" ? (t.completed_at ?? now) : null) : t.completed_at,
      }));
      const keys = Object.keys(patch) as (keyof TaskPatch)[];
      const prev = list.map((t) => ({ id: t.id, vals: Object.fromEntries(keys.map((k) => [k, t[k]])) as TaskPatch }));
      const recurring = patch.status === "done" ? list.filter((t) => t.recurrence && t.status !== "done") : [];
      await mutate(
        async (sb) => {
          must(await sb.from("tasks").update(patch).in("id", ids));
          await log(sb, list, patch);
          if (recurring.length) await spawnNext(sb, recurring);
        },
        {
          success: opt.toast,
          undo:
            opt.undo && !recurring.length
              ? async () => {
                  apply(ids, (t) => ({ ...t, ...prev.find((p) => p.id === t.id)!.vals }));
                  const sb = supabaseBrowser();
                  await Promise.all(prev.map((p) => sb.from("tasks").update(p.vals).eq("id", p.id)));
                }
              : undefined,
        },
      );
    },
    [apply, mutate, log, spawnNext],
  );

  const setLabels = useCallback(
    async (t: Task, labelIds: string[]) => {
      apply([t.id], (x) => ({ ...x, label_ids: labelIds }));
      const add = labelIds.filter((l) => !t.label_ids.includes(l));
      const del = t.label_ids.filter((l) => !labelIds.includes(l));
      await mutate(async (sb) => {
        if (del.length) must(await sb.from("task_labels").delete().eq("task_id", t.id).in("label_id", del));
        if (add.length) must(await sb.from("task_labels").insert(add.map((label_id) => ({ task_id: t.id, label_id }))));
      });
    },
    [apply, mutate],
  );

  /** Ajoute l'étiquette à toutes les tâches, ou la retire si toutes l'ont déjà. */
  const toggleLabel = useCallback(
    async (list: Task[], labelId: string) => {
      const all = list.every((t) => t.label_ids.includes(labelId));
      const ids = list.map((t) => t.id);
      apply(ids, (t) => ({ ...t, label_ids: all ? t.label_ids.filter((l) => l !== labelId) : [...new Set([...t.label_ids, labelId])] }));
      await mutate(async (sb) => {
        if (all) must(await sb.from("task_labels").delete().eq("label_id", labelId).in("task_id", ids));
        else
          must(
            await sb.from("task_labels").upsert(
              list.filter((t) => !t.label_ids.includes(labelId)).map((t) => ({ task_id: t.id, label_id: labelId })),
              { onConflict: "task_id,label_id", ignoreDuplicates: true },
            ),
          );
      }, { success: list.length > 1 ? (all ? "Étiquette retirée" : "Étiquette ajoutée") : undefined });
    },
    [apply, mutate],
  );

  const archive = useCallback(
    async (list: Task[]) => {
      const ids = list.map((t) => t.id);
      local?.((ts) => ts.filter((t) => !ids.includes(t.id)));
      await mutate(async (sb) => must(await sb.from("tasks").update({ archived_at: new Date().toISOString() }).in("id", ids)), {
        success: list.length > 1 ? `${list.length} tâches archivées` : "Tâche archivée",
        undo: async () => {
          await supabaseBrowser().from("tasks").update({ archived_at: null }).in("id", ids);
        },
      });
    },
    [local, mutate],
  );

  const remove = useCallback(
    async (list: Task[]) => {
      const ids = list.map((t) => t.id);
      local?.((ts) => ts.filter((t) => !ids.includes(t.id)));
      await mutate(async (sb) => must(await sb.from("tasks").delete().in("id", ids)), {
        success: list.length > 1 ? `${list.length} tâches supprimées` : "Tâche supprimée",
      });
    },
    [local, mutate],
  );

  const create = useCallback(
    async (t: NewTask, opt: { toast?: boolean } = {}) => {
      const res = await mutate(async (sb) => {
        const task = await insertTask(sb, ws.workspace.id, t);
        await sb.from("activity").insert({
          workspace_id: ws.workspace.id, project_id: task.project_id, task_id: task.id, verb: "task.created",
          meta: { title: task.title, key: keyOf(task, ws.project(task.project_id)?.key) },
        });
        return task;
      });
      if (res) {
        local?.((ts) => [...ts, res]);
        if (opt.toast) toast(`Tâche ${keyOf(res, ws.project(res.project_id)?.key)} créée`);
      }
      return res;
    },
    [local, mutate, toast, ws],
  );

  const duplicate = useCallback(
    async (t: Task) => {
      const res = await mutate(
        async (sb) => {
          const copy = await insertTask(sb, ws.workspace.id, {
            project_id: t.project_id, title: `${t.title} (copie)`, description: t.description, status: t.status === "done" ? "todo" : t.status,
            priority: t.priority, assignee_id: t.assignee_id, start_date: t.start_date, due_date: t.due_date, milestone: t.milestone,
            recurrence: t.recurrence, position: t.position + 0.5, label_ids: t.label_ids,
          });
          if (t.subtasks.length)
            must(await sb.from("subtasks").insert(t.subtasks.map((s) => ({ task_id: copy.id, title: s.title, position: s.position, assignee_id: s.assignee_id }))));
          return copy;
        },
        { success: "Tâche dupliquée" },
      );
      if (res) local?.((ts) => [...ts, { ...res, subtasks: t.subtasks.map((s) => ({ ...s, done: false })) }]);
      return res;
    },
    [local, mutate, ws],
  );

  return useMemo(
    () => ({ update, setLabels, toggleLabel, archive, remove, create, duplicate }),
    [update, setLabels, toggleLabel, archive, remove, create, duplicate],
  );
}

export type TaskActions = ReturnType<typeof useTaskActions>;
