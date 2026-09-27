import type { NextRequest } from "next/server";

import { bookingByToken, icsFor, loadPublicProfile } from "@/lib/booking/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/** GET /api/booking/ics?token=… : invitation .ics (bouton « Ajouter à mon agenda »). */
export async function GET(req: NextRequest) {
  const b = await bookingByToken(req.nextUrl.searchParams.get("token") ?? "");
  if (!b || !b.profile_id) return new Response("Rendez-vous introuvable", { status: 404 });
  const { data: p } = await supabaseAdmin().from("booking_profiles").select("slug").eq("id", b.profile_id).maybeSingle();
  const pp = p ? await loadPublicProfile(p.slug, true) : null;
  const typeName = pp?.types.find((t) => t.id === b.type_id)?.name ?? b.title;
  const ics = icsFor(b, { host: pp?.host ?? { name: "", email: "", color: "", title: "" } }, typeName, b.status === "cancelled");
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="rendez-vous.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
