import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { syncIntelAll } from "@/lib/creatives/intel-server";

export const maxDuration = 300;

/**
 * GET /api/cron/creative-intel : synchro quotidienne de la veille concurrentielle (API Meta Ad Library).
 * Vercel Cron envoie automatiquement « Authorization: Bearer <CRON_SECRET> ».
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const started = Date.now();
  const out = await syncIntelAll();
  return NextResponse.json({
    workspaces: out.length,
    watches_ok: out.reduce((s, w) => s + w.ok, 0),
    tagged: out.reduce((s, w) => s + w.tagged, 0),
    errors: out.filter((w) => w.errors.length).map((w) => ({ workspace: w.workspace_id, errors: w.errors })),
    ms: Date.now() - started,
  });
}
