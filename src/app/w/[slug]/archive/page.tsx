import { ArchiveView, type ArchivedTask } from "@/components/workspace/archive";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Archives" };

export default async function Archive({ params }: PageProps<"/w/[slug]/archive">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const archivedProjects = new Set(ws.projects.filter((p) => p.archived_at).map((p) => p.id));
  const { data } = await sb
    .from("tasks")
    .select("id, title, number, status, priority, project_id, assignee_id, archived_at")
    .eq("workspace_id", ws.workspace.id)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(500);
  // Les tâches d'un projet archivé sont restaurées avec lui : on ne liste que les tâches archivées seules
  const tasks = ((data ?? []) as ArchivedTask[]).filter((t) => !archivedProjects.has(t.project_id));
  return <ArchiveView tasks={tasks} />;
}
