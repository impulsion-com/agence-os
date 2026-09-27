// Types et libellés communs à l'app, à la page publique et au serveur (aucun secret).

import type { Database } from "@/lib/database.types";
import type { Range, Weekly } from "./engine";

type T = Database["public"]["Tables"];
export type BookingProfile = T["booking_profiles"]["Row"];
export type BookingType = T["booking_types"]["Row"];
export type BookingOverride = T["booking_overrides"]["Row"];
export type Booking = T["bookings"]["Row"];

export type LocationKind = "google_meet" | "phone" | "video" | "address";
export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";

export type QuestionType = "text" | "textarea" | "phone" | "url" | "select";
export interface Question {
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
}

export const BUDGET_OPTIONS = ["Moins de 1 000 €", "1 000 à 3 000 €", "3 000 à 10 000 €", "Plus de 10 000 €"];

/** Questions proposées dans l'éditeur (clés réservées : le CRM sait les exploiter) */
export const QUESTION_PRESETS: Question[] = [
  { key: "phone", label: "Téléphone", type: "phone", required: false },
  { key: "company", label: "Entreprise", type: "text", required: false },
  { key: "website", label: "Site web", type: "url", required: false },
  { key: "budget", label: "Budget publicitaire mensuel", type: "select", required: false, options: BUDGET_OPTIONS },
  { key: "message", label: "Qu'aimeriez-vous aborder ?", type: "textarea", required: false },
];

export const QUESTION_TYPES: { id: QuestionType; name: string }[] = [
  { id: "text", name: "Texte court" },
  { id: "textarea", name: "Texte long" },
  { id: "phone", name: "Téléphone" },
  { id: "url", name: "Lien" },
  { id: "select", name: "Liste de choix" },
];

export function readQuestions(v: unknown): Question[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((q): q is Question => !!q && typeof q === "object" && typeof (q as Question).key === "string" && typeof (q as Question).label === "string")
    .map((q) => ({
      key: q.key.slice(0, 40),
      label: q.label.slice(0, 120),
      type: (QUESTION_TYPES.some((t) => t.id === q.type) ? q.type : "text") as QuestionType,
      required: !!q.required,
      options: Array.isArray(q.options) ? q.options.map(String).slice(0, 20) : undefined,
    }));
}

export function readWeekly(v: unknown): Weekly {
  const out: Weekly = {};
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  for (let d = 1; d <= 7; d++) out[String(d)] = Array.isArray(o[String(d)]) ? (o[String(d)] as Range[]) : [];
  return out;
}

export const LOCATIONS: { id: LocationKind; name: string; hint: string }[] = [
  { id: "google_meet", name: "Google Meet", hint: "Lien Meet créé automatiquement (Google Agenda connecté)" },
  { id: "phone", name: "Téléphone", hint: "Tu appelles le prospect au numéro qu'il indique" },
  { id: "video", name: "Visio (lien fixe)", hint: "Zoom, Teams, Whereby… ton lien personnel" },
  { id: "address", name: "Adresse", hint: "Rendez-vous en présentiel" },
];
export const LOCATION: Record<LocationKind, (typeof LOCATIONS)[number]> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l])) as never;

export const STATUS: Record<BookingStatus, { name: string; color: string }> = {
  confirmed: { name: "Confirmé", color: "var(--blue)" },
  completed: { name: "Honoré", color: "var(--green)" },
  no_show: { name: "Absent", color: "var(--amber)" },
  cancelled: { name: "Annulé", color: "var(--gray)" },
};

export const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// ---------------------------------------------------------------------
// Formats de date dans un fuseau donné (fr-FR)
// ---------------------------------------------------------------------
const f = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...o });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtTime = (ms: number | string, tz: string) => f(tz, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
export const fmtDay = (ms: number | string, tz: string, year = false) =>
  cap(f(tz, { weekday: "long", day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) }).format(new Date(ms)));
export const fmtDayShort = (ms: number | string, tz: string) => f(tz, { weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));

/** « Mardi 29 septembre 2026, de 09:30 à 10:00 » */
export const fmtWhen = (start: number | string, end: number | string, tz: string) =>
  `${fmtDay(start, tz, true)}, de ${fmtTime(start, tz)} à ${fmtTime(end, tz)}`;

export const durationLabel = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`);

export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Lien « Ajouter à Google Agenda » (sans compte connecté) */
export function googleCalendarLink(o: { title: string; start: string; end: string; details?: string; location?: string }) {
  const z = (s: string) => new Date(s).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const p = new URLSearchParams({ action: "TEMPLATE", text: o.title, dates: `${z(o.start)}/${z(o.end)}`, details: o.details ?? "", location: o.location ?? "" });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "gclid", "fbclid", "ttclid", "msclkid"] as const;
