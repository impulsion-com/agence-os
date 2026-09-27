import { NextResponse, type NextRequest } from "next/server";

import { bookingByToken, getSlots, loadPublicProfile } from "@/lib/booking/server";
import { clientIp, rateLimited } from "@/lib/tracking/ingest";

export const dynamic = "force-dynamic";

/**
 * GET /api/booking/slots?u=<slug membre>&t=<slug type>[&reschedule=<jeton>]
 * Créneaux libres (instants UTC) sur tout l'horizon du type.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (rateLimited(`bk-slots|${clientIp(req)}`, 120)) return NextResponse.json({ error: "Trop de requêtes, réessayez dans une minute." }, { status: 429 });
  const pp = await loadPublicProfile(sp.get("u") ?? "");
  const type = pp?.types.find((t) => t.slug === sp.get("t"));
  if (!pp || !type) return NextResponse.json({ error: "Type de rendez-vous introuvable" }, { status: 404 });
  const token = sp.get("reschedule");
  const exclude = token ? await bookingByToken(token) : null;
  const { slots, calendar } = await getSlots(pp, type, { exclude: exclude && exclude.profile_id === pp.id ? exclude : null });
  return NextResponse.json(
    { slots: slots.map((t) => new Date(t).toISOString()), tz: pp.timezone, duration: type.duration_min, calendar },
    { headers: { "Cache-Control": "no-store" } },
  );
}
