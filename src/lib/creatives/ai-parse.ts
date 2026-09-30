// IA de la bibliothèque créa : schémas de sortie, validation et mode simulé.
// Pur (seul zod est importé) : utilisable par le serveur et par les tests node.
import { z } from "zod";

import type { HookType, IntelTags } from "./intel-core";

const HOOKS = ["question", "chiffre", "douleur", "temoignage", "contraste", "curiosite", "promesse", "autorite", "offre", "humour", "autre"] as const;
const AWARE = ["unaware", "problem", "solution", "product", "most"] as const;
const FORMATS = ["static", "carousel", "short_video", "ugc", "motion", "dpa", "other"] as const;

// ---------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------
const tagFields = {
  angle: z.string().describe("Angle marketing en 2 à 4 mots, en français (ex. « Preuve sociale », « Routine simplifiée »)"),
  hook_type: z.enum(HOOKS).describe("Type de hook des 3 premières secondes"),
  hook: z.string().describe("La phrase d'accroche telle qu'elle apparaît, 160 caractères au plus"),
  awareness: z.enum(AWARE).describe("Niveau de conscience de Schwartz visé"),
  format: z.enum(FORMATS).describe("Format probable de la créa"),
  promise: z.string().describe("Promesse principale, une phrase courte"),
  proof: z.string().describe("Preuve utilisée (avis, chiffre, démonstration, expert…), vide si aucune"),
  offer: z.string().describe("Offre commerciale (remise, livraison, garantie), vide si aucune"),
  cta: z.string().describe("Appel à l'action"),
  persona: z.string().describe("Persona visée, une ligne"),
};

/** Schéma envoyé au modèle (structured outputs) : un lot de tags. */
export const TagBatchSchema = z.object({
  items: z.array(z.object({ id: z.string().describe("Identifiant fourni pour l'élément"), ...tagFields })),
});

// Les structured outputs transmettent les listes de valeurs en description : on ramène
// une valeur hors liste à une valeur neutre plutôt que de perdre tout le lot.
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): unknown =>
  typeof v === "string" ? (list.includes(v.trim().toLowerCase() as T) ? v.trim().toLowerCase() : fallback) : v;

function coerceTag(x: unknown) {
  if (!x || typeof x !== "object") return x;
  const o = x as Record<string, unknown>;
  return { ...o, hook_type: pick(o.hook_type, HOOKS, "autre"), awareness: pick(o.awareness, AWARE, "problem"), format: pick(o.format, FORMATS, "other") };
}

/** Valide un lot : ne garde que les identifiants demandés. Lève si la forme est invalide. */
export function validateTagBatch(raw: unknown, ids: string[]): Map<string, IntelTags> {
  const r = raw as { items?: unknown };
  const parsed = TagBatchSchema.parse(r && Array.isArray(r.items) ? { items: r.items.map(coerceTag) } : raw);
  const want = new Set(ids);
  const out = new Map<string, IntelTags>();
  for (const { id, ...t } of parsed.items) {
    if (!want.has(id)) continue;
    out.set(id, { ...t, hook: t.hook.slice(0, 200), angle: t.angle.slice(0, 80) });
  }
  return out;
}

// ---------------------------------------------------------------------
// Recommandations
// ---------------------------------------------------------------------
const BriefSchema = z.object({
  concept_title: z.string().describe("Titre du concept, court"),
  angle: z.string(),
  hooks: z.array(z.string()).describe("Exactement 3 hooks, un par ligne"),
  script: z.string().describe("Script court minuté (0-3 s, 3-10 s…), une étape par ligne"),
  shots: z.array(z.string()).describe("Plans à tourner ou à designer"),
  format: z.enum(FORMATS),
  awareness: z.enum(AWARE),
  persona: z.string(),
  cta: z.string(),
});

const OpportunitySchema = z.object({
  title: z.string(),
  kind: z.enum(["scale", "counter", "gap"]).describe("scale = décliner ce qui marche chez toi, counter = répondre à ce que scalent les concurrents, gap = terrain jamais testé"),
  why: z.string().describe("L'argument, chiffres à l'appui (tes performances et les pubs concurrentes)"),
  evidence: z.array(z.object({ label: z.string(), value: z.string() })).describe("2 à 4 chiffres clés"),
  competitor_ads: z.array(z.string()).describe("Identifiants d'archive des pubs concurrentes citées (uniquement ceux fournis)"),
  brief: BriefSchema,
});

