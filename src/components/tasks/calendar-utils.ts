"use client";

// Outils partagés par le calendrier et la timeline : ouverture d'une tâche,
// surcharges optimistes des dates, et persistance des dates en base.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";
import { colorOf } from "@/lib/constants";
import { addDays, diffDays, fmtDate, iso, parseDay } from "@/lib/format";
import type { Task } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

export type DatePatch = Partial<Pick<Task, "start_date" | "due_date">>;

// Ajoute ?task=<id> à l'URL courante en conservant les autres paramètres.
// history.pushState (synchronisé avec useSearchParams par Next) évite un aller-retour serveur.
export function useOpenTask() {
  return useCallback((id: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("task", id);
    window.history.pushState(null, "", u.pathname + u.search + u.hash);
  }, []);
}

interface Override {
  patch: DatePatch;
  base: Task[]; // liste reçue au moment de la modification
  pending: boolean;
}

/**
 * Surcharges optimistes : une modification s'applique tant que la requête est en cours
 * ou tant que le serveur n'a pas renvoyé une nouvelle liste de tâches.
 */
export function useOptimisticDates(tasks: Task[]) {
  const [ov, setOv] = useState<Record<string, Override>>({});
  const mutate = useMutate();

  const list = useMemo(() => {
    const keys = Object.keys(ov);
    if (!keys.length) return tasks;
    return tasks.map((t) => {
      const o = ov[t.id];
      return o && (o.pending || o.base === tasks) ? { ...t, ...o.patch } : t;
    });
  }, [tasks, ov]);

  const save = useCallback(
    async (task: Task, patch: DatePatch, opt: { success?: string } = {}) => {
      const prev: DatePatch = { start_date: task.start_date, due_date: task.due_date };
      setOv((s) => ({ ...s, [task.id]: { patch, base: tasks, pending: true } }));
      const ok = await mutate(
        async (sb) => {
          must(await sb.from("tasks").update(patch).eq("id", task.id).select("id"));
          return true;
        },
        {
          success: opt.success,
          undo: async () => {
            setOv((s) => ({ ...s, [task.id]: { patch: prev, base: tasks, pending: true } }));
            await supabaseUpdate(task.id, prev);
            setOv((s) => ({ ...s, [task.id]: { ...s[task.id], pending: false } }));
          },
        },
      );
      setOv((s) => {
        if (!ok) {
          const next = { ...s };
          delete next[task.id];
          return next;
        }
        return s[task.id] ? { ...s, [task.id]: { ...s[task.id], pending: false } } : s;
      });
    },
    [mutate, tasks],
  );

  return { list, save };
}

async function supabaseUpdate(id: string, patch: DatePatch) {
  await supabaseBrowser().from("tasks").update(patch).eq("id", id);
}

// Déplace l'échéance d'une tâche au jour donné, en conservant la durée si elle a un début.
export function moveToDay(t: Task, day: string): DatePatch {
  const due = parseDay(t.due_date);
  const start = parseDay(t.start_date);
  if (due && start && start <= due) {
    const delta = diffDays(parseDay(day)!, due);
    return { due_date: day, start_date: iso(addDays(start, delta)) };
  }
  if (start && !due) return { due_date: day, start_date: start <= parseDay(day)! ? t.start_date : day };
  return { due_date: day };
}

export const movedMsg = (d: string | null | undefined) => (d ? `Échéance déplacée au ${fmtDate(d)}` : "Date retirée");

// Couleur de la tâche : celle de son projet.
export function useTaskColor() {
  const ws = useWorkspace();
  return useCallback((t: Pick<Task, "project_id">) => colorOf(ws.project(t.project_id)?.color), [ws]);
}

// Projet par défaut pour une création : celui passé en prop, sinon l'unique projet des tâches.
export function defaultProject(tasks: Task[], projectId?: string) {
  if (projectId) return projectId;
  const ids = new Set(tasks.map((t) => t.project_id));
  return ids.size === 1 ? [...ids][0] : undefined;
}

// Préférence locale (vue, zoom…) conservée dans le navigateur, sans écart d'hydratation.
const prefListeners = new Set<() => void>();
function readRaw(key: string) {
  try {
    return localStorage.getItem(`aos:${key}`);
  } catch {
    return null;
  }
}
export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      prefListeners.add(cb);
      return () => prefListeners.delete(cb);
    },
    () => readRaw(key),
    () => null,
  );
  const value = raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(`aos:${key}`, v);
      } catch {
        /* stockage indisponible */
      }
      prefListeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
