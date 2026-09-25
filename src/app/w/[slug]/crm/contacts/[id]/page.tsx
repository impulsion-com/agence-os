import { notFound } from "next/navigation";

import { ContactPage } from "@/components/crm/contact-page";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Contact, CrmActivity, Deal, PipelineStage } from "@/lib/types";

export default async function ContactRoute({ params }: PageProps<"/w/[slug]/crm/contacts/[id]">) {
  const { slug, id } = await params;
  const ws = await loadWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServer();
  const wid = ws.workspace.id;
  const { data: contact } = await sb.from("contacts").select("*").eq("id", id).eq("workspace_id", wid).maybeSingle();
  if (!contact) notFound();
  const [deals, stages, activities] = await Promise.all([
    sb.from("deals").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
    sb.from("pipeline_stages").select("*").eq("workspace_id", wid).order("position"),
    sb.from("crm_activities").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  return (
    <ContactPage
      contact={contact as Contact}
      deals={(deals.data ?? []) as Deal[]}
      stages={(stages.data ?? []) as PipelineStage[]}
      activities={(activities.data ?? []) as CrmActivity[]}
    />
  );
}
