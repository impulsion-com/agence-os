import { notFound } from "next/navigation";

import { ACTIVITY_SELECT, LITE_TASK_SELECT, type ActivityRow, type LiteTask } from "@/components/workspace/lite";
import { MemberDetail } from "@/components/workspace/member-detail";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Membre" };

export default async function MemberPage({ params }: PageProps<"/w/[slug]/members/[id]">) {
  const { slug, id } = await params;
  const ws = await loadWorkspace(slug);
  if (!ws.members.some((m) => m.user_id === id)) notFound();
  const sb = await supabaseServer();
  const [tasks, activity] = await Promise.all([
    sb.from("tasks").select(LITE_TASK_SELECT).eq("workspace_id", ws.workspace.id).eq("assignee_id", id).is("archived_at", null),
    sb.from("activity").select(ACTIVITY_SELECT).eq("workspace_id", ws.workspace.id).eq("actor_id", id).order("created_at", { ascending: false }).limit(15),
  ]);
  return <MemberDetail userId={id} tasks={(tasks.data ?? []) as LiteTask[]} activity={(activity.data ?? []) as unknown as ActivityRow[]} />;
}
