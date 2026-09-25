import type { Metadata } from "next";

import { ProposalsList, type ProposalRow } from "@/components/proposals/proposals-list";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Propositions" };

export default async function ProposalsPage({ params }: PageProps<"/w/[slug]/proposals">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data } = await sb
    .from("proposals")
    .select(
      "id, number, title, status, company_id, contact_id, deal_id, owner_id, currency, discount_pct, tax_pct, valid_until, sent_at, viewed_at, accepted_at, created_at, updated_at, items:proposal_items(id, quantity, unit_price, billing, optional, selected)",
    )
    .eq("workspace_id", ws.workspace.id)
    .order("number", { ascending: false });
  return <ProposalsList rows={(data ?? []) as unknown as ProposalRow[]} />;
}
