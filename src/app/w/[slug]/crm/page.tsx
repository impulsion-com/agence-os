import { PipelineView } from "@/components/crm/pipeline-view";
import type { FollowUp } from "@/components/crm/followups";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Deal, PipelineStage } from "@/lib/types";

export default async function CrmPage({ params, searchParams }: PageProps<"/w/[slug]/crm">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const id = ws.workspace.id;
  const [stages, deals, tasks, services] = await Promise.all([
    sb.from("pipeline_stages").select("*").eq("workspace_id", id).order("position"),
    sb.from("deals").select("*").eq("workspace_id", id).order("position"),
    sb
      .from("crm_activities")
      .select("id, body, due_at, deal_id, company_id, contact_id, deal:deals(title)")
      .eq("workspace_id", id)
      .eq("kind", "task")
      .eq("done", false)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    sb.from("services").select("name").eq("workspace_id", id).eq("archived", false).order("position"),
  ]);
  const followUps: FollowUp[] = (tasks.data ?? []).map(({ deal, ...t }) => ({ ...t, deal_title: (deal as { title: string } | null)?.title ?? null }));
  return (
    <PipelineView
      stages={(stages.data ?? []) as PipelineStage[]}
      deals={(deals.data ?? []) as Deal[]}
      followUps={followUps}
      serviceNames={(services.data ?? []).map((s) => s.name)}
      initialView={sp.view === "list" ? "list" : "board"}
    />
  );
}
