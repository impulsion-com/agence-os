import { PipelineSettings } from "@/components/crm/pipeline-settings";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { PipelineStage } from "@/lib/types";

export const metadata = { title: "Pipeline" };

export default async function PipelineSettingsPage({ params }: PageProps<"/w/[slug]/settings/pipeline">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const [stages, deals] = await Promise.all([
    sb.from("pipeline_stages").select("*").eq("workspace_id", ws.workspace.id).order("position"),
    sb.from("deals").select("stage_id").eq("workspace_id", ws.workspace.id),
  ]);
  const counts: Record<string, number> = {};
  for (const d of deals.data ?? []) if (d.stage_id) counts[d.stage_id] = (counts[d.stage_id] ?? 0) + 1;
  return <PipelineSettings stages={(stages.data ?? []) as PipelineStage[]} dealCounts={counts} />;
}
