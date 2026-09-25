// Outils du module Propositions : statuts, totaux, markdown léger, modèles de départ.
import { Fragment, type ReactNode } from "react";

import { parseDay, today } from "@/lib/format";
import type { Billing, Proposal, ProposalBlock, ProposalItem, ProposalStatus } from "@/lib/types";

// ---------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------
export const PROPOSAL_STATUS: Record<ProposalStatus, { name: string; color: string }> = {
  draft: { name: "Brouillon", color: "var(--gray)" },
  sent: { name: "Envoyée", color: "var(--blue)" },
  viewed: { name: "Vue", color: "var(--violet)" },
  accepted: { name: "Acceptée", color: "var(--green)" },
  declined: { name: "Refusée", color: "var(--red)" },
  expired: { name: "Expirée", color: "var(--amber)" },
};
export const STATUS_ORDER: ProposalStatus[] = ["draft", "sent", "viewed", "accepted", "declined", "expired"];

/** Statut affiché : une proposition envoyée ou vue dont la validité est dépassée est « Expirée ». */
export function effectiveStatus(p: Pick<Proposal, "status" | "valid_until">): ProposalStatus {
  if ((p.status === "sent" || p.status === "viewed") && p.valid_until) {
    const d = parseDay(p.valid_until);
    if (d && d < today()) return "expired";
  }
  return p.status;
}

// ---------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------
export type PriceLine = Pick<ProposalItem, "id" | "quantity" | "unit_price" | "billing" | "optional" | "selected">;

export const lineTotal = (i: Pick<ProposalItem, "quantity" | "unit_price">) =>
  Math.round(Number(i.quantity || 0) * Number(i.unit_price || 0) * 100) / 100;

export interface BillingTotals {
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
  count: number;
}
export interface Totals {
  monthly: BillingTotals;
  one_off: BillingTotals;
  /** Montant des options non retenues (pour information) */
  optionsLeft: number;
}

/**
 * Calcule les totaux. `included(i)` dit si une ligne compte : par défaut les lignes
 * obligatoires et les options cochées (`selected`).
 */
