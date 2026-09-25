import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { AdsError, appUrl, integrationStatus, redirectUri } from "./config";
import { googleAuthUrl, googleExchangeCode } from "./google";
import { guard } from "./guard";
import { metaAuthUrl, metaExchangeCode } from "./meta";
import { NONCE_COOKIE, createState, verifyState } from "./state";
import { refreshConnectionAccounts } from "./sync";

type P = "meta" | "google";

const back = (req: NextRequest, slug: string | null, params: Record<string, string>) => {
  const url = new URL(slug ? `/w/${slug}/settings/integrations` : "/", appUrl(req));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
};

/** GET /api/integrations/<p>/start?ws=<slug> */
export async function oauthStart(req: NextRequest, platform: P) {
  const slug = req.nextUrl.searchParams.get("ws");
  const g = await guard({ slug }, "admin");
  if (g instanceof NextResponse) {
    if (g.status === 401) return NextResponse.redirect(new URL(`/login?next=/w/${slug ?? ""}/settings/integrations`, appUrl(req)));
    return NextResponse.redirect(back(req, slug, { error: "Seuls les admins de l'espace peuvent connecter une plateforme." }));
  }
  const status = integrationStatus()[platform];
  if (!status.configured)
    return NextResponse.redirect(back(req, g.workspace.slug, { error: `Configuration serveur incomplète : ${status.missing.join(", ")}` }));

  const { state, nonce } = createState({ w: g.workspace.id, s: g.workspace.slug, u: g.userId, p: platform });
  const target = platform === "meta" ? metaAuthUrl(redirectUri("meta", req), state) : googleAuthUrl(redirectUri("google", req), state);
  const res = NextResponse.redirect(target);
  res.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/integrations", maxAge: 600 });
  return res;
}

/** GET /api/integrations/<p>/callback?code=…&state=… */
export async function oauthCallback(req: NextRequest, platform: P) {
  const sp = req.nextUrl.searchParams;
  const jar = await cookies();
  const st = verifyState(sp.get("state"), jar.get(NONCE_COOKIE)?.value);
  const done = (url: URL) => {
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/integrations" });
    return res;
  };
  if (!st || st.p !== platform) return done(back(req, st?.s ?? null, { error: "Lien de connexion expiré ou invalide. Relance la connexion." }));

  // Refus de l'utilisateur sur l'écran de consentement
  const denied = sp.get("error") || sp.get("error_reason");
  if (denied) return done(back(req, st.s, { error: "Connexion annulée : l'autorisation n'a pas été accordée." }));

  const g = await guard({ id: st.w }, "admin");
  if (g instanceof NextResponse || g.userId !== st.u)
    return done(back(req, st.s, { error: "Session différente de celle qui a lancé la connexion. Reconnecte-toi puis réessaie." }));

  const code = sp.get("code");
  if (!code) return done(back(req, st.s, { error: "Code d'autorisation manquant." }));

  try {
    const admin = supabaseAdmin();
    const tok =
      platform === "meta"
        ? await metaExchangeCode(code, redirectUri("meta", req)).then((t) => ({ ...t, refresh_token: null as string | null }))
        : await googleExchangeCode(code, redirectUri("google", req)).then((t) => ({ ...t, expires_at: null as string | null }));

    // Reconnexion du même compte utilisateur : on met à jour la connexion existante
    const { data: existing } = tok.user_id
      ? await admin
          .from("ad_connections")
          .select("id")
          .eq("workspace_id", st.w)
          .eq("platform", platform)
          .eq("external_user_id", tok.user_id)
          .maybeSingle()
      : { data: null };
    const values = {
      workspace_id: st.w,
      platform,
      label: tok.label,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: tok.expires_at,
      external_user_id: tok.user_id,
      created_by: st.u,
      last_error: null,
    };
    const saved = existing
      ? await admin.from("ad_connections").update(values).eq("id", existing.id).select("id, workspace_id, platform, access_token, refresh_token, expires_at").single()
      : await admin.from("ad_connections").insert(values).select("id, workspace_id, platform, access_token, refresh_token, expires_at").single();
    if (saved.error) throw new Error(saved.error.message);

    let count = 0;
    try {
      count = (await refreshConnectionAccounts(admin, saved.data, tok.access_token)).length;
    } catch {
      /* l'erreur est enregistrée sur la connexion et affichée dans les réglages */
    }
    // Les comptes déjà suivis qui étaient en erreur de jeton repartent proprement
    if (existing) await admin.from("ad_accounts").update({ sync_error: null }).eq("connection_id", existing.id);
    return done(back(req, st.s, { connected: platform, accounts: String(count) }));
  } catch (e) {
    const msg = e instanceof AdsError || e instanceof Error ? e.message : "Erreur inconnue";
    return done(back(req, st.s, { error: msg }));
  }
}
