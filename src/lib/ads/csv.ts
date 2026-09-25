// Import CSV de secours (régies non connectées : TikTok, LinkedIn…). Pur, côté client.

import type { FetchedRow } from "./types";

export interface CsvResult {
  rows: FetchedRow[];
  errors: string[];
  columns: Record<Field, string | null>;
}

type Field = "date" | "campaign" | "spend" | "impressions" | "clicks" | "conversions" | "value";

const ALIASES: Record<Field, string[]> = {
  date: ["date", "jour", "day", "date de début", "reporting starts", "by day"],
  campaign: ["campagne", "campaign", "campaign name", "nom de la campagne", "campagne publicitaire"],
  spend: ["dépense", "depense", "dépenses", "spend", "cost", "coût", "cout", "amount spent", "montant dépensé", "montant depense", "budget dépensé"],
  impressions: ["impressions", "impr.", "impr"],
  clicks: ["clics", "clicks", "clic", "clics (tous)", "link clicks", "clics sur un lien"],
  conversions: ["conversions", "conv.", "conv", "résultats", "resultats", "results", "leads", "achats", "purchases"],
  value: ["valeur", "value", "conversion value", "valeur de conversion", "valeur de conv.", "revenue", "chiffre d'affaires", "ca"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/^﻿/, "").replace(/\s*\(.*?\)\s*$/, (m) => (m.includes("tous") ? m : "")).trim();

/** Découpe une ligne CSV (guillemets gérés). */
function splitLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** 1 234,56 / 1,234.56 / 1234.56 / 12,5 € → nombre. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[€$£%\s  ]|EUR|USD|CHF/gi, "");
  if (!s || s === "-" || s === "–") return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // 1,234 (milliers anglais) vs 12,5 (décimale française)
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 2026-09-01 / 01/09/2026 / 01.09.2026 / 1/9/26 → 2026-09-01 (format jour/mois). */
export function parseDate(raw: string): string | null {
  const s = raw.trim().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

export const campaignKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "sans-nom";

export function parseCsv(text: string): CsvResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const columns = { date: null, campaign: null, spend: null, impressions: null, clicks: null, conversions: null, value: null } as CsvResult["columns"];
  if (lines.length < 2) return { rows: [], errors: ["Le fichier doit contenir une ligne d'en-têtes et au moins une ligne de données."], columns };
  const first = lines[0];
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(first, sep).map(norm);
  const idx = {} as Record<Field, number>;
  for (const f of Object.keys(ALIASES) as Field[]) {
    const i = head.findIndex((h) => ALIASES[f].includes(h));
    idx[f] = i;
    columns[f] = i >= 0 ? splitLine(first, sep)[i] : null;
  }
  const errors: string[] = [];
  if (idx.date < 0) errors.push("Colonne « date » introuvable.");
  if (idx.spend < 0) errors.push("Colonne « dépense » introuvable.");
  if (errors.length) return { rows: [], errors, columns };

  const rows: FetchedRow[] = [];
  lines.slice(1).forEach((line, n) => {
    const cells = splitLine(line, sep);
    const date = parseDate(cells[idx.date] ?? "");
    if (!date) {
      if (/total/i.test(line)) return; // ligne de total des exports
      if (errors.length < 8) errors.push(`Ligne ${n + 2} : date illisible (« ${cells[idx.date] ?? ""} »).`);
      return;
    }
    const get = (f: Field) => (idx[f] >= 0 ? parseNumber(cells[idx[f]] ?? "") : 0);
    const spend = get("spend");
    if (spend === null) {
      if (errors.length < 8) errors.push(`Ligne ${n + 2} : dépense illisible.`);
      return;
    }
    const name = (idx.campaign >= 0 ? cells[idx.campaign] : "") || "Toutes les campagnes";
    rows.push({
      date,
      campaign_id: campaignKey(name),
      campaign_name: name,
      spend,
      impressions: Math.round(get("impressions") ?? 0),
      clicks: Math.round(get("clicks") ?? 0),
      conversions: get("conversions") ?? 0,
      conversion_value: get("value") ?? 0,
    });
  });
  if (!rows.length && !errors.length) errors.push("Aucune ligne exploitable.");
  return { rows, errors, columns };
}

export const CSV_TEMPLATE =
  "date;campagne;dépense;impressions;clics;conversions;valeur\n2026-09-01;Prospection vidéo;120,50;15400;210;6;540\n2026-09-02;Prospection vidéo;118,20;14900;198;5;450\n";