export function computeTotals(
  items: PriceLine[],
  discountPct: number,
  taxPct: number,
  included: (i: PriceLine) => boolean = (i) => !i.optional || i.selected,
): Totals {
  const mk = (b: Billing): BillingTotals => {
    const lines = items.filter((i) => i.billing === b && included(i));
    const subtotal = lines.reduce((s, i) => s + lineTotal(i), 0);
    const discount = round2((subtotal * Number(discountPct || 0)) / 100);
    const net = round2(subtotal - discount);
    const tax = round2((net * Number(taxPct || 0)) / 100);
    return { subtotal: round2(subtotal), discount, net, tax, total: round2(net + tax), count: lines.length };
  };
  const optionsLeft = items.filter((i) => i.optional && !included(i)).reduce((s, i) => s + lineTotal(i), 0);
  return { monthly: mk("monthly"), one_off: mk("one_off"), optionsLeft: round2(optionsLeft) };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export const BILLING_NAME: Record<Billing, string> = { monthly: "Mensuel", one_off: "Ponctuel" };

// ---------------------------------------------------------------------
// Markdown léger : paragraphes, listes (- ou 1.), **gras**, *italique*
// ---------------------------------------------------------------------
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={`${key}-${k++}`}>{m[1]}</strong> : <em key={`${key}-${k++}`}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((l, i) => <li key={i}>{inline(l, `${k}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

// ---------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------
export const uid = () => Math.random().toString(36).slice(2, 10);

export const BLOCK_TYPES: { type: ProposalBlock["type"]; name: string; icon: string; desc: string }[] = [
  { type: "heading", name: "Titre de section", icon: "heading", desc: "Un intertitre" },
  { type: "text", name: "Texte", icon: "text", desc: "Paragraphes, listes, gras" },
  { type: "pricing", name: "Tableau de prix", icon: "receipt", desc: "Les lignes de prix et les totaux" },
  { type: "timeline", name: "Calendrier", icon: "calendar", desc: "Les étapes de la mission" },
  { type: "kpis", name: "Objectifs chiffrés", icon: "target", desc: "Les KPI visés" },
];

export function newBlock(type: ProposalBlock["type"]): ProposalBlock {
  const id = uid();
  switch (type) {
    case "heading":
      return { id, type, text: "" };
    case "text":
      return { id, type, text: "" };
    case "pricing":
      return { id, type };
    case "timeline":
      return { id, type, steps: [{ title: "", detail: "", duration: "" }] };
    case "kpis":
      return { id, type, items: [{ label: "", value: "" }] };
  }
}

// ---------------------------------------------------------------------
// Modèles de départ
// ---------------------------------------------------------------------
export interface TemplateLine {
  service: string; // nom dans le catalogue
  fallback: { description: string; unit_price: number; billing: Billing };
  optional?: boolean;
}
export interface ProposalTemplate {
  id: string;
  name: string;
  icon: string;
  desc: string;
  title: string;
  blocks: () => ProposalBlock[];
  lines: TemplateLine[];
}

const h = (text: string): ProposalBlock => ({ id: uid(), type: "heading", text });
const t = (text: string): ProposalBlock => ({ id: uid(), type: "text", text });
const pricing = (): ProposalBlock => ({ id: uid(), type: "pricing" });
const timeline = (steps: [string, string, string][]): ProposalBlock => ({
  id: uid(),
  type: "timeline",
  steps: steps.map(([title, detail, duration]) => ({ title, detail, duration })),
});
const kpis = (items: [string, string][]): ProposalBlock => ({ id: uid(), type: "kpis", items: items.map(([label, value]) => ({ label, value })) });

const CONDITIONS = t(
  "- Engagement initial de 3 mois, puis mensuel, résiliable avec un préavis de 30 jours.\n" +
    "- Les frais de gestion sont facturés en début de mois, les prestations ponctuelles à la commande.\n" +
    "- Le budget publicitaire est réglé directement par vos soins aux plateformes et n'est pas inclus.\n" +
    "- Vous restez propriétaire de vos comptes publicitaires, de vos données et des créations livrées.",
);

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    id: "meta",
    name: "Gestion Meta Ads",
    icon: "megaphone",
    desc: "Acquisition Facebook et Instagram, créas incluses",
    title: "Gestion Meta Ads",
    lines: [
      { service: "Setup tracking", fallback: { description: "Pixel, API de conversions, GTM et conversions offline", unit_price: 1200, billing: "one_off" } },
      { service: "Gestion Meta Ads", fallback: { description: "Structure, lancement, optimisation hebdomadaire et reporting mensuel", unit_price: 1500, billing: "monthly" } },
      { service: "Production de créas", fallback: { description: "Pack de 10 visuels et 4 vidéos courtes", unit_price: 1400, billing: "monthly" }, optional: true },
    ],
    blocks: () => [
      h("Votre contexte"),
      t("Vous souhaitez faire de Meta (Facebook et Instagram) un canal d'acquisition rentable et prévisible. Aujourd'hui, les campagnes manquent de régularité dans les tests créatifs et le suivi des conversions ne permet pas de piloter au coût par acquisition réel."),
      h("Objectifs"),
      kpis([["Coût par acquisition cible", "À fixer"], ["ROAS visé à 90 jours", "x 3"], ["Nouvelles créas testées par mois", "8"]]),
      h("Notre approche"),
      t("Nous partons de vos données, pas d'une recette toute faite :\n- **Tracking fiable** : Pixel et API de conversions vérifiés avant toute dépense.\n- **Structure simple** : peu de campagnes, des budgets consolidés pour laisser l'algorithme apprendre.\n- **Créa au centre** : 3 angles marketing testés en parallèle, renouvelés toutes les deux semaines.\n- **Pilotage hebdomadaire** : coupes, relances et arbitrages de budget chaque semaine."),
      h("Calendrier"),
      timeline([
        ["Audit et tracking", "Audit du compte, vérification Pixel et API de conversions", "Semaine 1"],
        ["Stratégie créative", "Personas, angles marketing, premiers concepts", "Semaine 2"],
        ["Lancement", "Mise en ligne des campagnes et des premières créas", "Semaine 3"],
        ["Optimisation continue", "Tests créa bimensuels, reporting mensuel", "Mois 2 et suivants"],
      ]),
      h("Investissement"),
      pricing(),
      h("Conditions"),
      CONDITIONS,
    ],
  },
  {
    id: "google",
    name: "Audit + gestion Google Ads",
    icon: "target",
    desc: "Un audit complet puis la gestion Search et Performance Max",
    title: "Audit et gestion Google Ads",
    lines: [
      { service: "Audit publicitaire", fallback: { description: "Audit complet du compte, tracking inclus, restitué en visio", unit_price: 900, billing: "one_off" } },
      { service: "Gestion Google Ads", fallback: { description: "Search, Performance Max et YouTube, optimisation et reporting", unit_price: 1500, billing: "monthly" } },
    ],
    blocks: () => [
      h("Votre contexte"),
      t("Votre compte Google Ads tourne depuis plusieurs mois mais il est difficile de savoir quelles campagnes génèrent réellement des clients. Avant d'augmenter les budgets, il faut remettre à plat le suivi des conversions et la structure."),
      h("Objectifs"),
      kpis([["Part du budget sur des requêtes qualifiées", "> 85 %"], ["Coût par lead", "- 25 %"], ["Délai de restitution de l'audit", "10 jours"]]),
      h("Notre approche"),
      t("**1. Audit** : suivi des conversions, structure, mots-clés et termes de recherche, annonces, pages de destination. Vous recevez un rapport priorisé et une restitution en visio.\n\n**2. Gestion** : nous appliquons les recommandations puis pilotons le compte chaque semaine :\n- nettoyage des termes de recherche et exclusions ;\n- tests d'annonces et de composants ;\n- arbitrages entre Search et Performance Max selon la rentabilité."),
      h("Calendrier"),
      timeline([
        ["Accès et collecte", "Accès Google Ads, GA4 et GTM, questionnaire", "Jours 1 à 3"],
        ["Audit", "Analyse complète et rédaction du rapport", "Jours 4 à 8"],
        ["Restitution", "Présentation du plan d'action priorisé", "Jour 10"],
        ["Gestion", "Mise en œuvre puis optimisation hebdomadaire", "À partir du mois 1"],
      ]),
      h("Investissement"),
      pricing(),
      t("Le montant de l'audit est déduit de la première mensualité si la gestion démarre dans les 30 jours."),
      h("Conditions"),
      CONDITIONS,
    ],
  },
  {
    id: "creative",
    name: "Creative strategy mensuelle",
    icon: "palette",
    desc: "Angles, concepts, scripts UGC et production",
    title: "Creative strategy mensuelle",
    lines: [
      { service: "Creative strategy", fallback: { description: "Recherche d'angles, 8 concepts par mois, scripts UGC et briefs", unit_price: 1800, billing: "monthly" } },
      { service: "Production de créas", fallback: { description: "Pack de 10 visuels et 4 vidéos courtes", unit_price: 1400, billing: "monthly" }, optional: true },
    ],
    blocks: () => [
      h("Votre contexte"),
      t("Vos campagnes plafonnent : les créas s'usent vite et les nouvelles idées manquent. Sur les plateformes actuelles, la créa est devenue le premier levier de ciblage et de performance."),
      h("Objectifs"),
      kpis([["Nouveaux concepts par mois", "8"], ["Taux de créas gagnantes visé", "1 sur 4"], ["Délai brief vers mise en ligne", "10 jours"]]),
      h("Notre approche"),
      t("Chaque mois, un cycle complet :\n1. Analyse des créas gagnantes et perdantes du mois écoulé.\n2. Veille concurrentielle (Ad Library) et recherche d'angles à partir des avis clients.\n3. 8 concepts : hook, angle, format et script.\n4. Briefs créateurs UGC et suivi de production.\n5. Lecture des résultats et décisions pour le cycle suivant."),
      h("Calendrier"),
      timeline([
        ["Recherche", "Analyse du mois, veille, angles", "Semaine 1"],
        ["Concepts et scripts", "8 concepts validés avec vous", "Semaine 2"],
        ["Production", "Tournage UGC, montage, déclinaisons", "Semaine 3"],
        ["Test", "Mise en ligne et lecture des premiers signaux", "Semaine 4"],
      ]),
      h("Investissement"),
      pricing(),
      h("Conditions"),
      CONDITIONS,
    ],
  },
  {
    id: "blank",
    name: "Vierge",
    icon: "file-text",
    desc: "Une page blanche avec un tableau de prix",
    title: "",
    lines: [],
    blocks: () => [h("Votre contexte"), t(""), h("Investissement"), pricing()],
  },
];
