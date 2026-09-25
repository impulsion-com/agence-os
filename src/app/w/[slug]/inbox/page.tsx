import { InboxView, type InboxItem } from "@/components/workspace/inbox";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Boîte de réception" };

export default async function Inbox({ params }: PageProps<"/w/[slug]/inbox">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data } = await sb
    .from("notifications")
    .select(
      "*, task:tasks(id, title, number, status, priority, due_date, project_id, description, assignee_id), deal:deals(id, title, value, billing, stage_id, company_id, expected_close)",
    )
    .eq("workspace_id", ws.workspace.id)
    .eq("user_id", ws.me.id)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as InboxItem[];

  // Propositions (pas de clé étrangère sur notifications.proposal_id) et étapes du pipeline
  const propIds = [...new Set(rows.map((r) => r.proposal_id).filter(Boolean) as string[])];
  const [props, stages] = await Promise.all([
    propIds.length
      ? sb.from("proposals").select("id, title, number, status, company_id, valid_until, sent_at").in("id", propIds)
      : Promise.resolve({ data: [] as never[] }),
    sb.from("pipeline_stages").select("id, name, color, kind").eq("workspace_id", ws.workspace.id),
  ]);
  const propOf = new Map((props.data ?? []).map((p) => [p.id, p]));
  for (const r of rows) r.proposal = r.proposal_id ? (propOf.get(r.proposal_id) ?? null) : null;

  return <InboxView items={rows} stages={stages.data ?? []} />;
}
