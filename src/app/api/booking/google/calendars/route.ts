import { NextResponse, type NextRequest } from "next/server";

import { CalendarError, getConnection, listCalendars } from "@/lib/booking/google";
import { supabaseServer } from "@/lib/supabase/server";

/** GET /api/booking/google/calendars?ws=<id> : agendas du compte Google connecté par le membre. */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("ws") ?? "";
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  const { data: canWrite } = await sb.rpc("can_write", { ws });
  if (!canWrite) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const conn = await getConnection(ws, auth.user.id);
  if (!conn) return NextResponse.json({ error: "Aucun agenda connecté" }, { status: 404 });
  try {
    return NextResponse.json({ email: conn.email, calendars: await listCalendars(conn) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur Google", revoked: e instanceof CalendarError && e.revoked }, { status: 502 });
  }
}
