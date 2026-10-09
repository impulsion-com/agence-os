// Contrat de l'API /api/ext/v1, lue par l'extension Chrome « Colonnes CRM pour Ads Manager ».
// Le même contrat est servi par le CRM interne d'Impulsion : une seule extension parle aux deux.
// Les noms de champs (français, camelCase) sont ceux du contrat, pas ceux du reste du code.
// Pur : chargé tel quel par les tests (chemins relatifs avec extension).

import { NONE, credits, type Conversion, type ModelId } from "./attribution.ts";
import { ratio, type CampLevel, type CampNode, type CampaignTable, type StageDef } from "./campaigns.ts";
import { channelName, isPaid, platformChannel } from "./channels.ts";

export const VERSION_API = 1;
export const PRODUIT = "agence-os";

export type Niveau = "campagne" | "adset" | "pub";
export const NIVEAUX: Niveau[] = ["campagne", "adset", "pub"];
export const estNiveau = (v: string): v is Niveau => (NIVEAUX as string[]).includes(v);
const NIVEAU: Record<CampLevel, Niveau> = { campaign: "campagne", adset: "adset", ad: "pub" };

/** Le schéma ne garantit l'unicité d'un identifiant que dans sa régie et à son niveau : la clé porte les trois. */
export const cleEntite = (plateforme: string, niveau: Niveau, externalId: string) => `${plateforme}:${niveau}:${externalId}`;

// ---------------------------------------------------------------------
// Catalogue des colonnes : dérivé de l'entonnoir du site
// ---------------------------------------------------------------------
export type Role = "cout" | "etape" | "resultat" | "valeur" | "ratio" | "regie";

export interface Colonne {
  cle: string;
  entete: string;
  label: string;
  format: "euros" | "nombre" | "multiple";
  parDefaut: boolean;
  aide: string | null;
  /** Ce que la colonne représente, pour un lecteur qui ne connaît pas l'entonnoir du site. */
  role: Role;
}

/**
 * Clé de colonne d'une étape. Les étapes d'entrée et de vente gardent les clés historiques du contrat
 * (`leads`, `ventes`) que l'extension sait poser dans les colonnes natives d'Ads Manager.
 */
export const cleEtape = (s: StageDef) => (s.kind === "lead" ? "leads" : s.kind === "sale" ? "ventes" : `etape_${s.key}`);

export function catalogue(stages: StageDef[]): Colonne[] {
  const cols: Colonne[] = [
    { cle: "depense", entete: "Dépense", label: "Dépense", format: "euros", parDefaut: true, aide: "Dépense de la régie sur la période, portée par le niveau le plus fin synchronisé.", role: "cout" },
  ];
  const seen = new Set<string>();
  for (const s of stages) {
    const cle = cleEtape(s);
    if (seen.has(cle)) continue;
    seen.add(cle);
    const several = stages.filter((x) => cleEtape(x) === cle);
    const label = several.length > 1 ? several.map((x) => x.label).join(" + ") : s.label;
    cols.push({
      cle,
      entete: s.kind === "lead" ? "Leads" : s.kind === "sale" ? "Ventes" : s.label,
      label,
      format: "nombre",
      parDefaut: true,
      aide: "Somme des poids d'attribution, pas un compte de lignes : sous un modèle multi-touches une conversion peut valoir 0,5 ici et 0,5 ailleurs.",
      role: s.kind === "sale" ? "resultat" : "etape",
    });
  }
  const hasLead = seen.has("leads");
  const hasSale = seen.has("ventes");
  if (hasLead) cols.push({ cle: "cpl", entete: "CPL", label: "Coût par lead", format: "euros", parDefaut: true, aide: "Dépense divisée par les leads attribués.", role: "ratio" });
  if (hasSale) {
    cols.push({ cle: "caSigne", entete: "CA", label: "Chiffre d'affaires attribué", format: "euros", parDefaut: true, aide: "Crédit attribué des ventes, pas le chiffre d'affaires total.", role: "valeur" });
    cols.push({ cle: "roas", entete: "ROAS", label: "ROAS réel", format: "multiple", parDefaut: true, aide: "Chiffre d'affaires attribué sur dépense. Vide quand la ligne n'a aucune dépense.", role: "ratio" });
    cols.push({ cle: "cac", entete: "Coût / vente", label: "Coût par vente", format: "euros", parDefaut: false, aide: "Dépense divisée par les ventes attribuées.", role: "ratio" });
  }
  cols.push({ cle: "conversionsPlateforme", entete: "Conv. régie", label: "Conversions déclarées par la régie", format: "nombre", parDefaut: false, aide: "Ce que la régie compte de son côté, au niveau campagne.", role: "regie" });
  return cols;
}

