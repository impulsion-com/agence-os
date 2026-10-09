import type { NextRequest } from "next/server";

import { VERSION_API, aplatir, cleEntite, entreeSansActivite, mesures, type Entree } from "@/lib/tracking/ext-contract";
import { choisirSite, donnees, erreur, garde, lireFiltres, lireNiveaux, liste, referentiel, repondre, terrain } from "@/lib/tracking/ext";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Au-delà, la réponse ne se lit plus, elle se filtre : l'extension sait quelles lignes sont à l'écran et passe `ids`. */
const LIMITE_ENTITES = 2000;
const MAX_IDS = 500;

/**
 * Les colonnes du tracking, indexées par l'identifiant natif de la régie (`plateforme:niveau:externalId`).
 * Paramètres : niveau, plateforme, ids, compte ou site, et les filtres p, du, au, m, f.
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
  const ids = liste(params.get("ids"));
  if (ids.length > MAX_IDS) return erreur(400, "trop_d_identifiants", `« ids » accepte au plus ${MAX_IDS} valeurs, ${ids.length} reçues.`);

  const t = await terrain(ctx);
  const choix = choisirSite(params, t, true);
  if ("reponse" in choix) return choix.reponse;
  const { site } = choix;
  const filtres = lireFiltres(params, site);

  const debut = Date.now();
  const comptes = t.accounts.filter((a) => a.company_id === site.company_id);
  const [d, ref] = await Promise.all([donnees(ctx, site, filtres), referentiel(ctx, comptes)]);
  const devise = ctx.workspace.currency;
  const toutes = aplatir(d.table, d.stages, niveaux, plateformes, devise);

  // Le contrat promet qu'une entité CONNUE sans activité sur la période apparaît avec des zéros : c'est ce
  // qui distingue « 0 vente » de « pas synchronisée ». Le tableau ne porte que ce qui a dépensé ou converti.
  const connues = ref.filter((r) => niveaux.includes(r.niveau) && (!plateformes.length || plateformes.includes(r.plateforme)));
  let entites: Record<string, Entree> = {};
  const introuvables: string[] = [];
  if (ids.length) {
    const voulus = new Set(ids);
    for (const [cle, e] of Object.entries(toutes)) if (voulus.has(e.externalId)) entites[cle] = e;
    const vus = new Set(Object.values(entites).map((e) => e.externalId));
    for (const r of connues) {
      if (!voulus.has(r.externalId) || vus.has(r.externalId)) continue;
      entites[cleEntite(r.plateforme, r.niveau, r.externalId)] = entreeSansActivite(r.plateforme, r.niveau, r.externalId, r.parentExternalId, r.nom, d.stages, devise);
      vus.add(r.externalId);
    }
    for (const id of ids) if (!vus.has(id)) introuvables.push(id);
  } else {
    entites = toutes;
    for (const r of connues) {
      const cle = cleEntite(r.plateforme, r.niveau, r.externalId);
      if (!(cle in entites)) entites[cle] = entreeSansActivite(r.plateforme, r.niveau, r.externalId, r.parentExternalId, r.nom, d.stages, devise);
    }
  }

  // Troncature explicite : une réponse amputée en silence se lirait comme un compte qui n'a que 2 000 publicités
  const totalArbre = Object.keys(entites).length;
  let tronque = false;
  if (!ids.length && totalArbre > LIMITE_ENTITES) {
    entites = Object.fromEntries(Object.entries(entites).sort((a, b) => (b[1].m.depense ?? 0) - (a[1].m.depense ?? 0)).slice(0, LIMITE_ENTITES));
    tronque = true;
  }

  const { total, organic } = d.table;
  const pub = { stages: Object.fromEntries(d.stages.map((s) => [s.key, (total.stages[s.key] ?? 0) - (organic.stages[s.key] ?? 0)])), value: total.value - organic.value, spend: d.accounts ? total.spend : null };
  return repondre(
    {
      ok: true,
      api: VERSION_API,
      site: { id: site.id, nom: site.name },
      periode: { debut: filtres.periode.start, fin: filtres.periode.end, jours: Math.round((Date.parse(filtres.periode.end) - Date.parse(filtres.periode.start)) / 864e5) + 1, label: filtres.periode.label },
      modele: filtres.modele,
      // La fenêtre demandée ET la fenêtre effective : au-delà de 90 jours la lecture resserre, et l'extension affiche l'effective
      fenetreDemandee: filtres.fenetreDemandee,
      fenetreEffective: filtres.fenetreEffective,
      devise,
      entites,
      /** Ce que la publicité a produit, toutes lignes confondues. */
      totaux: mesures(pub, d.stages),
      /** Toutes les conversions du site sur la période, quelle que soit leur source. */
      totalCompte: mesures({ stages: total.stages, value: total.value, spend: null }, d.stages),
      /** Ce qui revient à un canal non payant ou à aucun point de contact. */
      nonRattachee: mesures({ ...organic, spend: null }, d.stages),
      compteur: { totalArbre, rendu: Object.keys(entites).length, tronque, limite: LIMITE_ENTITES, introuvables },
    },
    { "X-Temps-Calcul": String(Date.now() - debut), "X-Cache": "frais" },
  );
}
