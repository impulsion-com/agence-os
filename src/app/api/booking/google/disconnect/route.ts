import { NextResponse, type NextRequest } from "next/server";

import { revoke } from "@/lib/booking/google";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

/** POST /api/booking/google/disconnect { ws } : déconnecte l'agenda Google du membre connecté. */
export async function POST(req: NextRequest) {
  const { ws } = (await req.json().catch(() => ({}))) as { ws?: string };
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  const { data: member } = await sb.rpc("is_member", { ws: ws ?? "" });
  if (!member) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const admin = supabaseAdmin();
  const { data } = await admin.from("booking_google").delete().eq("workspace_id", ws!).eq("user_id", auth.user.id).select("refresh_token").maybeSingle();
  if (data?.refresh_token) await revoke(data.refresh_token);
  return NextResponse.json({ ok: true });
}
