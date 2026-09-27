import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { sendReminders } from "@/lib/booking/server";

export const maxDuration = 60;

/**
 * GET /api/cron/booking-reminders : rappels par email 24 h et 1 h avant chaque rendez-vous.
 * À appeler toutes les 15 minutes avec « Authorization: Bearer <CRON_SECRET> ».
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const started = Date.now();
  const out = await sendReminders();
  return NextResponse.json({ ...out, ms: Date.now() - started });
}
