import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { supabaseServer } from "@/lib/supabase/server";
import { companyCookie, pickPortal } from "./nav";
import type { PortalContext, PortalFeature, PortalInfo } from "./types";

/**
 * Contexte du portail d'un espace pour l'utilisateur connecté (une fois par requête : layout et page
 * partagent le résultat). Tout vient de la RPC portal_context, appelée avec la session de l'utilisateur :
 * null si ce compte n'a aucun portail dans cet espace (ou si l'espace n'existe pas).
 */
export const loadPortalContext = cache(async (slug: string) => {
  const sb = await supabaseServer();
  const [{ data }, jar] = await Promise.all([sb.rpc("portal_context", { p_slug: slug }), cookies()]);
  return { sb, ctx: (data as unknown as PortalContext | null) ?? null, cookie: jar.get(companyCookie(slug))?.value ?? null };
});

export interface PortalPage {
  sb: Awaited<ReturnType<typeof supabaseServer>>;
  ctx: PortalContext;
  portal: PortalInfo;
}

/**
 * Entreprise courante d'une page du portail : ?company=<id>, sinon le cookie, sinon la première.
 * Renvoie null si l'utilisateur n'a pas de portail ici (le layout affiche alors « Accès indisponible »).
 */
export async function resolvePortal(slug: string, sp: { company?: string | string[] }): Promise<PortalPage | null> {
  const { sb, ctx, cookie } = await loadPortalContext(slug);
  if (!ctx) return null;
  const portal = pickPortal(ctx, typeof sp.company === "string" ? sp.company : null, cookie);
  return portal ? { sb, ctx, portal } : null;
}

export const hasFeature = (p: PortalInfo, ...features: PortalFeature[]) => features.some((f) => p.features.includes(f));
