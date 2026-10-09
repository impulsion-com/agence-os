// Entonnoir d'un site suivi (table tracking_stages). Pur : client et serveur.

export type TemplateId = "appel" | "ecommerce" | "leads";

/** Gabarits proposés à la création d'un site (les étapes sont posées par la base, voir _tracking_template). */
export const TEMPLATES: { id: TemplateId; name: string; desc: string }[] = [
  { id: "leads", name: "Génération de leads", desc: "Prospect, prospect qualifié, vente" },
  { id: "appel", name: "Vente par appel", desc: "Prospect, rendez-vous pris et honoré, qualification, vente" },
  { id: "ecommerce", name: "E-commerce", desc: "Ajout au panier, paiement initié, achat" },
];

export type StageKind = "lead" | "step" | "sale";
export const KINDS: { id: StageKind; name: string }[] = [
  { id: "lead", name: "Entrée" },
  { id: "step", name: "Jalon" },
  { id: "sale", name: "Vente" },
];

export interface Stage {
  id: string;
  key: string;
  label: string;
  position: number;
  kind: StageKind;
  has_value: boolean;
  aliases: string[];
}

/** Une ligne de la RPC tracking_funnel : une étape (stage_id) ou un type d'évènement sans étape (type). */
export interface FunnelAgg {
  stage_id: string | null;
  type: string | null;
  events: number;
  people: number;
  value: number;
}

export interface FunnelRow {
  stage: Stage;
  events: number;
  people: number;
  value: number;
  /** Personnes de cette étape rapportées à celles de l'étape précédente, en % (null : pas d'étape précédente ou étape précédente vide). */
  fromPrev: number | null;
  /** Part de l'étape la plus fournie, pour la largeur de la barre (0 à 1). */
  share: number;
}

export interface Funnel {
  rows: FunnelRow[];
  /** Évènements reçus qui ne correspondent à aucune étape. */
  other: { type: string; events: number; people: number; value: number }[];
}

export function buildFunnel(stages: Stage[], agg: FunnelAgg[]): Funnel {
  const byStage = new Map(agg.filter((a) => a.stage_id).map((a) => [a.stage_id as string, a]));
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const max = Math.max(0, ...ordered.map((s) => byStage.get(s.id)?.people ?? 0));
  const rows = ordered.map((stage, i) => {
    const a = byStage.get(stage.id);
    const people = a?.people ?? 0;
    const prev = i > 0 ? (byStage.get(ordered[i - 1].id)?.people ?? 0) : 0;
    return { stage, events: a?.events ?? 0, people, value: a?.value ?? 0, fromPrev: i > 0 && prev > 0 ? (people / prev) * 100 : null, share: max ? people / max : 0 };
  });
  const other = agg
    .filter((a) => !a.stage_id && a.type)
    .map((a) => ({ type: a.type as string, events: a.events, people: a.people, value: a.value }))
    .sort((a, b) => b.events - a.events);
  return { rows, other };
}

/** Clé d'étape à partir d'une saisie libre : minuscules, chiffres et tirets bas. */
export function stageKey(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[_0-9]+|_+$/g, "")
    .slice(0, 40);
}
