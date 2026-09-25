import { MyTasks } from "@/components/tasks/my-tasks";
import { supabaseServer } from "@/lib/supabase/server";
import { TASK_SELECT, normalizeTask } from "@/lib/tasks";
import { loadWorkspace } from "@/lib/workspace/load";

export default async function MyTasksPage({ params }: PageProps<"/w/[slug]/my-tasks">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data } = await sb
    .from("tasks")
    .select(TASK_SELECT)
    .eq("workspace_id", ws.workspace.id)
    .eq("assignee_id", ws.me.id)
    .is("archived_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1000);
  return <MyTasks tasks={(data ?? []).map(normalizeTask)} />;
}
