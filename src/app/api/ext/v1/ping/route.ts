import type { NextRequest } from "next/server";

import { MODELS } from "@/lib/tracking/attribution";
import { FENETRE_MAXIMALE, PERIODES, PERIODE_DEFAUT, PRODUIT, VERSION_API, catalogue } from "@/lib/tracking/ext-contract";
import { FENETRES, choisirSite, garde, referentiel, repondre, siteDuCompte, terrain } from "@/lib/tracking/ext";
import { loadStagesAdmin } from "@/lib/tracking/ext-stages";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = { meta: "Meta Ads", google: "Google Ads" };

/**
 * Valide la clé et annonce le terrain : sites suivis, comptes publicitaires, modèles, périodes, et le
 * catalogue des colonnes du site visé (`?compte=` ou `?site=`, le premier site sinon). Aucun calcul de rapport.
 */
export async function GET(request: NextRequest) {
  const acces = await garde(request);
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const t = await terrain(ctx);
  const choix = choisirSite(request.nextUrl.searchParams, t, false);
  const site = "site" in choix ? choix.site : null;

  // Seuls les comptes rattachés à un site suivi : sur un autre compte, l'extension se tait au lieu d'afficher des zéros
  const suivis = t.accounts.map((a) => ({ a, s: siteDuCompte(t.sites, a) })).filter((x) => x.s);
  const siens = site ? t.accounts.filter((a) => a.company_id === site.company_id) : [];
  const [stages, ref, dernier] = await Promise.all([
    site ? loadStagesAdmin(ctx, site.id) : [],
    referentiel(ctx, siens),
    Promise.all(
      [...new Set(suivis.map((x) => x.a.platform))].map(async (p) => {
        const ids = suivis.filter((x) => x.a.platform === p).map((x) => x.a.id);
        const { data } = await ctx.db.from("ad_metrics_daily").select("date").in("ad_account_id", ids).order("date", { ascending: false }).limit(1).maybeSingle();
        return [p, data?.date ?? null] as const;
      }),
    ),
  ]);
  const dernierJour = new Map(dernier);

  return repondre({
    ok: true,
    api: VERSION_API,
    produit: PRODUIT,
    cle: { nom: ctx.user.name, portees: ["ext"], espace: ctx.workspace.name },

    site: site ? { id: site.id, nom: site.name } : null,
    sites: t.sites.map((s) => ({ id: s.id, nom: s.name, domaines: s.domains, modele: s.settings.model, fenetre: s.settings.window_days })),

    modeles: MODELS.map((m) => ({ cle: m.id, label: m.name, defaut: m.id === (site?.settings.model ?? "last_click") })),
    periodes: PERIODES.map((p) => ({ ...p, defaut: p.cle === PERIODE_DEFAUT })),
    fenetres: FENETRES,
    fenetreDefaut: site?.settings.window_days ?? 30,
    fenetreMaximale: FENETRE_MAXIMALE,

    plateformes: [...new Set(suivis.map((x) => x.a.platform))].map((cle) => {
      const acc = suivis.filter((x) => x.a.platform === cle).map((x) => x.a);
      const synchros = acc.map((a) => a.last_synced_at).filter((d): d is string => !!d).sort();
      return { cle, label: LABELS[cle] ?? cle, comptes: acc.length, devises: [...new Set(acc.map((a) => a.currency))], derniereSynchro: synchros.at(-1) ?? null, dernierJourDepense: dernierJour.get(cle) ?? null };
    }),
    comptes: suivis.map(({ a, s }) => ({ plateforme: a.platform, externalId: a.external_id, nom: a.name, devise: a.currency, derniereSynchro: a.last_synced_at, site: s!.id })),
    entites: { campagnes: ref.filter((r) => r.niveau === "campagne").length, adsets: ref.filter((r) => r.niveau === "adset").length, pubs: ref.filter((r) => r.niveau === "pub").length },

    colonnes: catalogue(stages),
    devise: { affichage: ctx.workspace.currency, taux: {} },
  });
}
