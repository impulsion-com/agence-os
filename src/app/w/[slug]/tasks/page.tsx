import { WorkspaceTasks } from "@/components/tasks/workspace-tasks";
import { supabaseServer } from "@/lib/supabase/server";
import { TASK_SELECT, normalizeTask } from "@/lib/tasks";
import { loadWorkspace } from "@/lib/workspace/load";

export default async function TasksPage({ params }: PageProps<"/w/[slug]/tasks">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const live = ws.projects.filter((p) => !p.archived_at).map((p) => p.id);
  const { data } = live.length
    ? await sb.from("tasks").select(TASK_SELECT).eq("workspace_id", ws.workspace.id).in("project_id", live).is("archived_at", null).order("position").limit(2000)
    : { data: [] };
  return <WorkspaceTasks tasks={(data ?? []).map(normalizeTask)} />;
}
