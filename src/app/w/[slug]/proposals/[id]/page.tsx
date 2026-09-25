import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProposalEditor, type EditorData } from "@/components/proposals/proposal-editor";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(slug: string, id: string) {
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  // Accepte l'identifiant ou le numéro (#12)
  const q = sb.from("proposals").select("*").eq("workspace_id", ws.workspace.id);
  const { data: proposal } = await (UUID.test(id) ? q.eq("id", id) : /^\d+$/.test(id) ? q.eq("number", Number(id)) : q.eq("id", "00000000-0000-0000-0000-000000000000")).maybeSingle();
  return { ws, sb, proposal };
}

export async function generateMetadata({ params }: PageProps<"/w/[slug]/proposals/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const { proposal } = await load(slug, id);
  return { title: proposal ? `#${proposal.number} ${proposal.title}` : "Proposition" };
}

export default async function ProposalPage({ params }: PageProps<"/w/[slug]/proposals/[id]">) {
  const { slug, id } = await params;
  const { ws, sb, proposal } = await load(slug, id);
  if (!proposal) notFound();

  const [items, services, contacts, deals, stages] = await Promise.all([
    sb.from("proposal_items").select("*").eq("proposal_id", proposal.id).order("position"),
    sb.from("services").select("*").eq("workspace_id", ws.workspace.id).order("position"),
    sb.from("contacts").select("id, first_name, last_name, email, company_id").eq("workspace_id", ws.workspace.id).order("first_name"),
    sb.from("deals").select("id, title, company_id, contact_id, stage_id, closed_at").eq("workspace_id", ws.workspace.id).order("created_at", { ascending: false }),
    sb.from("pipeline_stages").select("id, name, position, kind").eq("workspace_id", ws.workspace.id).order("position"),
  ]);

  const data = {
    proposal,
    items: items.data ?? [],
    services: services.data ?? [],
    contacts: contacts.data ?? [],
    deals: deals.data ?? [],
    stages: stages.data ?? [],
  } as unknown as EditorData;

  return <ProposalEditor key={proposal.id} data={data} />;
}
