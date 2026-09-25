import { PRIORITY, STATUSES } from "./constants";
import { diffDays, parseDay, today } from "./format";
import type { GroupKey, SortKey, Task, TaskFilters } from "./types";

// Sélection Supabase d'une tâche avec ses relations, à normaliser par normalizeTask.
export const TASK_SELECT =
  "*, task_labels(label_id), subtasks(*), task_dependencies!task_dependencies_task_id_fkey(depends_on_id), comments(count), attachments(count)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeTask(r: any): Task {
  const { task_labels, subtasks, task_dependencies, comments, attachments, ...rest } = r;
  return {
    ...rest,
    label_ids: (task_labels ?? []).map((l: { label_id: string }) => l.label_id),
    subtasks: [...(subtasks ?? [])].sort((a, b) => a.position - b.position),
    depends_on: (task_dependencies ?? []).map((d: { depends_on_id: string }) => d.depends_on_id),
    comment_count: comments?.[0]?.count ?? 0,
    attachment_count: attachments?.[0]?.count ?? 0,
  };
}

export const taskKey = (t: Pick<Task, "number">, projectKey: string) => `${projectKey}-${t.number}`;

export const isOverdue = (t: Pick<Task, "due_date" | "status">) =>
  !!t.due_date && t.status !== "done" && diffDays(parseDay(t.due_date)!, today()) < 0;

export function taskProgress(t: Task) {
  if (t.status === "done") return 100;
  if (t.subtasks.length) return Math.round((t.subtasks.filter((s) => s.done).length / t.subtasks.length) * 100);
  return { backlog: 0, todo: 5, progress: 45, review: 80 }[t.status] ?? 0;
}

export function projectProgress(tasks: Task[]) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100);
}

export function matchFilters(t: Task, f: TaskFilters | undefined) {
  if (!f) return true;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!t.title.toLowerCase().includes(q) && !String(t.number).includes(q)) return false;
  }
  if (f.status?.length && !f.status.includes(t.status)) return false;
  if (f.priority?.length && !f.priority.includes(t.priority)) return false;
  if (f.assignee?.length && !f.assignee.includes(t.assignee_id ?? "none")) return false;
  if (f.label?.length && !t.label_ids.some((l) => f.label!.includes(l))) return false;
  if (f.project?.length && !f.project.includes(t.project_id)) return false;
  if (f.due) {
    const d = parseDay(t.due_date);
    const n = d ? diffDays(d, today()) : null;
    if (f.due === "none" && d) return false;
    if (f.due === "overdue" && !isOverdue(t)) return false;
    if (f.due === "today" && n !== 0) return false;
    if (f.due === "week" && (n === null || n < 0 || n > 7)) return false;
  }
  return true;
}

export function sortTasks(ts: Task[], s: SortKey = "manual") {
  const a = [...ts];
  const byDue = (x: Task) => (x.due_date ? parseDay(x.due_date)!.getTime() : Infinity);
  switch (s) {
    case "priority":
      return a.sort((x, y) => PRIORITY[y.priority].weight - PRIORITY[x.priority].weight || byDue(x) - byDue(y));
    case "due":
      return a.sort((x, y) => byDue(x) - byDue(y));
    case "created":
      return a.sort((x, y) => y.created_at.localeCompare(x.created_at));
    case "updated":
      return a.sort((x, y) => y.updated_at.localeCompare(x.updated_at));
    case "title":
      return a.sort((x, y) => x.title.localeCompare(y.title, "fr"));
    default:
      return a.sort((x, y) => x.position - y.position || x.number - y.number);
  }
}

export interface TaskGroup {
  key: string;
  tasks: Task[];
}

export function groupTasks(ts: Task[], g: GroupKey = "status"): TaskGroup[] {
  if (g === "none") return [{ key: "all", tasks: ts }];
  if (g === "status") return STATUSES.map((s) => ({ key: s.id, tasks: ts.filter((t) => t.status === s.id) }));
  if (g === "priority")
    return (["urgent", "high", "medium", "low", "none"] as const).map((p) => ({ key: p, tasks: ts.filter((t) => t.priority === p) })).filter((x) => x.tasks.length);
  const map = new Map<string, Task[]>();
  for (const t of ts) {
    const keys = g === "assignee" ? [t.assignee_id ?? "none"] : g === "project" ? [t.project_id] : t.label_ids.length ? t.label_ids : ["none"];
    for (const k of keys) map.set(k, [...(map.get(k) ?? []), t]);
  }
  return [...map.entries()].map(([key, tasks]) => ({ key, tasks }));
}

// Position entre deux voisins, pour le glisser-déposer
export function between(before?: number, after?: number) {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}
