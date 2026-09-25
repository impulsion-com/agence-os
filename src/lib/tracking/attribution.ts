// Moteur d'attribution multi-touch. Pur (aucun import d'exécution) : utilisable
// côté serveur, côté client et dans les tests (node --experimental-strip-types).

export type ModelId = "first_click" | "last_click" | "last_non_direct" | "linear" | "time_decay" | "position";

export const MODELS: { id: ModelId; name: string; help: string }[] = [
  { id: "last_click", name: "Dernier clic", help: "100 % au dernier point de contact avant la conversion" },
  { id: "last_non_direct", name: "Dernier clic non direct", help: "100 % au dernier point de contact qui n'est pas une visite directe" },
  { id: "first_click", name: "Premier clic", help: "100 % au premier point de contact de la fenêtre" },
  { id: "linear", name: "Linéaire", help: "Crédit réparti à parts égales entre tous les points de contact" },
  { id: "time_decay", name: "Décroissance temporelle", help: "Plus le point de contact est proche de la conversion, plus il compte (demi-vie 7 jours)" },
  { id: "position", name: "En U (40/20/40)", help: "40 % au premier, 40 % au dernier, 20 % répartis entre ceux du milieu" },
];
export const MODEL_IDS = MODELS.map((m) => m.id);
export const modelName = (m: string) => MODELS.find((x) => x.id === m)?.name ?? m;

export const WINDOWS = [1, 7, 14, 30, 60, 90];

export interface Touch {
  ts: string;
  channel: string;
  platform?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  campaign_key?: string | null;
  adset_key?: string | null;
  ad_key?: string | null;
  link_id?: string | null;
  landing_url?: string | null;
  referrer?: string | null;
}

export interface Conversion {
  id: string;
  ts: string;
  type: string;
  value: number;
  person: string;
  touches: Touch[];
}

export interface Credit {
  touch: Touch | null; // null : conversion sans point de contact dans la fenêtre
  weight: number;
}

const DAY_MS = 864e5;
export const HALF_LIFE_DAYS = 7;

