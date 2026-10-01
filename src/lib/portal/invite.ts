import "server-only";

import type { ClientInvite } from "@/components/auth/auth-form";
import { supabaseAnon } from "@/lib/supabase/server";

/**
 * Invitation client portée par le paramètre `next` des pages de connexion et d'inscription
 * (/invite/c/<token>) : email attendu, nom et couleur de l'agence. null hors de ce cas.
 */
export async function inviteFromNext(next: string | string[] | undefined): Promise<(ClientInvite & { next: string }) | null> {
  const m = typeof next === "string" ? /^\/invite\/c\/([0-9a-f]{16,64})$/i.exec(next) : null;
  if (!m) return null;
  const { data } = await supabaseAnon().rpc("client_invitation_info", { p_token: m[1] });
  const inv = data as unknown as (ClientInvite & { valid: boolean }) | null;
  if (!inv?.valid || !inv.email) return null;
  return { email: inv.email, workspace: inv.workspace, accent: inv.accent, company: inv.company, next: m[0] };
}
