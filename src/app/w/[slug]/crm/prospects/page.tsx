import { ProspectsView } from "@/components/crm/prospects-view";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Prospect } from "@/lib/prospects";

// Au-delà, la liste reste utilisable mais le navigateur peine : on charge les plus récentes
const LIMIT = 5000;

export default async function ProspectsPage({ params }: PageProps<"/w/[slug]/crm/prospects">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data, count } = await sb.from("prospects").select("*", { count: "exact" }).eq("workspace_id", ws.workspace.id).order("created_at", { ascending: false }).limit(LIMIT);
  return <ProspectsView prospects={(data ?? []) as Prospect[]} total={count ?? 0} limit={LIMIT} />;
}
