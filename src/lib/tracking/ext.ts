import "server-only";

import { NextResponse } from "next/server";

import { AuthError, authenticate, readToken } from "@/lib/mcp/auth";
import type { McpContext } from "@/lib/mcp/types";
import { MODEL_IDS, WINDOWS, type ModelId } from "./attribution";
import { FENETRE_MAXIMALE, NIVEAUX, VERSION_API, cleCompte, lirePeriode, type Niveau } from "./ext-contract";
import { campaignsData, type CampaignsFull, type RawConv } from "./load";
import { readSettings, type SiteSettings } from "./settings";

// =====================================================================
// API /api/ext/v1 : lecture seule, pour l'extension Chrome. Authentifiée par un jeton personnel
// (portée « ext », ou un jeton MCP), exécutée en service role au nom de l'utilisateur du jeton.
// RIEN N'ÉCRIT SOUS /api/ext/ : c'est ce qui rend acceptable une clé qui vit dans un navigateur.
// =====================================================================

export type ExtContext = Omit<McpContext, "cache" | "log">;

const ENTETES = { "X-Api-Version": String(VERSION_API), "Cache-Control": "no-store" };

export function repondre(corps: Record<string, unknown>, entetes: Record<string, string> = {}) {
  return NextResponse.json(corps, { headers: { ...ENTETES, ...entetes } });
}

export function erreur(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, api: VERSION_API, code, message }, { status, headers: ENTETES });
}

export async function garde(request: Request): Promise<{ ok: true; ctx: ExtContext } | { ok: false; reponse: NextResponse }> {
  const token = readToken(request);
  if (!token) return { ok: false, reponse: erreur(401, "cle_absente", "En-tête « Authorization: Bearer aos_… » attendu.") };
  try {
    return { ok: true, ctx: await authenticate(token, request, { ext: true }) };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, reponse: erreur(e.status, /révoqué/.test(e.message) ? "cle_revoquee" : e.status === 403 ? "acces_refuse" : "cle_invalide", e.message) };
    throw e;
  }
}

// ---------------------------------------------------------------------
// Sites et comptes publicitaires de l'espace
// ---------------------------------------------------------------------
export interface ExtSite {
  id: string;
  name: string;
  company_id: string | null;
  domains: string[];
  settings: SiteSettings;
}
export interface ExtAccount {
  id: string;
  platform: string;
  external_id: string;
  name: string;
  currency: string;
  company_id: string | null;
  last_synced_at: string | null;
}

export async function terrain(ctx: ExtContext): Promise<{ sites: ExtSite[]; accounts: ExtAccount[] }> {
  const [s, a] = await Promise.all([
    ctx.db.from("tracking_sites").select("id, name, company_id, domains, settings").eq("workspace_id", ctx.workspace.id).order("created_at"),
    ctx.db.from("ad_accounts").select("id, platform, external_id, name, currency, company_id, last_synced_at").eq("workspace_id", ctx.workspace.id).order("name"),
  ]);
  return { sites: (s.data ?? []).map((x) => ({ ...x, settings: readSettings(x.settings) })), accounts: a.data ?? [] };
}

/** Le site d'un compte publicitaire : celui du même client (ou celui de l'agence, pour un compte sans client). */
export const siteDuCompte = (sites: ExtSite[], account: ExtAccount) => sites.find((s) => s.company_id === account.company_id) ?? null;

/**
 * Site visé par la requête : `site` (identifiant), sinon `compte` (identifiant du compte publicitaire ouvert
 * dans Ads Manager), sinon le seul site de l'espace. Rend une erreur prête à renvoyer quand rien ne tranche.
 */
