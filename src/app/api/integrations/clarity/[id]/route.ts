import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/ads/guard";
import { clarityTokenInfo } from "@/lib/analytics/clarity-rows";
import { supabaseAdmin } from "@/lib/supabase/server";

const Body = z.object({ token: z.string().min(20).max(4000) });

/**
 * PATCH /api/integrations/clarity/<id> : remplace le jeton API d'un projet (admins de l'espace).
 * Aucune requête n'est envoyée à Clarity : le nouveau jeton servira à la prochaine synchro.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/integrations/clarity/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Projet invalide" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: src } = await admin.from("analytics_sources").select("id, workspace_id, kind, settings, is_demo").eq("id", id).maybeSingle();
  if (!src || src.kind !== "clarity" || src.is_demo) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const g = await guard({ id: src.workspace_id }, "admin");
  if (g instanceof NextResponse) return g;

  const token = parsed.data.token.trim();
  const info = clarityTokenInfo(token);
  if (!info.ok) return NextResponse.json({ error: info.error }, { status: 400 });
  const up = await admin.from("analytics_secrets").upsert({ source_id: src.id, workspace_id: src.workspace_id, token, updated_at: new Date().toISOString() });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const settings = { ...(src.settings && typeof src.settings === "object" && !Array.isArray(src.settings) ? src.settings : {}), token_exp: info.exp };
  await admin.from("analytics_sources").update({ settings, sync_error: null }).eq("id", src.id);
  return NextResponse.json({ ok: true });
}
