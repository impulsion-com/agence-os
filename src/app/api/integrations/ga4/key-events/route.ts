import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/ads/guard";
import { accessTokenFor } from "@/lib/ads/sync";
import { ga4KeyEvents } from "@/lib/analytics/ga4";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * GET /api/integrations/ga4/key-events?source=<id> : évènements clés d'une propriété suivie,
 * pour choisir la conversion principale. Membres non invités de l'espace de la source.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("source") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Source invalide" }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: src } = await admin.from("analytics_sources").select("id, workspace_id, kind, connection_id, external_id").eq("id", id).maybeSingle();
  if (!src || src.kind !== "ga4") return NextResponse.json({ error: "Propriété introuvable" }, { status: 404 });
  const g = await guard({ id: src.workspace_id }, "write");
  if (g instanceof NextResponse) return g;
  if (!src.connection_id) return NextResponse.json({ error: "Cette propriété n'est plus reliée à une connexion Google Analytics." }, { status: 409 });
  const { data: conn } = await admin
    .from("ad_connections")
    .select("id, workspace_id, platform, access_token, refresh_token, expires_at")
    .eq("id", src.connection_id)
    .eq("workspace_id", src.workspace_id)
    .eq("platform", "ga4")
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "Connexion Google Analytics introuvable" }, { status: 404 });
  try {
    const events = await ga4KeyEvents(await accessTokenFor(conn), src.external_id);
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
