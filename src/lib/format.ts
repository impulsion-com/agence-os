// Dates et montants au format français. Les dates « jour » sont des chaînes ISO yyyy-mm-dd.

export const DAY = 864e5;
const MON = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const WD = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
export const WDL = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export const sod = (d: Date | string | number) => {
  const x = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? parseDay(d)! : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const today = () => sod(new Date());
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const dayOffset = (n: number) => iso(addDays(today(), n));
export const diffDays = (a: Date, b: Date) => Math.round((sod(a).getTime() - sod(b).getTime()) / DAY);

export function fmtDate(s: string | Date | null | undefined, long = false) {
  const d = typeof s === "string" ? parseDay(s) : s;
  if (!d) return "";
  const y = long || d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MON[d.getMonth()]}${y}`;
}

export function relDate(s: string | null | undefined) {
  const d = parseDay(s);
  if (!d) return "";
  const n = diffDays(d, today());
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return "Demain";
  if (n === -1) return "Hier";
  if (n > 1 && n < 7) return WDL[d.getDay()].replace(/^./, (c) => c.toUpperCase());
  return fmtDate(d);
}

export function ago(ts: string | number | Date) {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 6e4);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return fmtDate(new Date(ts));
}

export function dayBucket(ts: string) {
  const n = diffDays(new Date(ts), today());
  if (n === 0) return "Aujourd'hui";
  if (n === -1) return "Hier";
  if (n > -7) return "Cette semaine";
  return "Plus ancien";
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

export function money(v: number | null | undefined, currency = "EUR", decimals = 0) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(v ?? 0));
}

export const num = (v: number | null | undefined, decimals = 0) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(v ?? 0));

export const pct = (v: number | null | undefined, decimals = 1) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(v ?? 0))} %`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function fileSize(b: number) {
  if (b < 1024) return `${b} o`;
  if (b < 1048576) return `${Math.round(b / 1024)} Ko`;
  return `${(b / 1048576).toFixed(1)} Mo`;
}

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
