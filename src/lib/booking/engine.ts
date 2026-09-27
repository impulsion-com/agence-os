// Moteur de la prise de rendez-vous : fuseaux horaires (conversions heure locale <-> UTC
// via Intl, sans dépendance) et calcul des créneaux disponibles. Tout est en millisecondes
// UTC ; les plages horaires sont exprimées dans le fuseau du membre et converties jour
// par jour, l'heure d'été est donc gérée date par date.
// Pur (aucun import) : utilisé par le serveur, le navigateur et les tests
// (node --experimental-strip-types --test src/lib/booking/tests/).

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTz(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64) return false;
  try {
    partsFmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** Composantes de l'heure locale d'un instant dans un fuseau. */
export function localParts(ms: number, tz: string) {
  const o: Record<string, number> = {};
  for (const p of partsFmt(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** Décalage (ms) du fuseau par rapport à UTC à un instant donné (Paris l'été : +2 h). */
export function tzOffset(ms: number, tz: string) {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant UTC (ms) d'une heure locale « YYYY-MM-DD » + « HH:MM » dans un fuseau.
 * Heure inexistante (passage à l'heure d'été) : décalée d'une heure plus tard.
 * Heure ambiguë (retour à l'heure d'hiver) : la première occurrence.
 */
export function zonedToUtc(day: string, hhmm: string, tz: string) {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  // Décalages de la veille et du lendemain : couvrent un éventuel changement d'heure ce jour-là
  const before = tzOffset(guess - 864e5, tz);
  const after = tzOffset(guess + 864e5, tz);
  const valid = [guess - before, guess - after].filter((t) => tzOffset(t, tz) === guess - t);
  if (valid.length) return Math.min(...valid);
  return guess - before;
}

/** Jour local « YYYY-MM-DD » d'un instant dans un fuseau. */
export function dayIn(ms: number, tz: string) {
  const p = localParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Heure locale « HH:MM » d'un instant dans un fuseau. */
export function timeIn(ms: number, tz: string) {
  const p = localParts(ms, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** Ajoute des jours à une date « YYYY-MM-DD » (calendrier, sans fuseau). */
export function addDaysStr(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** Jour ISO de la semaine d'une date « YYYY-MM-DD » : 1 = lundi … 7 = dimanche. */
export function isoWeekday(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** « HH:MM » -> minutes depuis minuit */
export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Libellé court d'un fuseau : « Paris (UTC+2) » */
export function tzLabel(tz: string, at = Date.now()) {
  const off = Math.round(tzOffset(at, tz) / 60000);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  const hh = Math.floor(a / 60);
  const mm = a % 60;
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  return `${city} (UTC${sign}${hh}${mm ? ":" + String(mm).padStart(2, "0") : ""})`;
}

export type Range = [string, string];
/** Plages hebdomadaires : clés « 1 » (lundi) à « 7 » (dimanche) */
export type Weekly = Record<string, Range[]>;

export interface Override {
  day_start: string;
  day_end: string;
  /** vide = indisponible toute la journée */
  ranges: Range[];
}

export interface SlotRules {
  duration: number; // minutes
  interval?: number | null; // pas entre deux créneaux (défaut : la durée)
  bufferBefore: number;
  bufferAfter: number;
  minNotice: number; // minutes
  horizonDays: number;
  dailyLimit?: number | null;
}

/** Rendez-vous existant (confirmé) du membre, tampons compris */
export interface Existing {
  start: number;
  end: number;
  bufferBefore?: number;
  bufferAfter?: number;
  /** même type de rendez-vous : compte dans la limite par jour */
  sameType?: boolean;
}

export interface SlotInput {
  tz: string;
  weekly: Weekly;
  overrides?: Override[];
  rules: SlotRules;
  bookings?: Existing[];
  /** occupations externes (Google Agenda freebusy) */
  busy?: { start: number; end: number }[];
  now: number;
  /** restreint le calcul à ces jours (fuseau du membre) */
  days?: string[];
}

const MIN = 60_000;

export const RANGE_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/** Plages valides, triées, sans chevauchement */
export function cleanRanges(ranges: unknown): Range[] {
  if (!Array.isArray(ranges)) return [];
  const ok = ranges
    .filter((r): r is Range => Array.isArray(r) && r.length === 2 && RANGE_RE.test(String(r[0])) && RANGE_RE.test(String(r[1])) && toMin(r[1]) > toMin(r[0]))
    .map((r) => [r[0], r[1]] as Range)
    .sort((a, b) => toMin(a[0]) - toMin(b[0]));
  const out: Range[] = [];
  for (const r of ok) {
    const last = out[out.length - 1];
    if (last && toMin(r[0]) <= toMin(last[1])) {
      if (toMin(r[1]) > toMin(last[1])) last[1] = r[1];
    } else out.push(r);
  }
  return out;
}

/** Plages d'un jour : une exception l'emporte sur l'hebdomadaire */
export function rangesFor(day: string, weekly: Weekly, overrides: Override[] = []): Range[] {
  const o = overrides.find((x) => x.day_start <= day && day <= x.day_end);
  if (o) return cleanRanges(o.ranges);
  return cleanRanges(weekly[String(isoWeekday(day))]);
}

/** Débuts des créneaux libres (ms UTC), triés */
export function computeSlots(input: SlotInput): number[] {
  const { tz, weekly, overrides = [], rules, bookings = [], busy = [], now } = input;
  const dur = rules.duration * MIN;
  const step = Math.max(5, rules.interval || rules.duration) * MIN;
  const bB = rules.bufferBefore * MIN;
  const bA = rules.bufferAfter * MIN;
  const earliest = now + rules.minNotice * MIN;

  const blocks = [
    ...bookings.map((b) => ({ start: b.start - (b.bufferBefore ?? 0) * MIN, end: b.end + (b.bufferAfter ?? 0) * MIN })),
    ...busy,
  ].sort((a, b) => a.start - b.start);

  const perDay = new Map<string, number>();
  if (rules.dailyLimit)
    for (const b of bookings) if (b.sameType) perDay.set(dayIn(b.start, tz), (perDay.get(dayIn(b.start, tz)) ?? 0) + 1);

  const first = dayIn(now, tz);
  const days = input.days ?? Array.from({ length: rules.horizonDays }, (_, i) => addDaysStr(first, i));
  const last = addDaysStr(first, rules.horizonDays - 1);

  const out: number[] = [];
  for (const day of days) {
    if (day < first || day > last) continue;
    if (rules.dailyLimit && (perDay.get(day) ?? 0) >= rules.dailyLimit) continue;
    for (const [a, b] of rangesFor(day, weekly, overrides)) {
      const rs = zonedToUtc(day, a, tz);
      const re = b === "24:00" ? zonedToUtc(addDaysStr(day, 1), "00:00", tz) : zonedToUtc(day, b, tz);
      for (let t = rs; t + dur <= re; t += step) {
        if (t < earliest) continue;
        const s = t - bB;
        const e = t + dur + bA;
        let clash = false;
        for (const k of blocks) {
          if (k.start >= e) break;
          if (s < k.end && e > k.start) {
            clash = true;
            break;
          }
        }
        if (!clash) out.push(t);
      }
    }
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

/** Le créneau demandé est-il encore libre ? (recalcul limité à son jour) */
export function isSlotFree(input: Omit<SlotInput, "days">, start: number) {
  const day = dayIn(start, input.tz);
  return computeSlots({ ...input, days: [day] }).includes(start);
}
