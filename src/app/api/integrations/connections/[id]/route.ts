import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/ads/guard";
import { refreshConnectionAccounts } from "@/lib/ads/sync";
import { supabaseAdmin } from "@/lib/supabase/server";

async function load(id: string) {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("ad_connections")
    .select("id, workspace_id, platform, access_token, refresh_token, expires_at")
    .eq("id", id)
    .maybeSingle();
  return { admin, conn: data };
}

/** Actualise la liste des comptes accessibles (membres non invités). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/integrations/connections/[id]">) {
  const { id } = await ctx.params;
  const { admin, conn } = await load(id);
  if (!conn) return NextResponse.json({ error: "Connexion introuvable" }, { status: 404 });
  const g = await guard({ id: conn.workspace_id }, "write");
  if (g instanceof NextResponse) return g;
  try {
    const accounts = await refreshConnectionAccounts(admin, conn);
    return NextResponse.json({ accounts: accounts.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Déconnecte : supprime la connexion (et ses jetons). Les comptes et l'historique restent. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/integrations/connections/[id]">) {
  const { id } = await ctx.params;
  const { admin, conn } = await load(id);
  if (!conn) return NextResponse.json({ error: "Connexion introuvable" }, { status: 404 });
  const g = await guard({ id: conn.workspace_id }, "admin");
  if (g instanceof NextResponse) return g;
  // connection_id passe à null (on delete set null) : l'historique des métriques est conservé
  const { error } = await admin.from("ad_connections").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
