// Signature électronique des propositions : types et textes partagés client / serveur.
import { money } from "@/lib/format";
import type { Billing, ProposalBlock } from "@/lib/types";

export type SignatureMethod = "drawn" | "typed";

export interface SnapshotItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unit_price: number;
  billing: Billing;
  optional: boolean;
  selected: boolean;
  position: number;
}

export interface SnapshotTotals {
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
  count: number;
}

/**
 * Instantané figé à la signature. Son empreinte SHA-256 (JSON canonique, clés triées)
 * est `document_hash` : toute modification du contenu signé la change.
 */
export interface SignatureSnapshot {
  v: 1;
  proposal_id: string;
  document: {
    number: number;
    title: string;
    currency: string;
    discount_pct: number;
    tax_pct: number;
    valid_until: string | null;
    date: string;
    blocks: ProposalBlock[];
  };
  items: SnapshotItem[];
  totals: { monthly: SnapshotTotals; one_off: SnapshotTotals };
  parties: {
    agency: string;
    client: string | null;
    contact: string | null;
    owner: { full_name: string; email: string; title: string } | null;
  };
  signer: {
    first_name: string;
    last_name: string;
    role: string;
    company: string;
    email: string;
    email_verified: boolean;
    email_verified_at: string | null;
  };
  signature: { method: SignatureMethod; image_sha256: string };
  mention: string;
  consent: string;
  signed_at: string;
}

/** Ce que la page publique reçoit d'une proposition signée (sans IP ni chemin de stockage). */
export interface PublicSignature {
  signed_at: string;
  signer_name: string;
  signer_role: string;
  signer_company: string;
  method: SignatureMethod;
  document_hash: string;
  email_verified: boolean;
  countersign_required: boolean;
  countersigned_at: string | null;
  countersigner_name: string | null;
  countersigner_role: string | null;
  image: string | null;
  agency_image: string | null;
  has_pdf: boolean;
}

export const MENTION = "Bon pour accord";

/** La mention recopiée est acceptée sans tenir compte de la casse, des accents ni de la ponctuation. */
export const mentionOk = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim() === "bon pour accord";

/** Montants engagés, en toutes lettres pour le consentement. */
export function amountsText(totals: { monthly: SnapshotTotals; one_off: SnapshotTotals }, currency: string) {
  const parts: string[] = [];
  if (totals.monthly.count) parts.push(`${money(totals.monthly.net, currency, 2)} HT par mois (${money(totals.monthly.total, currency, 2)} TTC)`);
  if (totals.one_off.count) parts.push(`${money(totals.one_off.net, currency, 2)} HT en une fois (${money(totals.one_off.total, currency, 2)} TTC)`);
  return parts.length ? parts.join(" et ") : "aucun montant";
}

/**
 * Texte exact du consentement, reconstruit côté serveur à l'identique et conservé
 * dans le dossier de preuve.
 */
export function consentText(o: {
  first_name: string;
  last_name: string;
  role: string;
  company: string;
  number: number;
  title: string;
  agency: string;
  amounts: string;
}) {
  const who = `${o.first_name.trim()} ${o.last_name.trim()}`.trim();
  const role = o.role.trim() ? `, ${o.role.trim()}` : "";
  const company = o.company.trim() ? ` de la société ${o.company.trim()}` : "";
  return (
    `Je soussigné(e) ${who}${role}${company}, déclare avoir lu la proposition commerciale n° ${o.number} « ${o.title} » ` +
    `émise par ${o.agency} et l'accepter, options retenues comprises, soit ${o.amounts}. ` +
    `J'accepte de la signer électroniquement et reconnais que cette signature m'engage au même titre qu'une signature manuscrite.`
  );
}

/** Libellés de la piste d'audit. */
export const EVENT_LABEL: Record<string, string> = {
  sent: "Proposition envoyée",
  email_sent: "Email d'envoi expédié",
  reminder_sent: "Relance expédiée",
  opened: "Ouverture de la proposition",
  otp_sent: "Code de vérification envoyé",
  otp_failed: "Code de vérification erroné",
  otp_verified: "Adresse email vérifiée",
  signed: "Proposition signée",
  pdf_generated: "PDF signé généré",
  countersigned: "Contre-signée par l'agence",
  declined: "Proposition refusée",
  emails_sent: "Confirmations envoyées",
};

/** Date et heure de Paris, lisibles. */
export function fmtParis(ts: string | Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}
