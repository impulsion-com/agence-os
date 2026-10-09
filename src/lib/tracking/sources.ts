// Sources de conversions hors script : webhook générique et import CSV. Pur : client et serveur.

// Chemin relatif avec extension : ce module est aussi chargé tel quel par les tests (node --experimental-strip-types)
import { parseDate, parseNumber, splitLine } from "../ads/csv.ts";

/** Une conversion prête pour recordConversion (voir ingest.ts). */
export interface SourceRow {
  email?: string;
  phone?: string;
  name?: string;
  type: string;
  value?: number;
  currency?: string;
  order_id?: string;
  ts?: string;
}

// =====================================================================
// Webhook générique : n'importe quel outil qui sait envoyer du JSON
// =====================================================================

export type WebhookField = "email" | "phone" | "name" | "value" | "id" | "date" | "currency";
export const WEBHOOK_FIELDS: WebhookField[] = ["email", "phone", "name", "value", "id", "date", "currency"];

/** Réglages connus pour les outils dont le format est stable. `paths` va dans l'URL du webhook. */
export const WEBHOOK_PRESETS: { id: string; name: string; type: string; paths: Partial<Record<WebhookField, string>>; note: string }[] = [
  {
    id: "calcom",
    name: "Cal.com",
    type: "booking",
    paths: { email: "payload.attendees.0.email", name: "payload.attendees.0.name", id: "payload.uid", date: "createdAt" },
    note: "Cal.com > Paramètres > Développeur > Webhooks. Ne coche que « Réservation créée » : sans chemin, l'email trouvé serait celui de l'organisateur.",
  },
  {
    id: "calendly",
    name: "Calendly",
    type: "booking",
    paths: { email: "payload.email", name: "payload.name", id: "payload.uri", date: "created_at" },
    note: "Calendly > Intégrations > Webhooks (offre payante), évènement « invitee.created ».",
  },
  {
    id: "other",
    name: "Un CRM ou un autre outil",
    type: "",
    paths: {},
    note: "Sans chemin, l'email, le téléphone, le montant et l'identifiant sont cherchés par leur nom dans les données reçues. Si ton outil envoie plusieurs emails, indique le bon chemin.",
  },
];

// Noms de champ reconnus quand aucun chemin n'est donné (comparés sans casse ni séparateur)
const GUESS: Record<WebhookField, string[]> = {
  email: ["email", "emailaddress", "customeremail", "contactemail", "mail", "courriel"],
  phone: ["phone", "phonenumber", "mobile", "mobilephone", "telephone", "tel", "customerphone"],
  name: ["fullname", "name", "customername", "contactname", "nom"],
  value: ["value", "amount", "total", "price", "dealvalue", "montant", "revenue"],
  id: ["id", "orderid", "dealid", "uid", "uuid", "eventid", "reference"],
  date: ["date", "createdat", "created", "timestamp", "closedat", "wonat"],
  currency: ["currency", "devise"],
};

const flat = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const leaf = (v: unknown): string | undefined => (typeof v === "string" ? v.trim() || undefined : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

/** Valeur au bout d'un chemin pointé (payload.attendees.0.email). */
export function atPath(data: unknown, path: string): string | undefined {
  let cur: unknown = data;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return leaf(cur);
}

/** Première feuille dont la clé porte un des noms attendus, en largeur d'abord (le champ le plus proche de la racine gagne). */
function guess(data: unknown, names: string[]): string | undefined {
  let level: unknown[] = [data];
  for (let depth = 0; depth < 6 && level.length; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (node === null || typeof node !== "object") continue;
      for (const name of names)
        for (const [k, v] of Object.entries(node)) if (flat(k) === name && leaf(v) !== undefined) return leaf(v);
      next.push(...Object.values(node));
    }
    level = next;
  }
  return undefined;
}

/**
 * Lit une conversion dans un JSON quelconque. `paths` : chemins fournis dans l'URL du webhook ;
 * un champ sans chemin est cherché par son nom. Rend null sans email ni téléphone.
 */
export function readWebhook(data: unknown, type: string, paths: Partial<Record<WebhookField, string>> = {}): SourceRow | null {
  const get = (f: WebhookField) => (paths[f] ? atPath(data, paths[f]) : guess(data, GUESS[f]));
  const email = get("email");
  const phone = get("phone");
  if (!email && !phone) return null;
  const value = get("value");
  const n = value === undefined ? null : parseNumber(value);
  const currency = get("currency")?.toUpperCase();
  return {
    email,
    phone,
    name: get("name"),
    type,
    value: n === null ? undefined : n,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    order_id: get("id")?.slice(0, 120),
    ts: get("date"),
  };
}

