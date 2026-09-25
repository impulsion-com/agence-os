import { ProjectsList, type ProjectStats } from "@/components/projects/projects-list";
import { isOverdue } from "@/lib/tasks";
import type { TaskStatus } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export default async function ProjectsPage({ params }: PageProps<"/w/[slug]/projects">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const ids = ws.projects.map((p) => p.id);
  const [tasks, members] = await Promise.all([
    sb.from("tasks").select("project_id, status, assignee_id, due_date").eq("workspace_id", ws.workspace.id).is("archived_at", null),
    ids.length ? sb.from("project_members").select("project_id, user_id").in("project_id", ids) : Promise.resolve({ data: [] as { project_id: string; user_id: string }[] }),
  ]);

  const stats: Record<string, ProjectStats> = {};
  for (const t of tasks.data ?? []) {
    const s = (stats[t.project_id] ??= { total: 0, done: 0, overdue: 0, people: [] });
    s.total++;
    if (t.status === "done") s.done++;
    if (isOverdue({ due_date: t.due_date, status: t.status as TaskStatus })) s.overdue++;
    if (t.assignee_id && !s.people.includes(t.assignee_id)) s.people.push(t.assignee_id);
  }
  const byProject: Record<string, string[]> = {};
  for (const m of members.data ?? []) (byProject[m.project_id] ??= []).push(m.user_id);

  return <ProjectsList stats={stats} members={byProject} />;
}
