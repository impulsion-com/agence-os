import { notFound } from "next/navigation";

import { LITE_TASK_SELECT, type LiteTask } from "@/components/workspace/lite";
import { TeamDetail } from "@/components/workspace/team-detail";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Équipe" };

export default async function TeamPage({ params }: PageProps<"/w/[slug]/teams/[id]">) {
  const { slug, id } = await params;
  const ws = await loadWorkspace(slug);
  if (!ws.teams.some((t) => t.id === id)) notFound();
  const memberIds = ws.members.filter((m) => m.team_id === id).map((m) => m.user_id);
  const projectIds = ws.projects.filter((p) => p.team_id === id).map((p) => p.id);
  const sb = await supabaseServer();
  // Tâches ouvertes des membres de l'équipe ou des projets de l'équipe
  const ors = [
    memberIds.length ? `assignee_id.in.(${memberIds.join(",")})` : "",
    projectIds.length ? `project_id.in.(${projectIds.join(",")})` : "",
  ].filter(Boolean);
  const { data } = ors.length
    ? await sb.from("tasks").select(LITE_TASK_SELECT).eq("workspace_id", ws.workspace.id).neq("status", "done").is("archived_at", null).or(ors.join(","))
    : { data: [] };
  return <TeamDetail teamId={id} tasks={(data ?? []) as LiteTask[]} />;
}
