"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/database.types";

import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { Member, Project } from "@/lib/types";
import type { WorkspaceData } from "./load";

interface Ctx extends WorkspaceData {
  base: string; // préfixe des URLs : /w/<slug>
  canWrite: boolean;
  isAdmin: boolean;
  member: (id: string | null | undefined) => Member | undefined;
  project: (id: string | null | undefined) => Project | undefined;
  company: (id: string | null | undefined) => WorkspaceData["companies"][number] | undefined;
  label: (id: string) => WorkspaceData["labels"][number] | undefined;
}

export type DB = SupabaseClient<Database>;

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ data, children }: { data: WorkspaceData; children: ReactNode }) {
  const value = useMemo<Ctx>(() => {
    const members = new Map(data.members.map((m) => [m.user_id, m]));
    const projects = new Map(data.projects.map((p) => [p.id, p]));
    const companies = new Map(data.companies.map((c) => [c.id, c]));
    const labels = new Map(data.labels.map((l) => [l.id, l]));
    return {
      ...data,
      base: `/w/${data.workspace.slug}`,
      canWrite: data.role !== "guest",
      isAdmin: data.role === "owner" || data.role === "admin",
      member: (id) => (id ? members.get(id) : undefined),
      project: (id) => (id ? projects.get(id) : undefined),
      company: (id) => (id ? companies.get(id) : undefined),
      label: (id) => labels.get(id),
    };
  }, [data]);
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const v = useContext(WorkspaceCtx);
  if (!v) throw new Error("useWorkspace hors de WorkspaceProvider");
  return v;
}

/**
 * Exécute une mutation Supabase côté client, affiche l'erreur éventuelle,
 * puis rafraîchit les Server Components. La fonction doit lever en cas d'erreur.
 *
 *   const mutate = useMutate();
 *   await mutate(async (sb) => must(await sb.from("tasks").update({...}).eq("id", id)), { success: "Tâche mise à jour" });
 */
export function useMutate() {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: (sb: DB) => Promise<T>, opt: { success?: string; refresh?: boolean; undo?: () => Promise<unknown> } = {}): Promise<T | undefined> => {
      try {
        const res = await fn(supabaseBrowser());
        if (opt.success)
          toast(opt.success, opt.undo ? { action: { label: "Annuler", run: () => void opt.undo!().then(() => router.refresh()) } } : undefined);
        if (opt.refresh !== false) router.refresh();
        return res;
      } catch (e) {
        toast(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), { error: true });
        return undefined;
      }
    },
    [router, toast],
  );
}

// Lève l'erreur d'une réponse Supabase, renvoie ses données sinon.
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// Journal d'activité (fil du projet, page Activité)
export async function logActivity(
  sb: DB,
  row: { workspace_id: string; verb: string; project_id?: string | null; task_id?: string | null; deal_id?: string | null; meta?: Json },
) {
  await sb.from("activity").insert(row);
}