export function choisirSite(params: URLSearchParams, t: { sites: ExtSite[]; accounts: ExtAccount[] }, strict: boolean): { site: ExtSite } | { reponse: NextResponse } {
  const id = params.get("site");
  if (id) {
    const site = t.sites.find((s) => s.id === id);
    return site ? { site } : { reponse: erreur(404, "site_inconnu", "Ce site suivi n'existe pas dans cet espace.") };
  }
  const compte = params.get("compte");
  if (compte) {
    const plateforme = (params.get("plateforme") || "").toLowerCase();
    const account = t.accounts.find((a) => cleCompte(a.external_id) === cleCompte(compte) && (!plateforme || plateforme === "tout" || plateforme.split(",").includes(a.platform)));
    if (!account) return { reponse: erreur(404, "compte_inconnu", `Le compte publicitaire ${compte} n'est pas connecté à cet espace (Réglages > Connexions).`) };
    const site = siteDuCompte(t.sites, account);
    return site ? { site } : { reponse: erreur(404, "site_absent", `Aucun site suivi n'est rattaché au client du compte ${account.name}. Crée-le dans Attribution.`) };
  }
  if (!t.sites.length) return { reponse: erreur(404, "site_absent", "Aucun site suivi dans cet espace. Crée-le dans Attribution.") };
  if (t.sites.length > 1 && strict) return { reponse: erreur(400, "site_requis", "Plusieurs sites suivis : précise « compte » (identifiant du compte publicitaire) ou « site ».") };
  return { site: t.sites[0] };
}

// ---------------------------------------------------------------------
// Filtres : p, du, au, m, f (clés du contrat)
// ---------------------------------------------------------------------
export function lireFiltres(params: URLSearchParams, site: ExtSite) {
  const m = params.get("m") ?? "";
  const f = Number(params.get("f"));
  const fenetreDemandee = Number.isFinite(f) && f >= 1 ? Math.round(f) : site.settings.window_days;
  return {
    periode: lirePeriode(params.get("p"), params.get("du"), params.get("au")),
    // Un modèle inconnu ici (l'extension garde ceux d'un autre serveur) retombe sur celui du site, et la réponse le dit
    modele: (MODEL_IDS.includes(m as ModelId) ? m : site.settings.model) as ModelId,
    fenetreDemandee,
    fenetreEffective: Math.min(fenetreDemandee, FENETRE_MAXIMALE),
  };
}

export const FENETRES = WINDOWS;

export function lireNiveaux(params: URLSearchParams): Niveau[] | null {
  const brut = (params.get("niveau") || "tout").toLowerCase();
  if (brut === "tout") return NIVEAUX;
  return (NIVEAUX as string[]).includes(brut) ? [brut as Niveau] : null;
}

export const liste = (brut: string | null) => (brut ? brut.split(",").map((v) => v.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------
export async function donnees(ctx: ExtContext, site: ExtSite, f: ReturnType<typeof lireFiltres>): Promise<CampaignsFull> {
  return campaignsData(
    {
      sb: ctx.db,
      // Même requête que les écrans, exécutée au nom de l'utilisateur du jeton (appartenance à l'espace revérifiée en base)
      conversions: async (types) => {
        const { data, error } = await ctx.db.rpc("mcp_tracking_conversions", {
          p_user: ctx.user.id,
          p_ws: ctx.workspace.id,
          p_site: site.id,
          p_start: f.periode.start,
          p_end: f.periode.end,
          p_window: f.fenetreEffective,
          p_types: types,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawConv[];
      },
    },
    site,
    ctx.workspace.id,
    f.periode,
    { model: f.modele, window: f.fenetreEffective },
  );
}

export interface RefEntity {
  niveau: Niveau;
  plateforme: string;
  externalId: string;
  parentExternalId: string | null;
  nom: string;
}

const NIVEAU_REF: Record<string, Niveau> = { campaign: "campagne", adset: "adset", ad: "pub" };

/** Campagnes, ensembles et publicités connus pour les comptes d'un site, toutes dates confondues. */
export async function referentiel(ctx: ExtContext, accounts: ExtAccount[]): Promise<RefEntity[]> {
  if (!accounts.length) return [];
  const platform = new Map(accounts.map((a) => [a.id, a.platform]));
  const { data, error } = await ctx.db.rpc("tracking_ad_referential", { p_accounts: accounts.map((a) => a.id) });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => r.external_id && NIVEAU_REF[r.level])
    .map((r) => ({ niveau: NIVEAU_REF[r.level], plateforme: platform.get(r.ad_account_id) ?? "other", externalId: r.external_id, parentExternalId: r.parent_id || null, nom: r.name || r.external_id }));
}
