import { NextResponse, type NextRequest } from "next/server";

import { BookingError, bookingByToken, cancelBooking } from "@/lib/booking/server";
import { clientIp, rateLimited } from "@/lib/tracking/ingest";

/** POST /api/booking/cancel { token, reason } : annulation par le prospect (lien de l'email). */
export async function POST(req: NextRequest) {
  if (rateLimited(`bk-cancel|${clientIp(req)}`, 10)) return NextResponse.json({ error: "Trop de tentatives, réessayez dans une minute." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { token?: string; reason?: string };
  const b = await bookingByToken(String(body.token ?? ""));
  if (!b) return NextResponse.json({ error: "Rendez-vous introuvable" }, { status: 404 });
  if (Date.parse(b.end_at) < Date.now()) return NextResponse.json({ error: "Ce rendez-vous est déjà passé." }, { status: 409 });
  try {
    await cancelBooking(b, "guest", String(body.reason ?? "").trim().slice(0, 500));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[booking] cancel", e);
    return NextResponse.json({ error: "L'annulation a échoué, merci de réessayer." }, { status: 500 });
  }
}
