import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/ads/guard";
import { syncWorkspace } from "@/lib/ads/sync";

export const maxDuration = 300;

const Body = z.object({
  workspace_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  full: z.boolean().optional(), // resynchronise 90 jours
});

/** POST /api/reporting/sync : synchro manuelle d'un compte ou de tout l'espace. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const g = await guard({ id: parsed.data.workspace_id }, "write");
  if (g instanceof NextResponse) return g;
  try {
    const results = await syncWorkspace(g.workspace.id, { accountId: parsed.data.account_id, full: parsed.data.full });
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
