// Tableau des campagnes : dépense, étapes de l'entonnoir et chiffre d'affaires attribués à chaque
// campagne, ensemble de publicités et publicité. Pur : client, serveur et tests.
// Chemins relatifs avec extension : ce module est chargé tel quel par les tests (node --experimental-strip-types).

import { MODEL_IDS, NONE, credits, type Conversion, type ModelId, type Touch } from "./attribution.ts";
import { isPaid, platformChannel } from "./channels.ts";

export interface StageDef {
  key: string;
  label: string;
  kind: "lead" | "step" | "sale";
  has_value: boolean;
  aliases: string[];
}

/** Dépense d'une publicité sur la période, avec ses parents. Les identifiants sont ceux de la régie. */
export interface AdSpend {
  platform: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  /** Conversions et valeur déclarées par la régie pour cette publicité (absentes : inconnues) */
  pconv?: number;
  pvalue?: number;
}

/** Dépense et conversions déclarées par la régie pour une campagne sur la période. */
export interface CampaignSpend {
  platform: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  pconv: number;
  pvalue: number;
}

export type CampLevel = "campaign" | "adset" | "ad";

export interface CampNode {
  /** Identifiant de ligne, unique dans le tableau. */
  id: string;
  level: CampLevel;
  /** Identifiant de la régie, ou nom lu dans l'URL quand aucun identifiant n'a été transmis. */
  key: string;
  label: string;
  platform: string | null;
  /** Dépense connue ; null quand la régie n'est pas connectée ou que ce niveau n'est pas synchronisé. */
  spend: number | null;
  /** Crédit attribué par étape (somme de poids : 0,5 sous un modèle multi-touches). */
  stages: Record<string, number>;
  /** Chiffre d'affaires attribué (étapes de type vente). */
  value: number;
  /** Conversions et valeur déclarées par la régie (campagne, et ensemble ou publicité quand la synchro par annonce les donne). */
  pconv: number | null;
  pvalue: number | null;
  /** Personnes créditées sur cette ligne, toutes étapes confondues. */
  people: string[];
  children: CampNode[];
}

export interface CampaignTable {
  rows: CampNode[];
  /** Ce qui revient à un canal non payant (organique, direct, email) ou à aucun point de contact. */
  organic: { stages: Record<string, number>; value: number };
  total: { stages: Record<string, number>; value: number; spend: number };
}

const PEOPLE_CAP = 200;

function stageOf(type: string, stages: StageDef[]) {
  return stages.find((s) => s.key === type || s.aliases.includes(type));
}

function node(level: CampLevel, id: string, key: string, label: string, platform: string | null): CampNode {
  return { id, level, key, label, platform, spend: null, stages: {}, value: 0, pconv: null, pvalue: null, people: [], children: [] };
}

function add(n: { stages: Record<string, number>; value: number }, stage: string, weight: number, value: number) {
  n.stages[stage] = (n.stages[stage] ?? 0) + weight;
  n.value += value;
}

/**
 * `convs` : conversions de la période avec leurs points de contact, campaign_key déjà rapproché des
 * campagnes connues (linkCampaigns). Une étape d'entrée ne compte qu'une conversion par personne.
 */
