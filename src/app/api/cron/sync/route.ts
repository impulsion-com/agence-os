import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { syncAllWorkspaces } from "@/lib/ads/sync";

export const maxDuration = 300;

/**
 * GET /api/cron/sync : synchro quotidienne de tous les espaces.
 * Vercel Cron envoie automatiquement « Authorization: Bearer <CRON_SECRET> ».
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const started = Date.now();
  const out = await syncAllWorkspaces();
  const all = out.flatMap((w) => w.results);
  return NextResponse.json({
    workspaces: out.length,
    accounts: all.length,
    ok: all.filter((r) => r.ok).length,
    errors: all.filter((r) => !r.ok).map((r) => ({ account: r.name, error: r.error })),
    ms: Date.now() - started,
  });
}
