// Outils du module CRM : libellés, calculs du pipeline, formats.
import { useState } from "react";

import { COLORS } from "@/lib/constants";
import { DAY, money, parseDay, today, diffDays } from "@/lib/format";
import type { Company, Contact, CrmActivity, Deal, PipelineStage } from "@/lib/types";

export const COMPANY_STATUS: Record<Company["status"], { name: string; color: string }> = {
  lead: { name: "Prospect", color: "var(--blue)" },
  client: { name: "Client", color: "var(--green)" },
  former: { name: "Ancien client", color: "var(--gray)" },
};
export const COMPANY_STATUSES = (["lead", "client", "former"] as const).map((id) => ({ id, ...COMPANY_STATUS[id] }));

export const ACTIVITY_KINDS: { id: CrmActivity["kind"]; name: string; icon: string; verb: string }[] = [
  { id: "note", name: "Note", icon: "note", verb: "a ajouté une note" },
  { id: "call", name: "Appel", icon: "phone", verb: "a noté un appel" },
  { id: "email", name: "Email", icon: "mail", verb: "a noté un email" },
  { id: "meeting", name: "Rendez-vous", icon: "calendar", verb: "a noté un rendez-vous" },
  { id: "task", name: "À faire", icon: "check", verb: "a créé une relance" },
];
export const ACTIVITY_KIND = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k.id, k])) as Record<CrmActivity["kind"], (typeof ACTIVITY_KINDS)[number]>;

export const LOST_REASONS = ["Budget insuffisant", "Mauvais timing", "Concurrent choisi", "Plus de réponse", "Fait en interne", "Hors cible"];

export const contactName = (c: Pick<Contact, "first_name" | "last_name"> | null | undefined) =>
  c ? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Sans nom" : "";

export function dealAmount(d: Pick<Deal, "value" | "billing">, currency = "EUR") {
  return money(d.value, currency) + (d.billing === "monthly" ? " /mois" : "");
}

export const stageOf = (stages: PipelineStage[], id: string | null | undefined) => stages.find((s) => s.id === id);

export const isClosingOverdue = (d: Pick<Deal, "expected_close" | "closed_at">) =>
  !d.closed_at && !!d.expected_close && diffDays(parseDay(d.expected_close)!, today()) < 0;

export interface PipelineStats {
  open: number;
  openCount: number;
  weighted: number;
  mrr: number;
  wonCount: number;
  conversion: number | null;
  closedCount: number;
  cycle: number | null;
}

export function pipelineStats(deals: Deal[], stages: PipelineStage[]): PipelineStats {
  const kind = (d: Deal) => stageOf(stages, d.stage_id)?.kind ?? "open";
  const open = deals.filter((d) => kind(d) === "open");
  const won = deals.filter((d) => kind(d) === "won");
  const lost = deals.filter((d) => kind(d) === "lost");
  const cycles = won
    .filter((d) => d.closed_at)
    .map((d) => (new Date(d.closed_at!).getTime() - new Date(d.created_at).getTime()) / DAY)
    .filter((n) => n >= 0);
  return {
    open: open.reduce((s, d) => s + Number(d.value), 0),
    openCount: open.length,
    weighted: open.reduce((s, d) => s + (Number(d.value) * (stageOf(stages, d.stage_id)?.probability ?? 0)) / 100, 0),
    mrr: won.filter((d) => d.billing === "monthly").reduce((s, d) => s + Number(d.value), 0),
    wonCount: won.length,
    conversion: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : null,
    closedCount: won.length + lost.length,
    cycle: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
  };
}

// État local initialisé depuis les props et resynchronisé quand le serveur renvoie de nouvelles données.
export function useSynced<T>(value: T) {
  const [state, setState] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setState(value);
  }
  return [state, setState] as const;
}

export function normalizeUrl(u: string) {
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}
export const prettyUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/$/, "");

// Date « jour » → horodatage à 9 h locale (échéance des relances)
export const dayToTs = (d: string | null) => (d ? new Date(`${d}T09:00:00`).toISOString() : null);
export const tsToDay = (ts: string | null) => {
  if (!ts) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Clé de projet dérivée d'un nom (2 à 6 caractères A-Z0-9), unique dans l'espace
export function projectKeyFor(name: string, taken: string[]) {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "CLI").slice(0, 4);
  if (base.length < 2) base = (base + "CL").slice(0, 3);
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base.slice(0, 5)}${i++}`.slice(0, 6);
  return key;
}

// Couleur stable dérivée d'un nom (nouvelles entreprises)
export function colorForName(name: string) {
  const palette = Object.values(COLORS).slice(0, 10);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
