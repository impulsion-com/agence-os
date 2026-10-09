import type { NextRequest } from "next/server";

import { VERSION_API } from "@/lib/tracking/ext-contract";
import { choisirSite, erreur, garde, lireNiveaux, liste, referentiel, repondre, terrain } from "@/lib/tracking/ext";

export const dynamic = "force-dynamic";

/**
 * Le référentiel nu, pour le rapprochement par nom de dernier recours côté extension. Une liste et non un
 * dictionnaire par nom : un nom porté par plusieurs entités doit laisser la ligne « non identifiée ».
 */
export async function GET(request: NextRequest) {
  const acces = await garde(request);
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const params = request.nextUrl.searchParams;
  const niveaux = lireNiveaux(params);
  if (!niveaux) return erreur(400, "niveau_inconnu", `« niveau » attend campagne, adset, pub ou tout. Reçu : ${params.get("niveau")}.`);
  const plateformeBrut = (params.get("plateforme") || "tout").toLowerCase();
  const plateformes = plateformeBrut === "tout" ? [] : liste(plateformeBrut);

  const t = await terrain(ctx);
  const choix = choisirSite(params, t, true);
  if ("reponse" in choix) return choix.reponse;
  const debut = Date.now();
  const comptes = t.accounts.filter((a) => a.company_id === choix.site.company_id);
  const entites = (await referentiel(ctx, comptes)).filter((e) => niveaux.includes(e.niveau) && (!plateformes.length || plateformes.includes(e.plateforme)));

  const compte = new Map<string, number>();
  for (const e of entites) {
    const cle = `${e.plateforme}:${e.niveau}:${e.nom.trim().toLowerCase()}`;
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  const ambigus = [...compte.entries()].filter(([, n]) => n > 1).map(([cle]) => cle);

  return repondre({ ok: true, api: VERSION_API, entites, compteur: { total: entites.length, nomsAmbigus: ambigus.length }, nomsAmbigus: ambigus }, { "X-Temps-Calcul": String(Date.now() - debut) });
}
