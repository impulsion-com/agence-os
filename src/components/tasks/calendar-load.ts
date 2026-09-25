import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { TASK_SELECT, normalizeTask } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import type { WorkspaceData } from "@/lib/workspace/load";

// Toutes les tâches non archivées des projets non archivés de l'espace (pages Calendrier et Timeline).
export async function loadPlanningTasks(data: WorkspaceData): Promise<Task[]> {
  const live = data.projects.filter((p) => !p.archived_at).map((p) => p.id);
  if (!live.length) return [];
  const sb = await supabaseServer();
  const { data: rows, error } = await sb
    .from("tasks")
    .select(TASK_SELECT)
    .eq("workspace_id", data.workspace.id)
    .is("archived_at", null)
    .in("project_id", live)
    .order("position");
  if (error) throw new Error(error.message);
  return (rows ?? []).map(normalizeTask);
}
