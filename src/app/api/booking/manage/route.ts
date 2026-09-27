import { NextResponse, type NextRequest } from "next/server";

import { BookingError, cancelBooking, setOutcome } from "@/lib/booking/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * POST /api/booking/manage { id, action: "cancel" | "completed" | "no_show" | "confirmed", reason? }
 * Actions du membre depuis l'app. La lecture du rendez-vous passe par la RLS (équipe de l'espace).
 */
export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string; reason?: string };
  if (!body.id || !/^[0-9a-f-]{36}$/.test(body.id)) return NextResponse.json({ error: "Rendez-vous manquant" }, { status: 400 });
  const { data: b } = await sb.from("bookings").select("*").eq("id", body.id).maybeSingle();
  if (!b) return NextResponse.json({ error: "Rendez-vous introuvable" }, { status: 404 });
  const { data: canWrite } = await sb.rpc("can_write", { ws: b.workspace_id });
  if (!canWrite) return NextResponse.json({ error: "Les invités ne peuvent pas modifier les rendez-vous" }, { status: 403 });
  try {
    if (body.action === "cancel") {
      await cancelBooking(b, "host", String(body.reason ?? "").trim().slice(0, 500));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "completed" || body.action === "no_show" || body.action === "confirmed") {
      const r = await setOutcome(b, body.action, auth.user.id);
      return NextResponse.json({ ok: true, movedTo: r.movedTo });
    }
    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[booking] manage", e);
    return NextResponse.json({ error: "Action impossible" }, { status: 500 });
  }
}
