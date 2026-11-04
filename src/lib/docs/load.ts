import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { NODE_COLS, PAGE_COLS, type DocNode, type DocPage, type DocSpace, type DocTrashItem } from "./types";

/** L'arbre complet (espaces et pages hors corbeille), sans le contenu des pages. */
export async function loadDocsTree(workspaceId: string): Promise<{ spaces: DocSpace[]; pages: DocNode[] }> {
  const sb = await supabaseServer();
  const [spaces, pages] = await Promise.all([
    sb.from("doc_spaces").select("id, name, icon, description, position").eq("workspace_id", workspaceId).order("position").order("created_at"),
    sb.from("doc_pages").select(NODE_COLS).eq("workspace_id", workspaceId).is("deleted_at", null).order("position").order("created_at"),
  ]);
  return { spaces: spaces.data ?? [], pages: pages.data ?? [] };
}

export async function loadDocPage(workspaceId: string, id: string): Promise<DocPage | null> {
  const sb = await supabaseServer();
  const [{ data: page }, { data: last }] = await Promise.all([
    sb.from("doc_pages").select(PAGE_COLS).eq("workspace_id", workspaceId).eq("id", id).maybeSingle(),
    sb.from("doc_versions").select("updated_at").eq("page_id", id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return page ? { ...page, version_at: last?.updated_at ?? null } : null;
}

/** Corbeille : seules les pages supprimées pour elles-mêmes, pas les sous-pages parties avec elles. */
export async function loadDocsTrash(workspaceId: string): Promise<DocTrashItem[]> {
  const sb = await supabaseServer();
  const { data } = await sb
    .from("doc_pages")
    .select("id, space_id, parent_id, title, icon, deleted_at")
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  const rows = (data ?? []) as DocTrashItem[];
  const at = new Map(rows.map((r) => [r.id, r.deleted_at]));
  return rows.filter((r) => !r.parent_id || at.get(r.parent_id) !== r.deleted_at);
}
