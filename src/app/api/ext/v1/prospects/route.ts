import type { NextRequest } from "next/server";

import { VERSION_API, creditesDe, estNiveau } from "@/lib/tracking/ext-contract";
import { choisirSite, donnees, erreur, garde, lireFiltres, referentiel, repondre, terrain } from "@/lib/tracking/ext";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Au-delà, la liste ne se lit plus dans un panneau : ce travail appartient à l'onglet Visiteurs identifiés. */
const PLAFOND = 30;

/** Qui se cache derrière une ligne : les personnes créditées à une campagne, un ensemble ou une publicité. */
export async function GET(request: NextRequest) {
  const acces = await garde(request);
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const params = request.nextUrl.searchParams;
  const plateforme = (params.get("plateforme") || "").toLowerCase();
  const niveau = (params.get("niveau") || "").toLowerCase();
  const externalId = params.get("id") || params.get("externalId") || "";
  if (!plateforme || !externalId || !estNiveau(niveau)) return erreur(400, "parametres_manquants", "« plateforme », « niveau » (campagne, adset ou pub) et « id » sont obligatoires.");

  const t = await terrain(ctx);
  const choix = choisirSite(params, t, true);
  if ("reponse" in choix) return choix.reponse;
  const { site } = choix;
  const filtres = lireFiltres(params, site);

  const debut = Date.now();
  const comptes = t.accounts.filter((a) => a.company_id === site.company_id && a.platform === plateforme);
  const [d, ref] = await Promise.all([donnees(ctx, site, filtres), referentiel(ctx, comptes)]);
  const liste = creditesDe(d.convs, d.stages, filtres.modele, filtres.fenetreEffective, niveau, externalId);
  const connue = ref.find((r) => r.niveau === niveau && r.externalId === externalId);
  if (!connue && !liste.length) return erreur(404, "entite_inconnue", `Aucune ${niveau} ${externalId} connue sur ${plateforme} pour ce site. La synchronisation du reporting est peut-être en retard.`);

  // Les noms, en une requête : jamais une par personne
  const montrees = liste.slice(0, PLAFOND);
  const uuids = montrees.map((p) => p.personne).filter((p) => /^[0-9a-f-]{36}$/.test(p));
  const noms = new Map<string, string>();
  if (uuids.length) {
    const { data } = await ctx.db.from("visitors").select("person_id, name").eq("site_id", site.id).in("person_id", uuids).not("name", "is", null);
    for (const v of data ?? []) if (v.person_id && v.name) noms.set(v.person_id, v.name);
  }
  const base = `${ctx.appUrl}/w/${ctx.workspace.slug}/tracking/${site.id}`;

  return repondre(
    {
      ok: true,
      api: VERSION_API,
      entite: { plateforme, niveau, externalId, nom: connue?.nom ?? externalId },
      periode: { debut: filtres.periode.start, fin: filtres.periode.end, label: filtres.periode.label },
      modele: filtres.modele,
      fenetreDemandee: filtres.fenetreDemandee,
      prospects: montrees.map((p) => ({
        clientId: p.personne,
        nom: noms.get(p.personne) || d.emails[p.personne] || "Visiteur anonyme",
        etape: p.etape,
        credit: p.credit,
        jour: p.jour,
        lien: uuids.includes(p.personne) ? `${base}?tab=people&person=${p.personne}` : `${base}?tab=people`,
      })),
      caches: Math.max(0, liste.length - PLAFOND),
      lienListe: `${base}?tab=people`,
    },
    { "X-Temps-Calcul": String(Date.now() - debut), "X-Cache": "frais" },
  );
}
