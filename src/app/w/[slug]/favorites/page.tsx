import { FavoritesView } from "@/components/workspace/favorites";
import { LITE_TASK_SELECT, type LiteTask } from "@/components/workspace/lite";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Favoris" };

export default async function Favorites({ params }: PageProps<"/w/[slug]/favorites">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const ids = ws.projects.filter((p) => !p.archived_at).map((p) => p.id);
  const { data } = ids.length
    ? await sb.from("tasks").select(LITE_TASK_SELECT).in("project_id", ids).is("archived_at", null)
    : { data: [] };
  return <FavoritesView tasks={(data ?? []) as LiteTask[]} />;
}