/** Les mesures d'une ligne, sous les clés du catalogue. Un ratio indéfini vaut null, jamais 0. */
export function mesures(n: { stages: Record<string, number>; value: number; spend: number | null; pconv?: number | null }, stages: StageDef[]): Record<string, number | null> {
  const m: Record<string, number | null> = { depense: n.spend };
  for (const s of stages) {
    const cle = cleEtape(s);
    m[cle] = (m[cle] ?? 0) + (n.stages[s.key] ?? 0);
  }
  if ("leads" in m) m.cpl = n.spend !== null && (m.leads ?? 0) > 0 ? n.spend / (m.leads as number) : null;
  if ("ventes" in m) {
    m.caSigne = n.value;
    m.roas = ratio(n.value, n.spend);
    m.cac = n.spend !== null && (m.ventes ?? 0) > 0 ? n.spend / (m.ventes as number) : null;
  }
  m.conversionsPlateforme = n.pconv ?? null;
  return m;
}

// ---------------------------------------------------------------------
// Entités
// ---------------------------------------------------------------------
export interface Entree {
  niveau: Niveau;
  plateforme: string;
  externalId: string;
  parentExternalId: string | null;
  nom: string;
  statut: string | null;
  objectif: string | null;
  canal: string;
  canalLabel: string;
  deviseCompte: string;
  /** Niveau le plus fin où la dépense est connue sous cette ligne : `ad`, `campaign`, ou null. */
  niveauDepense: string | null;
  m: Record<string, number | null>;
}

function entree(plateforme: string, niveau: Niveau, externalId: string, parent: string | null, nom: string, devise: string, niveauDepense: string | null, m: Record<string, number | null>): Entree {
  const canal = platformChannel(plateforme);
  return { niveau, plateforme, externalId, parentExternalId: parent, nom, statut: null, objectif: null, canal, canalLabel: channelName(canal), deviseCompte: devise, niveauDepense, m };
}

/** Aplatit le tableau des campagnes en dictionnaire `plateforme:niveau:externalId`, sur les niveaux et régies demandés. */
export function aplatir(table: CampaignTable, stages: StageDef[], niveaux: Niveau[], plateformes: string[], devise: string): Record<string, Entree> {
  const out: Record<string, Entree> = {};
  const want = new Set(niveaux);
  const walk = (n: CampNode, parent: string | null) => {
    // Une ligne sans régie (campagne reconnue par son seul nom d'URL) ou sans identifiant n'a pas de ligne en face dans Ads Manager
    if (!n.platform || n.key === NONE) return;
    if (plateformes.length && !plateformes.includes(n.platform)) return;
    const niveau = NIVEAU[n.level];
    if (want.has(niveau)) {
      const fine = n.level === "ad" ? n.spend !== null : n.level === "adset" ? n.children.some((c) => c.spend !== null) : n.children.some((s) => s.children.some((c) => c.spend !== null));
      out[cleEntite(n.platform, niveau, n.key)] = entree(n.platform, niveau, n.key, parent, n.label, devise, fine ? "ad" : n.spend !== null ? "campaign" : null, mesures(n, stages));
    }
    for (const c of n.children) walk(c, n.key);
  };
  for (const r of table.rows) walk(r, null);
  return out;
}

/** Une entité connue du référentiel mais sans activité sur la période : des zéros, pas une absence. */
export function entreeSansActivite(plateforme: string, niveau: Niveau, externalId: string, parent: string | null, nom: string, stages: StageDef[], devise: string): Entree {
  return entree(plateforme, niveau, externalId, parent, nom, devise, null, mesures({ stages: {}, value: 0, spend: 0, pconv: niveau === "campagne" ? 0 : null }, stages));
}

