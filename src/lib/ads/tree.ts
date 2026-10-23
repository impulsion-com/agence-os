// Détail d'un client par campagne, ensemble de publicités et publicité.
// Les totaux de campagne viennent de la synchro par campagne (la référence, qui couvre
// aussi Performance Max et les imports CSV) ; ensembles et publicités viennent de la
// synchro par annonce. Les ventes suivies sont celles du tracking (dernier clic sur une
// publicité), additionnées en remontant l'arbre.

import { ZERO, add, type Totals } from "./metrics";

export type TreeLevel = "campaign" | "adset" | "ad";

/** Métriques d'une publicité sur une période (somme des jours). */
export interface AdAgg {
  ad_account_id: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

/** Fiche d'une publicité (catalogue `ad_ads`). */
export interface AdInfo {
  name: string;
  adset_name: string;
  status: string | null;
  format: string | null;
  thumbnail_url: string | null;
  frequency_7d: number | null;
}

export interface CampaignAgg {
  ad_account_id: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

export interface AdTreeData {
  ads: AdAgg[];
  prevAds: AdAgg[];
  /** clé `${ad_account_id}|${ad_id}` */
  info: Record<string, AdInfo>;
  /** ventes suivies par identifiant de publicité ; vide sans tracking */
  attribution: Record<string, { sales: number; revenue: number }>;
  /** concept créa relié, par identifiant de publicité */
  concepts: Record<string, string>;
}

export interface TreeNode {
  level: TreeLevel;
  /** unique dans l'arbre */
  id: string;
  name: string;
  accountId: string;
  t: Totals;
  prevSpend: number | null;
  sales: number;
  revenue: number;
  /** publicités seulement */
  ad?: { adId: string; thumb: string | null; format: string | null; status: string | null; frequency: number | null; conceptId: string | null };
  children: TreeNode[];
}

const NONE = "(sans ensemble)";

const totals = (r: { spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number }): Totals => ({
  spend: r.spend,
  impressions: r.impressions,
  clicks: r.clicks,
  conversions: r.conversions,
  value: r.conversion_value,
});

export function buildTree(campaigns: CampaignAgg[], prevCampaigns: CampaignAgg[], data: AdTreeData): TreeNode[] {
  const prevCamp = new Map(prevCampaigns.map((c) => [`${c.ad_account_id}|${c.campaign_id}`, c.spend]));
  const prevAd = new Map<string, number>();
  const prevSet = new Map<string, number>();
  for (const a of data.prevAds) {
    prevAd.set(`${a.ad_account_id}|${a.ad_id}`, (prevAd.get(`${a.ad_account_id}|${a.ad_id}`) ?? 0) + a.spend);
    const s = `${a.ad_account_id}|${a.campaign_id}|${a.adset_id}`;
    prevSet.set(s, (prevSet.get(s) ?? 0) + a.spend);
  }

  const roots = new Map<string, TreeNode>();
  for (const c of campaigns) {
    const id = `${c.ad_account_id}|${c.campaign_id}`;
    roots.set(id, {
      level: "campaign",
      id,
      name: c.campaign_name || c.campaign_id,
      accountId: c.ad_account_id,
      t: totals(c),
      prevSpend: prevCamp.get(id) ?? null,
      sales: 0,
      revenue: 0,
      children: [],
    });
  }

  const known = new Set(roots.keys());
  const sets = new Map<string, TreeNode>();
  for (const a of data.ads) {
    const cid = `${a.ad_account_id}|${a.campaign_id}`;
    let camp = roots.get(cid);
    if (!camp) {
      // annonce sans ligne de campagne (synchro partielle) : la campagne se reconstruit
      camp = { level: "campaign", id: cid, name: a.campaign_id, accountId: a.ad_account_id, t: ZERO, prevSpend: null, sales: 0, revenue: 0, children: [] };
      roots.set(cid, camp);
    }
    const info = data.info[`${a.ad_account_id}|${a.ad_id}`];
    const sid = `${cid}|${a.adset_id}`;
    let set = sets.get(sid);
    if (!set) {
      set = {
        level: "adset",
        id: sid,
        name: info?.adset_name || (a.adset_id ? a.adset_id : NONE),
        accountId: a.ad_account_id,
        t: ZERO,
        prevSpend: prevSet.get(sid) ?? null,
        sales: 0,
        revenue: 0,
        children: [],
      };
      sets.set(sid, set);
      camp.children.push(set);
    } else if (set.name === a.adset_id && info?.adset_name) set.name = info.adset_name;

    const att = data.attribution[a.ad_id];
    const ad: TreeNode = {
      level: "ad",
      id: `${a.ad_account_id}|${a.ad_id}`,
      name: info?.name || a.ad_name || a.ad_id,
      accountId: a.ad_account_id,
      t: totals(a),
      prevSpend: prevAd.get(`${a.ad_account_id}|${a.ad_id}`) ?? null,
      sales: att?.sales ?? 0,
      revenue: att?.revenue ?? 0,
      ad: {
        adId: a.ad_id,
        thumb: info?.thumbnail_url ?? null,
        format: info?.format ?? null,
        status: info?.status ?? null,
        frequency: info?.frequency_7d ?? null,
        conceptId: data.concepts[a.ad_id] ?? null,
      },
      children: [],
    };
    set.children.push(ad);
    set.t = add(set.t, ad.t);
    set.sales += ad.sales;
    set.revenue += ad.revenue;
    camp.sales += ad.sales;
    camp.revenue += ad.revenue;
    if (!known.has(cid)) camp.t = add(camp.t, ad.t);
  }
  return [...roots.values()];
}

/** Aplatit l'arbre à un niveau (pour les vues « Ensembles » et « Publicités »). */
export function flatten(nodes: TreeNode[], level: TreeLevel): TreeNode[] {
  if (level === "campaign") return nodes;
  const sets = nodes.flatMap((c) => c.children);
  return level === "adset" ? sets : sets.flatMap((s) => s.children);
}

/** Additionne des métriques par publicité (une ligne par jour) en une ligne par publicité. */
export function aggregateAds(rows: AdAgg[]): AdAgg[] {
  const by = new Map<string, AdAgg>();
  for (const r of rows) {
    const k = `${r.ad_account_id}|${r.ad_id}`;
    const cur = by.get(k);
    if (!cur) by.set(k, { ...r });
    else {
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.conversions += r.conversions;
      cur.conversion_value += r.conversion_value;
      if (r.ad_name) cur.ad_name = r.ad_name;
    }
  }
  return [...by.values()];
}
