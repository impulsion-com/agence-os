import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Paramètre `state` OAuth signé (HMAC-SHA256) : lie l'aller-retour à l'espace,
// à l'utilisateur et au navigateur (nonce aussi posé en cookie httpOnly).

export const NONCE_COOKIE = "aos_oauth_nonce";
const TTL = 10 * 60 * 1000;

export interface OAuthState {
  w: string; // workspace id
  s: string; // slug (redirection de retour)
  u: string; // user id
  p: "meta" | "google";
  n: string; // nonce
  e: number; // expiration (ms)
}

const secret = () => {
  const s = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Aucun secret pour signer l'état OAuth (SUPABASE_SERVICE_ROLE_KEY manquante)");
  return s;
};
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function createState(v: Omit<OAuthState, "n" | "e">) {
  const st: OAuthState = { ...v, n: randomBytes(16).toString("base64url"), e: Date.now() + TTL };
  const data = Buffer.from(JSON.stringify(st)).toString("base64url");
  return { state: `${data}.${sign(data)}`, nonce: st.n };
}

export function verifyState(raw: string | null, nonce: string | undefined): OAuthState | null {
  if (!raw || !nonce) return null;
  const [data, sig] = raw.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const st = JSON.parse(Buffer.from(data, "base64url").toString()) as OAuthState;
    if (st.e < Date.now() || st.n !== nonce) return null;
    return st;
  } catch {
    return null;
  }
}
