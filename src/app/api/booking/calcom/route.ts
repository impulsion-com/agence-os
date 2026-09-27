import { NextResponse, type NextRequest } from "next/server";

import { handleCalEvent, verifySignature, type CalEvent } from "@/lib/booking/calcom";
import { BookingError } from "@/lib/booking/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readBody } from "@/lib/tracking/cors";

export const maxDuration = 30;

/**
 * POST /api/booking/calcom?ws=<workspace id> : webhook Cal.com
 * (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED, MEETING_ENDED).
 */
export async function POST(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("ws") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(ws)) return NextResponse.json({ error: "Paramètre ws manquant" }, { status: 400 });
  const raw = await readBody(req, 256_000);
  if (raw === null) return NextResponse.json({ error: "Corps trop volumineux" }, { status: 413 });

  const admin = supabaseAdmin();
  const { data: settings } = await admin.from("booking_settings").select("calcom_secret, calcom_user_id").eq("workspace_id", ws).maybeSingle();
  if (!settings) return NextResponse.json({ error: "Connecteur Cal.com non configuré pour cet espace" }, { status: 404 });
  if (!verifySignature(raw, req.headers.get("x-cal-signature-256"), settings.calcom_secret))
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });

  let ev: CalEvent;
  try {
    ev = JSON.parse(raw) as CalEvent;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  try {
    const res = await handleCalEvent(ws, settings.calcom_user_id, ev);
    await admin.from("booking_settings").update({ calcom_last_at: new Date().toISOString() }).eq("workspace_id", ws);
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[booking] calcom", e);
    return NextResponse.json({ error: "Traitement impossible" }, { status: 500 });
  }
}
