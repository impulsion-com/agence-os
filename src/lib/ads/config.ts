import "server-only";

// Versions des API publicitaires (vérifiées le 25 septembre 2026).
// Meta publie une version environ tous les 4 à 6 mois, chacune supportée au moins 2 ans.
// Google Ads publie une version majeure par trimestre, supportée environ 1 an.
export const META_GRAPH_VERSION = "v26.0"; // sortie le 29 juillet 2026
export const GOOGLE_ADS_API_VERSION = "v25"; // sortie le 22 juillet 2026

export const META_SCOPES = ["ads_read", "business_management"];
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/adwords", "openid", "email"];

// Première synchro : 90 jours. Ensuite : 7 jours glissants (fenêtre d'attribution).
export const FIRST_SYNC_DAYS = 90;
export const ROLLING_SYNC_DAYS = 7;

export interface IntegrationStatus {
  meta: { configured: boolean; missing: string[] };
  google: { configured: boolean; missing: string[] };
  appUrl: string | null;
  cron: boolean;
}

const missing = (keys: string[]) => keys.filter((k) => !process.env[k]);

export function integrationStatus(): IntegrationStatus {
  const meta = missing(["META_APP_ID", "META_APP_SECRET"]);
  const google = missing(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"]);
  return {
    meta: { configured: !meta.length, missing: meta },
    google: { configured: !google.length, missing: google },
    appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
    cron: !!process.env.CRON_SECRET,
  };
}

/** URL publique de l'app (callbacks OAuth). Repli sur l'origine de la requête. */
export function appUrl(req?: Request) {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  if (req) return new URL(req.url).origin;
  return "http://localhost:3000";
}

export const redirectUri = (platform: "meta" | "google", req?: Request) => `${appUrl(req)}/api/integrations/${platform}/callback`;

/** Erreur lisible par l'utilisateur (message en français, sans secret). */
export class AdsError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AdsError";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
