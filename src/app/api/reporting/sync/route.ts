import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/ads/guard";
import { syncWorkspace } from "@/lib/ads/sync";
import type { SyncResult } from "@/lib/ads/types";
import { syncAnalytics } from "@/lib/analytics/sync";
import type { AnalyticsSyncResult } from "@/lib/analytics/types";

export const maxDuration = 300;

const Body = z.object({
  workspace_id: z.string().uuid(),
  account_id: z.string().uuid().optional(), // un seul compte publicitaire
  source_id: z.string().uuid().optional(), // une seule source d'analytics (propriété GA4, projet Clarity)
  full: z.boolean().optional(), // resynchronise 90 jours
});

/**
 * POST /api/reporting/sync : synchro manuelle d'un compte, d'une source d'analytics ou de tout
 * l'espace (comptes publicitaires, propriétés GA4 et projets Clarity).
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const g = await guard({ id: parsed.data.workspace_id }, "write");
  if (g instanceof NextResponse) return g;
  try {
    const { account_id, source_id, full } = parsed.data;
    const results: (SyncResult | AnalyticsSyncResult)[] = [];
    if (!source_id) results.push(...(await syncWorkspace(g.workspace.id, { accountId: account_id, full })));
    if (!account_id) results.push(...(await syncAnalytics(g.workspace.id, { sourceId: source_id, full })));
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
