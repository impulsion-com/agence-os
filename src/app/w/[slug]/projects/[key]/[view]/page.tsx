import { notFound, redirect } from "next/navigation";

import { ProjectPage, type ProjectViewKey } from "@/components/projects/project-page";
import { supabaseServer } from "@/lib/supabase/server";
import { TASK_SELECT, normalizeTask } from "@/lib/tasks";
import type { ActivityItem, SavedView } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace/load";

const VIEWS: ProjectViewKey[] = ["overview", "board", "list", "table", "calendar", "timeline", "files", "activity"];

export default async function ProjectViewPage({ params }: PageProps<"/w/[slug]/projects/[key]/[view]">) {
  const { slug, key, view } = await params;
  if (!VIEWS.includes(view as ProjectViewKey)) notFound();
  const ws = await loadWorkspace(slug);
  const project = ws.projects.find((p) => p.key === key.toUpperCase());
  if (!project) notFound();
  if (project.key !== key) redirect(`/w/${slug}/projects/${project.key}/${view}`);

  const sb = await supabaseServer();
  const withFeed = view === "overview" || view === "activity";
  const [tasks, views, members, activity] = await Promise.all([
    sb.from("tasks").select(TASK_SELECT).eq("project_id", project.id).is("archived_at", null).order("position"),
    sb.from("saved_views").select("*").eq("project_id", project.id).order("created_at"),
    sb.from("project_members").select("user_id").eq("project_id", project.id),
    withFeed
      ? sb.from("activity").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(view === "activity" ? 150 : 12)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <ProjectPage
      project={project}
      view={view as ProjectViewKey}
      tasks={(tasks.data ?? []).map(normalizeTask)}
      views={(views.data ?? []) as unknown as SavedView[]}
      memberIds={(members.data ?? []).map((m) => m.user_id)}
      activity={(activity.data ?? []) as unknown as ActivityItem[]}
    />
  );
}
