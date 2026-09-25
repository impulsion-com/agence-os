import type { Metadata } from "next";

import { ServicesSettings } from "@/components/proposals/services-settings";
import { supabaseServer } from "@/lib/supabase/server";
import type { Service } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Catalogue de services" };

export default async function ServicesPage({ params }: PageProps<"/w/[slug]/settings/services">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const [{ data }, { data: used }] = await Promise.all([
    sb.from("services").select("*").eq("workspace_id", ws.workspace.id).order("position"),
    sb.from("proposal_items").select("service_id, proposals!inner(workspace_id)").eq("proposals.workspace_id", ws.workspace.id).not("service_id", "is", null),
  ]);
  const usage: Record<string, number> = {};
  for (const u of used ?? []) if (u.service_id) usage[u.service_id] = (usage[u.service_id] ?? 0) + 1;
  return <ServicesSettings services={(data ?? []) as Service[]} usage={usage} />;
}
