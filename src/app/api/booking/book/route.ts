import { NextResponse, type NextRequest } from "next/server";

import { BookSchema, BookingError, book } from "@/lib/booking/server";
import { clientIp, rateLimited } from "@/lib/tracking/ingest";

/** POST /api/booking/book : réserve (ou déplace, avec `reschedule`) un créneau. */
export async function POST(req: NextRequest) {
  if (rateLimited(`bk-book|${clientIp(req)}`, 12)) return NextResponse.json({ error: "Trop de tentatives, réessayez dans une minute." }, { status: 429 });
  const raw = await req.json().catch(() => null);
  const parsed = BookSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first?.message && !/^(Invalid|Too)/.test(first.message) ? first.message : "Formulaire incomplet ou invalide." }, { status: 400 });
  }
  try {
    const b = await book(parsed.data);
    return NextResponse.json({ ok: true, token: b.token, start: b.start_at, end: b.end_at, meet: b.meet_url || null, rescheduled: !!parsed.data.reschedule });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[booking] book", e);
    return NextResponse.json({ error: "La réservation a échoué, merci de réessayer." }, { status: 500 });
  }
}
