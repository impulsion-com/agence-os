import { OverviewView } from "@/components/workspace/overview";
import { LITE_TASK_SELECT, type LiteTask } from "@/components/workspace/lite";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Vue d'ensemble" };

export default async function Overview({ params }: PageProps<"/w/[slug]/overview">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const [tasks, invites] = await Promise.all([
    sb.from("tasks").select(LITE_TASK_SELECT).eq("workspace_id", ws.workspace.id).is("archived_at", null),
    sb.from("invitations").select("id", { count: "exact", head: true }).eq("workspace_id", ws.workspace.id).is("accepted_at", null),
  ]);
  return <OverviewView tasks={(tasks.data ?? []) as LiteTask[]} pendingInvites={invites.count ?? 0} />;
}
