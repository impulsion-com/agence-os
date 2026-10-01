import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { syncAllWorkspaces } from "@/lib/ads/sync";
import { syncAllAnalytics } from "@/lib/analytics/sync";

export const maxDuration = 300;

/**
 * GET /api/cron/sync : synchro quotidienne de tous les espaces (comptes publicitaires, puis
 * propriétés GA4 et projets Clarity : un instantané Clarity par jour, 3 requêtes par projet).
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
  const site = await syncAllAnalytics();
  const all = out.flatMap((w) => w.results);
  const sources = site.flatMap((w) => w.results);
  return NextResponse.json({
    workspaces: new Set([...out, ...site].map((w) => w.workspace_id)).size,
    accounts: all.length,
    ok: all.filter((r) => r.ok).length,
    errors: all.filter((r) => !r.ok).map((r) => ({ account: r.name, error: r.error })),
    analytics: {
      sources: sources.length,
      ok: sources.filter((r) => r.ok && !r.skipped).length,
      skipped: sources.filter((r) => r.skipped).length,
      errors: sources.filter((r) => !r.ok).map((r) => ({ source: r.name, kind: r.kind, error: r.error })),
    },
    ms: Date.now() - started,
  });
}