/** Points de contact retenus : dans la fenêtre, antérieurs à la conversion, triés. */
export function inWindow(c: Conversion, windowDays: number): Touch[] {
  const end = Date.parse(c.ts);
  const start = end - windowDays * DAY_MS;
  return c.touches
    .filter((t) => {
      const x = Date.parse(t.ts);
      return x <= end && x > start;
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** Répartition du crédit d'une conversion entre ses points de contact (somme = 1). */
export function credits(c: Conversion, model: ModelId, windowDays: number, halfLife = HALF_LIFE_DAYS): Credit[] {
  const ts = inWindow(c, windowDays);
  const n = ts.length;
  if (!n) return [{ touch: null, weight: 1 }];
  switch (model) {
    case "first_click":
      return [{ touch: ts[0], weight: 1 }];
    case "last_click":
      return [{ touch: ts[n - 1], weight: 1 }];
    case "last_non_direct": {
      for (let i = n - 1; i >= 0; i--) if (ts[i].channel !== "direct") return [{ touch: ts[i], weight: 1 }];
      return [{ touch: ts[n - 1], weight: 1 }];
    }
    case "linear":
      return ts.map((t) => ({ touch: t, weight: 1 / n }));
    case "time_decay": {
      const end = Date.parse(c.ts);
      const raw = ts.map((t) => Math.pow(2, -(end - Date.parse(t.ts)) / (halfLife * DAY_MS)));
      const sum = raw.reduce((s, x) => s + x, 0);
      return ts.map((t, i) => ({ touch: t, weight: raw[i] / sum }));
    }
    case "position": {
      if (n === 1) return [{ touch: ts[0], weight: 1 }];
      if (n === 2) return [{ touch: ts[0], weight: 0.5 }, { touch: ts[1], weight: 0.5 }];
      const mid = 0.2 / (n - 2);
      return ts.map((t, i) => ({ touch: t, weight: i === 0 || i === n - 1 ? 0.4 : mid }));
    }
  }
}

// ---------------------------------------------------------------------
// Agrégation
// ---------------------------------------------------------------------
export interface Agg {
  conversions: number;
  value: number;
}

export const NONE = "∅";

export const DIMENSIONS = {
  channel: (t: Touch | null) => (t ? t.channel || "direct" : "none"),
  source_medium: (t: Touch | null) => (t ? `${t.source || (t.channel === "direct" ? "(direct)" : t.platform || t.channel)} / ${t.medium || "(none)"}` : "none"),
  campaign: (t: Touch | null) => (t ? t.campaign_key || t.campaign || NONE : NONE),
  adset: (t: Touch | null) => (t ? t.adset_key || NONE : NONE),
  ad: (t: Touch | null) => (t ? t.ad_key || t.content || NONE : NONE),
  link: (t: Touch | null) => (t ? t.link_id || NONE : NONE),
} satisfies Record<string, (t: Touch | null) => string>;
export type DimensionId = keyof typeof DIMENSIONS;

/** Totaux attribués par clé (une dimension). */
export function attributeBy(convs: Conversion[], model: ModelId, windowDays: number, key: (t: Touch | null) => string) {
  const out = new Map<string, Agg>();
  for (const c of convs) {
    for (const { touch, weight } of credits(c, model, windowDays)) {
      const k = key(touch);
      const a = out.get(k) ?? { conversions: 0, value: 0 };
      a.conversions += weight;
      a.value += weight * c.value;
      out.set(k, a);
    }
  }
  return out;
}

export interface TreeNode extends Agg {
  key: string;
  level: number;
  children: TreeNode[];
  /** premier point de contact rencontré (pour les libellés : nom de campagne, d'annonce…) */
  sample: Touch | null;
}

/** Arbre attribué sur plusieurs niveaux (ex. canal → campagne → annonce). */
export function attributeTree(convs: Conversion[], model: ModelId, windowDays: number, levels: ((t: Touch | null) => string)[]): TreeNode[] {
  const root: TreeNode = { key: "", level: -1, children: [], conversions: 0, value: 0, sample: null };
  const index = new Map<string, TreeNode>();
  for (const c of convs) {
    for (const { touch, weight } of credits(c, model, windowDays)) {
      let parent = root;
      let path = "";
      levels.forEach((fn, level) => {
        const k = fn(touch);
        path += "\u0001" + k;
        let node = index.get(path);
        if (!node) {
          node = { key: k, level, children: [], conversions: 0, value: 0, sample: touch };
          index.set(path, node);
          parent.children.push(node);
        }
        node.conversions += weight;
        node.value += weight * c.value;
        parent = node;
      });
    }
  }
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => b.value - a.value || b.conversions - a.conversions);
    ns.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

/** Totaux attribués par jour de conversion, filtrés sur les points de contact retenus par `keep`. */
export function attributedByDay(convs: Conversion[], model: ModelId, windowDays: number, keep: (t: Touch | null) => boolean) {
  const out = new Map<string, Agg>();
  for (const c of convs) {
    const d = c.ts.slice(0, 10);
    for (const { touch, weight } of credits(c, model, windowDays)) {
      if (!keep(touch)) continue;
      const a = out.get(d) ?? { conversions: 0, value: 0 };
      a.conversions += weight;
      a.value += weight * c.value;
      out.set(d, a);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Rapprochement avec la dépense publicitaire
// ---------------------------------------------------------------------
export interface SpendCampaign {
  id: string;
  name: string;
  platform: string;
}

/**
 * Remplace campaign_key par l'id de campagne publicitaire correspondant :
 * par id (utm_id, ValueTrack) sinon par nom (utm_campaign = nom de campagne).
 */
export function linkCampaigns(convs: Conversion[], campaigns: SpendCampaign[]): Conversion[] {
  const ids = new Set(campaigns.map((c) => c.id));
  const byName = new Map(campaigns.map((c) => [c.name.trim().toLowerCase(), c.id]));
  return convs.map((c) => ({
    ...c,
    touches: c.touches.map((t) => {
      if (t.campaign_key && ids.has(t.campaign_key)) return t;
      const byN = t.campaign ? byName.get(t.campaign.trim().toLowerCase()) : undefined;
      return byN ? { ...t, campaign_key: byN } : t;
    }),
  }));
}
