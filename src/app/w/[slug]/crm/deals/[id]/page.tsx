import { notFound } from "next/navigation";

import type { JournalEvent } from "@/components/crm/activity-feed";
import { DealPage, type ProposalRow } from "@/components/crm/deal-page";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Contact, CrmActivity, Deal, PipelineStage, Service } from "@/lib/types";

export default async function DealRoute({ params }: PageProps<"/w/[slug]/crm/deals/[id]">) {
  const { slug, id } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const wid = ws.workspace.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: deal } = await sb.from("deals").select("*").eq("id", id).eq("workspace_id", wid).maybeSingle();
  if (!deal) notFound();
  const [stages, contacts, services, activities, journal, proposals, company] = await Promise.all([
    sb.from("pipeline_stages").select("*").eq("workspace_id", wid).order("position"),
    sb.from("contacts").select("*").eq("workspace_id", wid).order("first_name"),
    sb.from("services").select("*").eq("workspace_id", wid).eq("archived", false).order("position"),
    sb.from("crm_activities").select("*").eq("deal_id", id).order("created_at", { ascending: false }),
    sb.from("activity").select("id, verb, actor_id, meta, created_at").eq("deal_id", id).like("verb", "deal.%").order("created_at", { ascending: false }).limit(50),
    sb.from("proposals").select("id, number, title, status, created_at, sent_at, company_id, deal_id").eq("deal_id", id).order("created_at", { ascending: false }),
    deal.company_id
      ? sb.from("companies").select("id, name, color, status, website, industry, monthly_retainer").eq("id", deal.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return (
    <DealPage
      deal={deal as Deal}
      stages={(stages.data ?? []) as PipelineStage[]}
      contacts={(contacts.data ?? []) as Contact[]}
      services={(services.data ?? []) as Service[]}
      activities={(activities.data ?? []) as CrmActivity[]}
      journal={(journal.data ?? []) as JournalEvent[]}
      proposals={(proposals.data ?? []) as ProposalRow[]}
      company={(company.data ?? null) as Parameters<typeof DealPage>[0]["company"]}
    />
  );
}