// ---------------------------------------------------------------------
// Personnes créditées à une entité
// ---------------------------------------------------------------------
export interface Credite {
  personne: string;
  /** Libellé de l'étape la plus avancée de la personne sur la période. */
  etape: string;
  credit: number;
  jour: string;
}

export function creditesDe(convs: Conversion[], stages: StageDef[], model: ModelId, windowDays: number, niveau: Niveau, externalId: string): Credite[] {
  const rank = new Map(stages.map((s, i) => [s.key, i]));
  const by = new Map<string, { credit: number; rang: number; etape: string; jour: string }>();
  const seen = new Set<string>();
  for (const c of [...convs].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const stage = stages.find((s) => s.key === c.type || s.aliases.includes(c.type));
    if (!stage) continue;
    if (stage.kind === "lead") {
      const k = `${stage.key}|${c.person}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    for (const { touch, weight } of credits(c, model, windowDays)) {
      if (!touch || !isPaid(touch.channel)) continue;
      const id = niveau === "campagne" ? touch.campaign_key || touch.campaign : niveau === "adset" ? touch.adset_key : touch.ad_key;
      if (id !== externalId) continue;
      const rang = rank.get(stage.key) ?? 0;
      const cur = by.get(c.person);
      if (!cur) by.set(c.person, { credit: weight, rang, etape: stage.label, jour: c.ts.slice(0, 10) });
      else {
        cur.credit += weight;
        if (rang >= cur.rang) Object.assign(cur, { rang, etape: stage.label, jour: c.ts.slice(0, 10) });
      }
    }
  }
  return [...by.entries()]
    .map(([personne, v]) => ({ personne, etape: v.etape, credit: v.credit, jour: v.jour, rang: v.rang }))
    .sort((a, b) => b.rang - a.rang || b.credit - a.credit || b.jour.localeCompare(a.jour))
    .map(({ personne, etape, credit, jour }) => ({ personne, etape, credit, jour }));
}

// ---------------------------------------------------------------------
// Filtres : mêmes clés d'URL que le CRM (p, du, au, m, f)
// ---------------------------------------------------------------------
export const PERIODES: { cle: string; label: string }[] = [
  { cle: "7j", label: "7 j" },
  { cle: "30j", label: "30 j" },
  { cle: "90j", label: "90 j" },
  { cle: "mois", label: "Mois en cours" },
  { cle: "mois_dernier", label: "Mois dernier" },
  { cle: "perso", label: "Personnalisé" },
];
export const PERIODE_DEFAUT = "30j";
export const FENETRE_MAXIMALE = 90;

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Période résolue en jours calendaires UTC, aujourd'hui inclus (le tracking est en temps réel). */
export function lirePeriode(p: string | null, du: string | null, au: string | null, now = new Date()): { cle: string; start: string; end: string; label: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (n: number) => new Date(today.getTime() - n * 864e5);
  if (p === "perso" && du && au && JOUR.test(du) && JOUR.test(au) && du <= au) return { cle: "perso", start: du, end: au, label: `du ${du} au ${au}` };
  switch (p) {
    case "7j":
      return { cle: "7j", start: iso(back(6)), end: iso(today), label: "7 j" };
    case "90j":
      return { cle: "90j", start: iso(back(89)), end: iso(today), label: "90 j" };
    case "mois":
      return { cle: "mois", start: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), end: iso(today), label: "Mois en cours" };
    case "mois_dernier":
      return {
        cle: "mois_dernier",
        start: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))),
        end: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))),
        label: "Mois dernier",
      };
    default:
      return { cle: "30j", start: iso(back(29)), end: iso(today), label: "30 j" };
  }
}

/** Identifiant de compte publicitaire sous une forme comparable : sans « act_ », sans tirets. */
export const cleCompte = (id: string) => id.trim().toLowerCase().replace(/^act_/, "").replace(/[^a-z0-9]/g, "");
