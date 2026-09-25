import { LabelsSettings } from "@/components/workspace/settings/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Étiquettes" };

export default async function LabelsPage({ params }: PageProps<"/w/[slug]/settings/labels">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data } = await sb.from("labels").select("id, task_labels(count)").eq("workspace_id", ws.workspace.id);
  const counts = Object.fromEntries((data ?? []).map((l) => [l.id, (l.task_labels as unknown as { count: number }[])?.[0]?.count ?? 0]));
  return <LabelsSettings counts={counts} />;
}
