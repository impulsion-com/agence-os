import { CompaniesView, type CompanyRow } from "@/components/crm/companies-view";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Company } from "@/lib/types";

export default async function CompaniesPage({ params }: PageProps<"/w/[slug]/crm/companies">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const id = ws.workspace.id;
  const [companies, deals, stages, acts] = await Promise.all([
    sb.from("companies").select("*").eq("workspace_id", id).order("name"),
    sb.from("deals").select("company_id, stage_id, value").eq("workspace_id", id),
    sb.from("pipeline_stages").select("id, kind").eq("workspace_id", id),
    sb.from("crm_activities").select("company_id, created_at").eq("workspace_id", id).not("company_id", "is", null).order("created_at", { ascending: false }).limit(2000),
  ]);
  const openStage = new Set((stages.data ?? []).filter((s) => s.kind === "open").map((s) => s.id));
  const last = new Map<string, string>();
  for (const a of acts.data ?? []) if (a.company_id && !last.has(a.company_id)) last.set(a.company_id, a.created_at);
  const rows: CompanyRow[] = ((companies.data ?? []) as Company[]).map((c) => {
    const open = (deals.data ?? []).filter((d) => d.company_id === c.id && (!d.stage_id || openStage.has(d.stage_id)));
    return {
      ...c,
      open_deals: open.length,
      open_value: open.reduce((a, d) => a + Number(d.value), 0),
      active_projects: ws.projects.filter((p) => p.company_id === c.id && !p.archived_at && p.status !== "complete").length,
      last_activity: last.get(c.id) ?? null,
    };
  });
  return <CompaniesView companies={rows} />;
}
