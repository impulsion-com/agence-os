import { NextResponse, type NextRequest } from "next/server";

import { appUrl } from "@/lib/ads/config";
import { NONCE_COOKIE, createState } from "@/lib/ads/state";
import { calendarAuthUrl, calendarRedirectUri, googleConfigured } from "@/lib/booking/google";
import { supabaseServer } from "@/lib/supabase/server";

/** GET /api/booking/google/start?ws=<slug> : connexion de l'agenda Google du membre connecté. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("ws") ?? "";
  const origin = appUrl(req);
  const back = (params: Record<string, string>) => {
    const u = new URL(slug ? `/w/${slug}/booking/settings` : "/", origin);
    u.searchParams.set("tab", "connexions");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return NextResponse.redirect(u);
  };
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=/w/${slug}/booking/settings`, origin));
  if (!googleConfigured()) return back({ error: "Configuration serveur incomplète : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont requis." });

  const { data: ws } = await sb.from("workspaces").select("id, slug").eq("slug", slug).maybeSingle();
  if (!ws) return back({ error: "Espace introuvable" });
  // Crée la page de réservation au besoin ; null pour un invité
  const { data: profile } = await sb.rpc("booking_my_profile", { ws: ws.id });
  if (!profile) return back({ error: "Les invités ne peuvent pas connecter d'agenda." });

  const { state, nonce } = createState({ w: ws.id, s: ws.slug, u: auth.user.id, p: "google" });
  const res = NextResponse.redirect(calendarAuthUrl(calendarRedirectUri(origin), state, auth.user.email ?? undefined));
  res.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/booking/google", maxAge: 600 });
  return res;
}
