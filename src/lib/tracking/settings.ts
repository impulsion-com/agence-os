// Réglages d'un site suivi (colonne tracking_sites.settings). Pur : client et serveur.

import { MODEL_IDS, WINDOWS, type ModelId } from "./attribution";

export interface SiteSettings {
  window_days: number;
  model: ModelId;
  auto_contacts: boolean;
  consent: "none" | "required";
  capture_forms: boolean;
  demo?: boolean;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  window_days: 30,
  model: "last_click",
  auto_contacts: true,
  consent: "none",
  capture_forms: true,
};

export function readSettings(raw: unknown): SiteSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = Number(s.window_days);
  return {
    window_days: WINDOWS.includes(w) ? w : Number.isFinite(w) && w >= 1 && w <= 365 ? Math.round(w) : DEFAULT_SETTINGS.window_days,
    model: MODEL_IDS.includes(s.model as ModelId) ? (s.model as ModelId) : DEFAULT_SETTINGS.model,
    auto_contacts: s.auto_contacts !== false,
    consent: s.consent === "required" ? "required" : "none",
    capture_forms: s.capture_forms !== false,
    ...(s.demo === true ? { demo: true } : {}),
  };
}

/** Domaine saisi → forme canonique (sans protocole, chemin ni www). */
export function normalizeDomain(d: string) {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "")
    .replace(/:\d+$/, "");
}

export const isDomain = (d: string) => d === "localhost" || /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d) || /^\d{1,3}(\.\d{1,3}){3}$/.test(d);
