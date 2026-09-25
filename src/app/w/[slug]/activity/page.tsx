import { ActivityView } from "@/components/workspace/activity";
import { ACTIVITY_SELECT, type ActivityRow } from "@/components/workspace/lite";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Activité" };

export default async function Activity({ params, searchParams }: PageProps<"/w/[slug]/activity">) {
  const { slug } = await params;
  const sp = await searchParams;
  const limit = Math.min(2000, Math.max(100, Number(sp.n) || 200));
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data } = await sb
    .from("activity")
    .select(ACTIVITY_SELECT)
    .eq("workspace_id", ws.workspace.id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  const rows = (data ?? []) as unknown as ActivityRow[];
  return <ActivityView items={rows.slice(0, limit)} hasMore={rows.length > limit} limit={limit} />;
}