/** URL à coller dans l'outil source. La clé reste à remplacer par une clé d'envoi du site. */
export function webhookUrl(appUrl: string, key: string, type: string, paths: Partial<Record<WebhookField, string>> = {}) {
  const q = new URLSearchParams({ key, type });
  for (const f of WEBHOOK_FIELDS) if (paths[f]) q.set(f, paths[f] as string);
  return `${appUrl}/api/t/webhooks/in?${q.toString().replace(/%2E/gi, ".")}`;
}

// =====================================================================
// Import CSV : conversions hors ligne
// =====================================================================

type CsvField = "email" | "phone" | "name" | "type" | "value" | "currency" | "order_id" | "date";

const CSV_ALIASES: Record<CsvField, string[]> = {
  email: ["email", "e-mail", "mail", "adresse email", "adresse e-mail", "courriel"],
  phone: ["téléphone", "telephone", "tel", "tél", "phone", "mobile", "portable"],
  name: ["nom", "name", "nom complet", "client", "contact"],
  type: ["type", "étape", "etape", "évènement", "evenement", "event", "statut", "stage"],
  value: ["valeur", "value", "montant", "amount", "ca", "chiffre d'affaires", "prix", "total"],
  currency: ["devise", "currency"],
  order_id: ["order_id", "id", "identifiant", "référence", "reference", "commande", "numéro", "numero", "n°"],
  date: ["date", "jour", "date de vente", "date de signature", "created_at", "closed_at"],
};

export interface CsvImport {
  rows: SourceRow[];
  errors: string[];
  /** En-tête du fichier reconnu pour chaque champ (null : colonne absente). */
  columns: Record<CsvField, string | null>;
}

const head = (s: string) => s.trim().toLowerCase().replace(/^﻿/, "");

/** `defaultType` sert aux fichiers sans colonne « type » (une étape par fichier). */
export function parseConversionsCsv(text: string, defaultType: string): CsvImport {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const columns = { email: null, phone: null, name: null, type: null, value: null, currency: null, order_id: null, date: null } as CsvImport["columns"];
  if (lines.length < 2) return { rows: [], errors: ["Le fichier doit contenir une ligne d'en-têtes et au moins une ligne de données."], columns };
  const first = lines[0];
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const raw = splitLine(first, sep);
  const heads = raw.map(head);
  const idx = {} as Record<CsvField, number>;
  for (const f of Object.keys(CSV_ALIASES) as CsvField[]) {
    idx[f] = heads.findIndex((h) => CSV_ALIASES[f].includes(h));
    columns[f] = idx[f] >= 0 ? raw[idx[f]] : null;
  }
  const errors: string[] = [];
  if (idx.email < 0 && idx.phone < 0) errors.push("Il faut une colonne « email » ou « téléphone » pour rattacher chaque ligne à une personne.");
  if (idx.type < 0 && !defaultType) errors.push("Colonne « type » introuvable : choisis l'étape à laquelle rattacher ce fichier.");
  if (errors.length) return { rows: [], errors, columns };

  const note = (m: string) => errors.length < 8 && errors.push(m);
  const rows: SourceRow[] = [];
  lines.slice(1).forEach((line, n) => {
    const cells = splitLine(line, sep);
    const cell = (f: CsvField) => (idx[f] >= 0 ? (cells[idx[f]] ?? "").trim() : "");
    const email = cell("email").toLowerCase();
    const phone = cell("phone");
    if (!email && !phone) return note(`Ligne ${n + 2} : ni email ni téléphone.`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return note(`Ligne ${n + 2} : email illisible (« ${email} »).`);
    const type = cell("type") || defaultType;
    if (!type) return note(`Ligne ${n + 2} : type vide.`);
    let value: number | undefined;
    if (cell("value")) {
      const v = parseNumber(cell("value"));
      if (v === null) return note(`Ligne ${n + 2} : montant illisible (« ${cell("value")} »).`);
      value = v;
    }
    let day: string | undefined;
    if (cell("date")) {
      const d = parseDate(cell("date"));
      if (!d) return note(`Ligne ${n + 2} : date illisible (« ${cell("date")} »).`);
      day = d;
    }
    const currency = cell("currency").toUpperCase();
    rows.push({
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(cell("name") ? { name: cell("name") } : {}),
      type,
      value,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
      // Sans identifiant dans le fichier, la ligne elle-même en tient lieu : réimporter le même fichier ne double rien
      order_id: (cell("order_id") || `csv:${email || phone}|${type}|${day ?? ""}|${value ?? ""}`).slice(0, 120),
      // Midi UTC : la conversion tombe le bon jour quel que soit le fuseau du lecteur
      ts: day ? `${day}T12:00:00Z` : undefined,
    });
  });
  if (!rows.length && !errors.length) errors.push("Aucune ligne exploitable.");
  return { rows, errors, columns };
}

export const CONVERSIONS_CSV_TEMPLATE =
  "email;téléphone;type;valeur;date;identifiant\nclaire@exemple.fr;06 12 34 56 78;purchase;1490;2026-09-12;FAC-0412\n;+33 7 98 76 54 32;show;;2026-09-14;\n";
