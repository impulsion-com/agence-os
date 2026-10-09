import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { supabaseServer } from "@/lib/supabase/server";
import { ConversionSchema, recordConversion, siteById } from "@/lib/tracking/ingest";

export const maxDuration = 60;

const Body = z.object({ site_id: z.uuid(), rows: z.array(z.unknown()).min(1).max(100) });

/**
 * POST /api/tracking/import : conversions hors ligne lues dans un CSV par le navigateur, envoyées par paquets de 100.
 * Réservé aux membres qui peuvent modifier l'espace. Idempotent par (type, order_id), comme l'API serveur.
 */
export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  const sb = await supabaseServer();
  // La RLS ne rend le site qu'à un membre de son espace
  const { data: mine } = await sb.from("tracking_sites").select("id, workspace_id").eq("id", body.data.site_id).maybeSingle();
  if (!mine) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  const { data: canWrite } = await sb.rpc("can_write", { ws: mine.workspace_id });
  if (!canWrite) return NextResponse.json({ error: "Tu n'as pas les droits pour importer dans cet espace" }, { status: 403 });
  const site = await siteById(mine.id);
  if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });

  let created = 0;
  let duplicates = 0;
  const errors: { row: number; error: string }[] = [];
  for (const [i, raw] of body.data.rows.entries()) {
    const parsed = ConversionSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row: i, error: parsed.error.issues[0]?.message ?? "ligne invalide" });
      continue;
    }
    const res = await recordConversion(site, parsed.data, "import");
    if (!res.ok) errors.push({ row: i, error: res.error });
    else if (res.duplicate) duplicates++;
    else created++;
  }
  return NextResponse.json({ created, duplicates, errors });
}
