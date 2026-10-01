import "server-only";

import { AdsError } from "@/lib/ads/config";
import type { ClarityDimension, ClarityMetricBlock } from "./clarity-rows";

// Connecteur Microsoft Clarity : API « Data Export » (lecture seule, côté serveur).
// Doc : https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
// Limites de l'API (vérifiées le 1er octobre 2026) :
//  - 10 requêtes par projet et par jour ;
//  - agrégats des 1 à 3 derniers jours seulement (numOfDays), sans découpage par jour ;
//  - 3 dimensions au plus par requête, 1 000 lignes au plus, pas de pagination.
// D'où la synchro quotidienne qui stocke un instantané par jour (voir clarity-rows.ts et sync.ts).

export const CLARITY_ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

type Fetch = typeof fetch;

function explain(status: number, body: string): AdsError {
  if (status === 401)
    return new AdsError("Jeton Clarity refusé (mal copié, révoqué ou expiré) : génère un nouveau jeton dans Clarity > Settings > Data Export.", "token");
  if (status === 403) return new AdsError("Ce jeton Clarity n'a pas le droit d'exporter les données du projet : génère-le depuis un compte admin du projet.", "token");
  if (status === 429)
    return new AdsError("Limite Clarity atteinte : 10 requêtes par projet et par jour. La synchronisation reprendra demain, sans perte (les 3 derniers jours restent disponibles).", "quota");
  if (status === 400) return new AdsError("Requête refusée par Clarity (paramètres invalides).", "request");
  return new AdsError(`Clarity : erreur ${status}${body ? ` (${body.slice(0, 120)})` : ""}`);
}

/**
 * Un appel à l'API Data Export. Aucune nouvelle tentative : chaque appel compte dans le quota
 * quotidien du projet, et une limite atteinte ne se lève que le lendemain.
 */
export async function clarityInsights(token: string, numOfDays: 1 | 2 | 3, dimensions: ClarityDimension[], fetchImpl: Fetch = fetch): Promise<ClarityMetricBlock[]> {
  const p = new URLSearchParams({ numOfDays: String(numOfDays) });
  dimensions.slice(0, 3).forEach((d, i) => p.set(`dimension${i + 1}`, d));
  let res: Response;
  try {
    res = await fetchImpl(`${CLARITY_ENDPOINT}?${p}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new AdsError("Clarity est injoignable pour le moment. Réessaie plus tard.", "network");
  }
  const text = await res.text();
  if (!res.ok) throw explain(res.status, text);
  try {
    const json = JSON.parse(text) as unknown;
    return Array.isArray(json) ? (json as ClarityMetricBlock[]) : [];
  } catch {
    throw new AdsError("Réponse Clarity illisible (ce n'est pas du JSON).");
  }
}