export function buildCampaignTable(
  convs: Conversion[],
  stages: StageDef[],
  model: ModelId,
  windowDays: number,
  campaigns: CampaignSpend[],
  ads: AdSpend[],
): CampaignTable {
  const byCamp = new Map<string, CampNode>();
  const child = (parent: CampNode, level: CampLevel, key: string, label: string) => {
    let c = parent.children.find((x) => x.key === key);
    if (!c) {
      c = node(level, `${parent.id}|${key}`, key, label, parent.platform);
      parent.children.push(c);
    }
    return c;
  };
  const camp = (key: string, label: string, platform: string | null) => {
    let c = byCamp.get(key);
    if (!c) {
      c = node("campaign", key, key, label, platform);
      byCamp.set(key, c);
    }
    return c;
  };

  // 1. Le référentiel de la régie : toute campagne, tout ensemble et toute publicité qui a dépensé apparaît, même sans conversion
  for (const c of campaigns) {
    const n = camp(c.campaign_id, c.campaign_name || c.campaign_id, c.platform);
    n.spend = (n.spend ?? 0) + c.spend;
    n.pconv = (n.pconv ?? 0) + c.pconv;
    n.pvalue = (n.pvalue ?? 0) + c.pvalue;
  }
  for (const a of ads) {
    const c = camp(a.campaign_id || NONE, a.campaign_name || a.campaign_id || "(sans campagne)", a.platform);
    const s = child(c, "adset", a.adset_id || NONE, a.adset_name || a.adset_id || "(ensemble inconnu)");
    const ad = child(s, "ad", a.ad_id, a.ad_name || a.ad_id);
    s.spend = (s.spend ?? 0) + a.spend;
    ad.spend = (ad.spend ?? 0) + a.spend;
    if (a.pconv !== undefined || a.pvalue !== undefined) {
      for (const x of [s, ad]) {
        x.pconv = (x.pconv ?? 0) + (a.pconv ?? 0);
        x.pvalue = (x.pvalue ?? 0) + (a.pvalue ?? 0);
      }
    }
    // Une campagne absente du rapport par campagne tient sa dépense de ses publicités
    if (!campaigns.some((x) => x.campaign_id === a.campaign_id)) c.spend = (c.spend ?? 0) + a.spend;
  }

  // 2. Le crédit de chaque conversion
  const organic = { stages: {} as Record<string, number>, value: 0 };
  const total = { stages: {} as Record<string, number>, value: 0, spend: 0 };
  const people = new Map<CampNode, Set<string>>();
  const seen = new Set<string>();
  for (const c of [...convs].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const stage = stageOf(c.type, stages);
    if (!stage) continue;
    if (stage.kind === "lead") {
      const k = `${stage.key}|${c.person}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    const worth = stage.kind === "sale" ? c.value : 0;
    add(total, stage.key, 1, worth);
    for (const { touch, weight } of credits(c, model, windowDays)) {
      if (!touch || !isPaid(touch.channel)) {
        add(organic, stage.key, weight, weight * worth);
        continue;
      }
      const [ck, sk, ak] = rowPath(touch);
      const cn = camp(ck, touch.campaign || (ck === NONE ? "(sans campagne)" : ck), touch.platform ?? null);
      const line = [cn];
      if (sk) {
        const sn = child(cn, "adset", sk, touch.term || touch.adset_key || "(ensemble inconnu)");
        line.push(sn);
        if (ak) line.push(child(sn, "ad", ak, touch.content || ak));
      }
      for (const n of line) {
        add(n, stage.key, weight, weight * worth);
        const set = people.get(n) ?? new Set<string>();
        if (set.size < PEOPLE_CAP) set.add(c.person);
        people.set(n, set);
      }
    }
  }
  for (const [n, set] of people) n.people = [...set];

  const rows = [...byCamp.values()];
  const order = (a: CampNode, b: CampNode) => b.value - a.value || (b.spend ?? 0) - (a.spend ?? 0) || a.label.localeCompare(b.label);
  for (const r of rows) {
    r.children.sort(order);
    for (const s of r.children) s.children.sort(order);
    total.spend += r.spend ?? 0;
  }
  rows.sort(order);
  return { rows, organic, total };
}

/**
 * Clés de la ligne créditée par un point de contact payant : campagne, puis ensemble et publicité quand
 * l'URL les porte. Les identifiants de ligne du tableau en découlent : « c », « c|s », « c|s|a ».
 */
export function rowPath(t: Touch): [string, string | null, string | null] {
  const ck = t.campaign_key || t.campaign || NONE;
  if (!t.adset_key && !t.ad_key) return [ck, null, null];
  return [ck, t.adset_key || NONE, t.ad_key || null];
}

/** Identifiants des lignes du tableau créditées par un point de contact (campagne, ensemble, publicité). */
export function rowIds(t: Touch): string[] {
  const [c, s, a] = rowPath(t);
  return [c, ...(s ? [`${c}|${s}`] : []), ...(s && a ? [`${c}|${s}|${a}`] : [])];
}

/**
 * Chiffre d'affaires attribué à chaque campagne sous chaque modèle (comparateur façon Hyros) :
 * le même jeu de ventes, réparti par les huit modèles. Clé : identifiant de campagne.
 */
export function modelMatrix(convs: Conversion[], stages: StageDef[], windowDays: number): Map<string, Record<ModelId, number>> {
  const out = new Map<string, Record<ModelId, number>>();
  const zero = () => Object.fromEntries(MODEL_IDS.map((m) => [m, 0])) as Record<ModelId, number>;
  for (const c of convs) {
    const stage = stageOf(c.type, stages);
    if (stage?.kind !== "sale" || !c.value) continue;
    for (const m of MODEL_IDS)
      for (const { touch, weight } of credits(c, m, windowDays)) {
        if (!touch || !isPaid(touch.channel)) continue;
        const k = rowPath(touch)[0];
        const r = out.get(k) ?? zero();
        r[m] += weight * c.value;
        out.set(k, r);
      }
  }
  return out;
}

/** Canal payant d'une ligne, pour sa pastille de couleur. */
export const nodeChannel = (n: CampNode) => (n.platform ? platformChannel(n.platform) : "paid_other");

/** Valeur sur dépense ; null sans dépense (un ratio indéfini n'est pas zéro). */
export const ratio = (a: number, b: number | null) => (b && b > 0 ? a / b : null);
