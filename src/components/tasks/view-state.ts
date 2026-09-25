"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import type { GroupKey, Priority, SortKey, TaskFilters, TaskStatus, ViewConfig } from "@/lib/types";

// État d'une vue de tâches (filtres, tri, regroupement) porté par l'URL, pour que
// chaque vue soit partageable. Les mises à jour passent par l'API History native
// (intégrée au routeur Next) : pas d'aller-retour serveur à chaque frappe.

const LISTS = { status: "st", priority: "pr", assignee: "as", label: "lb", project: "pj" } as const;
const SORTS: SortKey[] = ["manual", "priority", "due", "created", "updated", "title"];
const GROUPS: GroupKey[] = ["status", "priority", "assignee", "project", "label", "none"];
const DUES = ["overdue", "today", "week", "none"] as const;

export interface ViewDefaults {
  sort?: SortKey;
  group?: GroupKey;
}

export interface ViewState {
  filters: TaskFilters;
  sort: SortKey;
  group: GroupKey;
}

type Params = Pick<URLSearchParams, "get">;

export function parseView(sp: Params, d: ViewDefaults = {}): ViewState {
  const list = (k: string) => {
    const v = sp.get(k);
    return v ? v.split(",").filter(Boolean) : undefined;
  };
  const filters: TaskFilters = {};
  const q = sp.get("q");
  if (q) filters.q = q;
  const st = list(LISTS.status);
  if (st) filters.status = st as TaskStatus[];
  const pr = list(LISTS.priority);
  if (pr) filters.priority = pr as Priority[];
  const as = list(LISTS.assignee);
  if (as) filters.assignee = as;
  const lb = list(LISTS.label);
  if (lb) filters.label = lb;
  const pj = list(LISTS.project);
  if (pj) filters.project = pj;
  const due = sp.get("due");
  if (due && (DUES as readonly string[]).includes(due)) filters.due = due as TaskFilters["due"];
  const sort = sp.get("sort") as SortKey | null;
  const group = sp.get("group") as GroupKey | null;
  return {
    filters,
    sort: sort && SORTS.includes(sort) ? sort : (d.sort ?? "manual"),
    group: group && GROUPS.includes(group) ? group : (d.group ?? "status"),
  };
}

/** Écrit l'état de vue dans des paramètres d'URL (les valeurs par défaut sont omises). */
export function writeView(p: URLSearchParams, v: ViewState, d: ViewDefaults = {}) {
  const f = v.filters;
  const set = (k: string, val: string | undefined) => (val ? p.set(k, val) : p.delete(k));
  set("q", f.q?.trim() || undefined);
  set(LISTS.status, f.status?.join(","));
  set(LISTS.priority, f.priority?.join(","));
  set(LISTS.assignee, f.assignee?.join(","));
  set(LISTS.label, f.label?.join(","));
  set(LISTS.project, f.project?.join(","));
  set("due", f.due);
  set("sort", v.sort !== (d.sort ?? "manual") ? v.sort : undefined);
  set("group", v.group !== (d.group ?? "status") ? v.group : undefined);
  return p;
}

/** Paramètres d'URL d'une vue enregistrée. */
export function configToQuery(c: ViewConfig, d: ViewDefaults = {}) {
  const p = writeView(new URLSearchParams(), { filters: c.filters ?? {}, sort: c.sort ?? d.sort ?? "manual", group: c.group ?? d.group ?? "status" }, d);
  return p.toString();
}

/** Modifie les paramètres de l'URL courante sans recharger la page. */
export function setUrlParams(update: (p: URLSearchParams) => void, push = false) {
  const u = new URL(window.location.href);
  update(u.searchParams);
  const qs = u.searchParams.toString();
  const next = u.pathname + (qs ? `?${qs}` : "") + u.hash;
  if (push) window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

export function openTask(id: string) {
  setUrlParams((p) => p.set("task", id), true);
}

export function taskUrl(base: string, projectKey: string | undefined, id: string) {
  return `${location.origin}${base}/projects/${projectKey ?? ""}/board?task=${id}`;
}

export function countFilters(f: TaskFilters) {
  return (
    (f.status?.length ? 1 : 0) + (f.priority?.length ? 1 : 0) + (f.assignee?.length ? 1 : 0) +
    (f.label?.length ? 1 : 0) + (f.project?.length ? 1 : 0) + (f.due ? 1 : 0)
  );
}

export function useViewState(d: ViewDefaults = {}) {
  const sp = useSearchParams();
  const key = sp.toString();
  const view = useMemo(() => parseView(new URLSearchParams(key), d), [key, d.sort, d.group]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback(
    (patch: Partial<ViewState>) => setUrlParams((p) => writeView(p, { ...parseView(p, d), ...patch }, d)),
    [d.sort, d.group], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return [view, set] as const;
}
