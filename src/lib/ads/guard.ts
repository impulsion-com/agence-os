import "server-only";

import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

export type Level = "write" | "admin";

export interface Guarded {
  userId: string;
  workspace: { id: string; slug: string; name: string };
  role: string;
}

/**
 * Vérifie que l'utilisateur connecté est membre de l'espace (par id ou slug)
 * avec le niveau demandé : « write » = membre non invité, « admin » = admin ou propriétaire.
 */
export async function guard(ref: { id?: string | null; slug?: string | null }, level: Level): Promise<Guarded | NextResponse> {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  if (!ref.id && !ref.slug) return NextResponse.json({ error: "Espace manquant" }, { status: 400 });
  let q = sb.from("workspaces").select("id, slug, name");
  q = ref.id ? q.eq("id", ref.id) : q.eq("slug", ref.slug!);
  const { data: ws } = await q.maybeSingle();
  if (!ws) return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
  const { data: m } = await sb.from("workspace_members").select("role").eq("workspace_id", ws.id).eq("user_id", auth.user.id).maybeSingle();
  const role = m?.role;
  const ok = level === "admin" ? role === "owner" || role === "admin" : role === "owner" || role === "admin" || role === "member";
  if (!ok)
    return NextResponse.json(
      { error: level === "admin" ? "Réservé aux admins de l'espace" : "Les invités ne peuvent pas lancer de synchronisation" },
      { status: 403 },
    );
  return { userId: auth.user.id, workspace: ws, role: role! };
}
