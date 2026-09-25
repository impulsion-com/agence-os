import { notFound } from "next/navigation";

import { CompanyPage } from "@/components/crm/company-page";
import type { ProposalRow } from "@/components/crm/deal-page";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Company, Contact, CrmActivity, Deal, PipelineStage } from "@/lib/types";

export default async function CompanyRoute({ params }: PageProps<"/w/[slug]/crm/companies/[id]">) {
  const { slug, id } = await params;
  const ws = await loadWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServer();
  const wid = ws.workspace.id;
  const { data: company } = await sb.from("companies").select("*").eq("id", id).eq("workspace_id", wid).maybeSingle();
  if (!company) notFound();
  const [contacts, deals, stages, proposals, activities] = await Promise.all([
    sb.from("contacts").select("*").eq("company_id", id).order("first_name"),
    sb.from("deals").select("*").eq("company_id", id).order("created_at", { ascending: false }),
    sb.from("pipeline_stages").select("*").eq("workspace_id", wid).order("position"),
    sb.from("proposals").select("id, number, title, status, created_at, sent_at, company_id, deal_id").eq("company_id", id).order("created_at", { ascending: false }),
    sb.from("crm_activities").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  return (
    <CompanyPage
      company={company as Company}
      contacts={(contacts.data ?? []) as Contact[]}
      deals={(deals.data ?? []) as Deal[]}
      stages={(stages.data ?? []) as PipelineStage[]}
      proposals={(proposals.data ?? []) as ProposalRow[]}
      activities={(activities.data ?? []) as CrmActivity[]}
    />
  );
}
