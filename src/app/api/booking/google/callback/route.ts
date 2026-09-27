import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { appUrl } from "@/lib/ads/config";
import { NONCE_COOKIE, verifyState } from "@/lib/ads/state";
import { calendarExchangeCode, calendarRedirectUri } from "@/lib/booking/google";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

/** GET /api/booking/google/callback?code=…&state=… : retour de l'écran de consentement Google. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const origin = appUrl(req);
  const jar = await cookies();
  const st = verifyState(sp.get("state"), jar.get(NONCE_COOKIE)?.value);
  const done = (slug: string | null, params: Record<string, string>) => {
    const u = new URL(slug ? `/w/${slug}/booking/settings` : "/", origin);
    u.searchParams.set("tab", "connexions");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = NextResponse.redirect(u);
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/booking/google" });
    return res;
  };
  if (!st) return done(null, { error: "Lien de connexion expiré ou invalide. Relance la connexion." });
  if (sp.get("error")) return done(st.s, { error: "Connexion annulée : l'accès à l'agenda n'a pas été accordé." });

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user || auth.user.id !== st.u) return done(st.s, { error: "Session différente de celle qui a lancé la connexion. Reconnecte-toi puis réessaie." });
  const { data: canWrite } = await sb.rpc("can_write", { ws: st.w });
  if (!canWrite) return done(st.s, { error: "Accès refusé à cet espace." });

  const code = sp.get("code");
  if (!code) return done(st.s, { error: "Code d'autorisation manquant." });
  try {
    const t = await calendarExchangeCode(code, calendarRedirectUri(origin));
    const { error } = await supabaseAdmin()
      .from("booking_google")
      .upsert(
        { workspace_id: st.w, user_id: st.u, email: t.email, refresh_token: t.refresh_token, access_token: t.access_token, expires_at: t.expires_at, last_error: null },
        { onConflict: "workspace_id,user_id" },
      );
    if (error) throw new Error(error.message);
    return done(st.s, { google: "ok" });
  } catch (e) {
    return done(st.s, { error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
}