/** Schéma envoyé au modèle. */
export const RecommendationSchema = z.object({
  summary: z.string().describe("Synthèse en 2 ou 3 phrases"),
  opportunities: z.array(OpportunitySchema).describe("3 à 5 opportunités, la plus rentable d'abord"),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;
export type Opportunity = Recommendation["opportunities"][number];

/** Valide et nettoie une recommandation (3 à 5 opportunités, 3 hooks, pubs citées connues). */
export function validateRecommendation(raw: unknown, knownArchiveIds: string[]): Recommendation {
  const x = raw as { opportunities?: unknown };
  const coerced =
    x && Array.isArray(x.opportunities)
      ? {
          ...x,
          opportunities: x.opportunities.map((o: Record<string, unknown>) => {
            const b = (o?.brief ?? {}) as Record<string, unknown>;
            return { ...o, kind: pick(o?.kind, ["scale", "counter", "gap"] as const, "gap"), brief: { ...b, format: pick(b.format, FORMATS, "other"), awareness: pick(b.awareness, AWARE, "problem") } };
          }),
        }
      : raw;
  const r = RecommendationSchema.parse(coerced);
  if (r.opportunities.length < 3) throw new Error("La recommandation contient moins de 3 opportunités");
  const known = new Set(knownArchiveIds);
  const opportunities = r.opportunities.slice(0, 5).map((o) => {
    const hooks = o.brief.hooks.map((h) => h.trim()).filter(Boolean);
    if (hooks.length < 3) throw new Error(`Opportunité « ${o.title} » : il faut 3 hooks`);
    return { ...o, competitor_ads: [...new Set(o.competitor_ads)].filter((id) => known.has(id)), brief: { ...o.brief, hooks: hooks.slice(0, 3) } };
  });
  return { summary: r.summary, opportunities };
}

// ---------------------------------------------------------------------
// Données transmises au modèle pour une recommandation
// ---------------------------------------------------------------------
export interface DimStat {
  key: string;
  spend: number;
  roas: number | null;
  cpa: number | null;
  hook: number | null;
  /** écart à la moyenne du client en % (ROAS, ou CPA inversé) */
  vsAvg: number | null;
}

export interface RecoInput {
  company: string;
  currency?: string;
  period?: string;
  own: {
    angles: DimStat[];
    formats: DimStat[];
    awareness: DimStat[];
    hooks: DimStat[];
    fatigued: { name: string; reason: string }[];
    concepts: number;
    coverage: Record<string, number>;
    baseline?: { roas: number | null; cpa: number | null; hook: number | null };
  };
  competitors: {
    archive_id: string;
    page: string;
    text: string;
    score: number;
    longevity: number | null;
    variants: number;
    tags: Pick<IntelTags, "angle" | "hook_type" | "awareness" | "format"> | null;
  }[];
  gaps: { angles: string[]; awareness: string[]; hookTypes: string[] };
}

// ---------------------------------------------------------------------
// Mode simulé (AI_MOCK=1) : réponses déterministes pour tester sans clé
// ---------------------------------------------------------------------
export function mockTags(item: { id: string; text: string; format?: string | null }): IntelTags {
  const t = item.text.toLowerCase();
  const first = (item.text.split(/(?<=[.!?…])\s/)[0] ?? "").slice(0, 160);
  const hook_type: HookType = /\?/.test(first)
    ? "question"
    : /^[«"]|^(j'|je |mon |ma |mes )/.test(first.toLowerCase())
      ? "temoignage"
      : /-\s?\d+\s?%|offert|remise|promo/.test(t)
        ? "offre"
        : /\d/.test(first)
          ? "chiffre"
          : /pourquoi|secret|pov/.test(t)
            ? "curiosite"
            : /dermato|expert|designer|médecin/.test(t)
              ? "autorite"
              : "promesse";
  const awareness = hook_type === "offre" ? "most" : hook_type === "question" ? "problem" : hook_type === "temoignage" ? "product" : "solution";
  const angle = /avis|clients?|clientes?/.test(t) ? "Preuve sociale" : /-\s?\d+\s?%|offre|promo/.test(t) ? "Promotion" : /main|artisan|atelier/.test(t) ? "Artisanat et fait main" : "Bénéfice produit";
  return {
    angle,
    hook_type,
    hook: first,
    awareness,
    format: (FORMATS as readonly string[]).includes(item.format ?? "") ? (item.format as IntelTags["format"]) : "static",
    promise: "",
    proof: /avis/.test(t) ? "Avis clients" : "",
    offer: /-\s?\d+\s?%/.test(t) ? (/-\s?\d+\s?%/.exec(item.text)?.[0] ?? "") : "",
    cta: "En savoir plus",
    persona: "",
  };
}

export function mockRecommendation(input: RecoInput): Recommendation {
  const top = input.competitors.slice(0, 3);
  const bestAngle = [...input.own.angles].sort((a, b) => (b.vsAvg ?? -999) - (a.vsAvg ?? -999))[0];
  const brief = (title: string, angle: string, awareness: Recommendation["opportunities"][number]["brief"]["awareness"]) => ({
    concept_title: title,
    angle,
    hooks: [`${title} : ce que personne ne te dit`, `J'ai testé ${angle.toLowerCase()} pendant 30 jours`, `Pourquoi ${angle.toLowerCase()} change tout`],
    script: "0-3 s : le hook face caméra.\n3-10 s : le problème.\n10-25 s : la démonstration.\n25-35 s : le résultat et l'appel à l'action.",
    shots: ["Face caméra", "Gros plan produit", "Plan résultat"],
    format: "ugc" as const,
    awareness,
    persona: "",
    cta: "Découvrir",
  });
  const opp = (i: number) => {
    const c = top[i % Math.max(1, top.length)];
    const angle = c?.tags?.angle || bestAngle?.key || "Preuve sociale";
    return {
      title: `[Simulation] Opportunité ${i + 1} : ${angle}`,
      kind: (["counter", "scale", "gap"] as const)[i % 3],
      why: c ? `${c.page} fait tourner cette pub depuis ${c.longevity ?? "?"} jours (${c.variants} variante${c.variants > 1 ? "s" : ""}, score ${c.score}).` : "Réponse simulée sans données concurrentes.",
      evidence: [{ label: "Score concurrent", value: c ? String(c.score) : "–" }],
      competitor_ads: c ? [c.archive_id] : [],
      brief: brief(`Concept ${angle}`, angle, (input.gaps.awareness[0] as Recommendation["opportunities"][number]["brief"]["awareness"]) || "problem"),
    };
  };
  return {
    summary: `[Simulation] Recommandation générée sans appel à l'API pour ${input.company} (AI_MOCK=1).`,
    opportunities: [opp(0), opp(1), opp(2)],
  };
}
