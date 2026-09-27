import "server-only";

import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";
import type { McpContext } from "./types";

export const TOKEN_RE = /^aos_[A-Za-z0-9_-]{20,80}$/;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 = 401,
  ) {
    super(message);
  }
}

/** Jeton lu dans l'en-tête Authorization (Bearer), ou passé dans l'URL secrète. */
export function readToken(request: Request, fromPath?: string | null) {
  if (fromPath) return fromPath.trim();
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function appUrl(request: Request) {
  const env = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return env || new URL(request.url).origin;
}

/**
 * Résout le jeton : utilisateur, espace et rôle ACTUEL dans l'espace (revérifié à
 * chaque appel : un membre retiré ou passé invité perd l'accès ou l'écriture aussitôt).
 */
export async function authenticate(token: string | null, request: Request): Promise<Omit<McpContext, "cache" | "log">> {
  if (!token) throw new AuthError("Jeton manquant : ajoute l'en-tête « Authorization: Bearer aos_… ».");
  if (!TOKEN_RE.test(token)) throw new AuthError("Jeton invalide.");
  const db = supabaseAdmin();
  const { data: t } = await db
    .from("api_tokens")
    .select("id, workspace_id, user_id, scope, expires_at, revoked_at, last_used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!t) throw new AuthError("Jeton invalide.");
  if (t.revoked_at) throw new AuthError("Ce jeton a été révoqué.");
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) throw new AuthError("Ce jeton a expiré.");

  const [member, workspace, profile] = await Promise.all([
    db.from("workspace_members").select("role").eq("workspace_id", t.workspace_id).eq("user_id", t.user_id).maybeSingle(),
    db.from("workspaces").select("id, name, slug, currency").eq("id", t.workspace_id).maybeSingle(),
    db.from("profiles").select("full_name, email").eq("id", t.user_id).maybeSingle(),
  ]);
  if (!member.data || !workspace.data) throw new AuthError("Tu ne fais plus partie de cet espace : ce jeton ne donne plus accès.", 403);

  // Dernière utilisation : écrite au plus une fois par minute
  if (!t.last_used_at || Date.now() - new Date(t.last_used_at).getTime() > 60_000) {
    await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
  }

  const role = member.data.role as Role;
  const scope = t.scope === "write" ? "write" : "read";
  return {
    db,
    user: { id: t.user_id, name: profile.data?.full_name || profile.data?.email || "", email: profile.data?.email ?? "" },
    workspace: { id: workspace.data.id, name: workspace.data.name, slug: workspace.data.slug, currency: workspace.data.currency || "EUR" },
    role,
    scope,
    canWrite: scope === "write" && role !== "guest",
    tokenId: t.id,
    appUrl: appUrl(request),
  };
}
