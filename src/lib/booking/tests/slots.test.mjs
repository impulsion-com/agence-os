// Tests du moteur de créneaux (fuseaux, heure d'été, tampons, limite par jour, chevauchements).
// Lancer : node --experimental-strip-types --test src/lib/booking/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanRanges, computeSlots, dayIn, isSlotFree, timeIn, tzLabel, zonedToUtc } from "../engine.ts";

const PARIS = "Europe/Paris";
const WEEK = { 1: [["09:00", "12:00"]], 2: [["09:00", "12:00"]], 3: [["09:00", "12:00"]], 4: [["09:00", "12:00"]], 5: [["09:00", "12:00"]], 6: [], 7: [] };
const rules = (o = {}) => ({ duration: 30, bufferBefore: 0, bufferAfter: 0, minNotice: 0, horizonDays: 7, ...o });
const utc = (s) => Date.parse(s);
const hours = (slots, tz = PARIS) => slots.map((t) => timeIn(t, tz));
const onDay = (slots, day, tz = PARIS) => slots.filter((t) => dayIn(t, tz) === day);

test("conversion heure locale -> UTC, été et hiver", () => {
  assert.equal(new Date(zonedToUtc("2026-07-01", "09:00", PARIS)).toISOString(), "2026-07-01T07:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-12-01", "09:00", PARIS)).toISOString(), "2026-12-01T08:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-07-01", "09:00", "America/New_York")).toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-07-01", "09:00", "Asia/Kolkata")).toISOString(), "2026-07-01T03:30:00.000Z");
});

test("heure inexistante (passage à l'heure d'été) décalée d'une heure, heure ambiguë = première", () => {
  // 29 mars 2026 : 02:00 -> 03:00 à Paris
  assert.equal(new Date(zonedToUtc("2026-03-29", "02:30", PARIS)).toISOString(), "2026-03-29T01:30:00.000Z");
  // 25 octobre 2026 : 03:00 -> 02:00, 02:30 existe deux fois (UTC+2 puis UTC+1)
  assert.equal(new Date(zonedToUtc("2026-10-25", "02:30", PARIS)).toISOString(), "2026-10-25T00:30:00.000Z");
});

test("créneaux de base : pas = durée, plages hebdomadaires", () => {
  const now = utc("2026-09-28T05:00:00Z"); // lundi 07:00 à Paris
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 1 }), now });
  assert.deepEqual(hours(s), ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
});

test("pas personnalisé et durée plus longue que le pas", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ duration: 60, interval: 15, horizonDays: 1 }), now });
  assert.equal(hours(s)[0], "09:00");
  assert.equal(hours(s).at(-1), "11:00");
  assert.equal(s.length, 9);
});

test("heure d'été : 09:00 locale reste 09:00 de part et d'autre du changement d'heure", () => {
  // Vendredi 23 octobre -> lundi 26 octobre 2026 (retour à l'heure d'hiver le dimanche 25)
  const now = utc("2026-10-23T04:00:00Z");
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 4 }), now });
  const fri = onDay(s, "2026-10-23");
  const mon = onDay(s, "2026-10-26");
  assert.equal(new Date(fri[0]).toISOString(), "2026-10-23T07:00:00.000Z");
  assert.equal(new Date(mon[0]).toISOString(), "2026-10-26T08:00:00.000Z");
  assert.equal(timeIn(fri[0], PARIS), "09:00");
  assert.equal(timeIn(mon[0], PARIS), "09:00");
  // Mars : passage à l'heure d'été
  const s2 = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 4 }), now: utc("2026-03-27T04:00:00Z") });
  assert.equal(new Date(onDay(s2, "2026-03-27")[0]).toISOString(), "2026-03-27T08:00:00.000Z");
  assert.equal(new Date(onDay(s2, "2026-03-30")[0]).toISOString(), "2026-03-30T07:00:00.000Z");
});

test("plage de nuit qui traverse un changement d'heure : durée réelle respectée", () => {
  const weekly = { 7: [["01:00", "04:00"]] };
  const s = computeSlots({ tz: PARIS, weekly, rules: rules({ duration: 60, horizonDays: 1 }), now: utc("2026-03-28T23:30:00Z") });
  // Le 29 mars, 01:00 -> 04:00 locale ne dure que 2 h réelles : 2 créneaux d'une heure
  assert.equal(s.length, 2);
  assert.deepEqual(hours(s), ["01:00", "03:00"]);
});

test("fuseau du visiteur : mêmes instants, heures affichées différentes", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 1 }), now });
  assert.equal(timeIn(s[0], "America/Montreal"), "03:00");
  assert.equal(timeIn(s[0], "Indian/Reunion"), "11:00");
  assert.match(tzLabel(PARIS, s[0]), /Paris \(UTC\+2\)/);
});

test("délai minimum de réservation", () => {
  const now = utc("2026-09-28T08:10:00Z"); // lundi 10:10 à Paris
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ minNotice: 60, horizonDays: 1 }), now });
  assert.deepEqual(hours(s), ["11:30"]);
});

test("horizon : pas de créneau au-delà", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 3 }), now });
  assert.deepEqual([...new Set(s.map((t) => dayIn(t, PARIS)))], ["2026-09-28", "2026-09-29", "2026-09-30"]);
});

test("chevauchement avec un rendez-vous existant", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const bookings = [{ start: utc("2026-09-28T08:00:00Z"), end: utc("2026-09-28T08:30:00Z") }]; // 10:00-10:30
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 1 }), bookings, now });
  assert.deepEqual(hours(s), ["09:00", "09:30", "10:30", "11:00", "11:30"]);
});

test("tampons avant/après du type et du rendez-vous existant", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const bookings = [{ start: utc("2026-09-28T08:00:00Z"), end: utc("2026-09-28T08:30:00Z"), bufferAfter: 15 }];
  // Tampon après de 10 min sur le type : 09:30 finirait à 10:00 + 10 min -> conflit
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 1, bufferAfter: 10 }), bookings, now });
  assert.deepEqual(hours(s), ["09:00", "11:00", "11:30"]);
  // Tampon avant de 5 min : 10:30 démarre 5 min avant, dans le tampon de 15 min du rendez-vous existant -> conflit
  const s2 = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 1, bufferBefore: 5 }), bookings, now });
  assert.deepEqual(hours(s2), ["09:00", "09:30", "11:00", "11:30"]);
});

test("occupations Google Agenda", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const busy = [{ start: utc("2026-09-28T07:15:00Z"), end: utc("2026-09-28T07:45:00Z") }]; // 09:15-09:45
  const s = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 1 }), busy, now });
  assert.deepEqual(hours(s), ["10:00", "10:30", "11:00", "11:30"]);
});

test("limite par jour : seuls les rendez-vous du même type comptent", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const other = { start: utc("2026-09-28T09:30:00Z"), end: utc("2026-09-28T10:00:00Z"), sameType: false };
  const same = { start: utc("2026-09-28T07:00:00Z"), end: utc("2026-09-28T07:30:00Z"), sameType: true };
  const s1 = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 2, dailyLimit: 1 }), bookings: [other], now });
  // Le rendez-vous d'un autre type bloque seulement son créneau (11:30), pas la journée
  assert.deepEqual(hours(onDay(s1, "2026-09-28")), ["09:00", "09:30", "10:00", "10:30", "11:00"]);
  const s2 = computeSlots({ tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 2, dailyLimit: 1 }), bookings: [same], now });
  assert.equal(onDay(s2, "2026-09-28").length, 0);
  assert.equal(onDay(s2, "2026-09-29").length, 6);
});

test("exceptions : congés et horaires spéciaux", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const overrides = [
    { day_start: "2026-09-29", day_end: "2026-09-30", ranges: [] },
    { day_start: "2026-10-03", day_end: "2026-10-03", ranges: [["14:00", "15:00"]] }, // un samedi exceptionnel
  ];
  const s = computeSlots({ tz: PARIS, weekly: WEEK, overrides, rules: rules({ horizonDays: 7 }), now });
  const days = [...new Set(s.map((t) => dayIn(t, PARIS)))];
  assert.deepEqual(days, ["2026-09-28", "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(hours(onDay(s, "2026-10-03")), ["14:00", "14:30"]);
});

test("plages invalides ou qui se chevauchent", () => {
  assert.deepEqual(cleanRanges([["14:00", "12:00"], ["09:00", "11:00"], ["10:30", "12:00"], ["25:00", "26:00"], "x"]), [["09:00", "12:00"]]);
  assert.deepEqual(cleanRanges([["18:00", "24:00"]]), [["18:00", "24:00"]]);
});

test("validation d'un créneau précis (anti-réservation hors plage)", () => {
  const now = utc("2026-09-28T05:00:00Z");
  const input = { tz: PARIS, weekly: WEEK, rules: rules({ horizonDays: 7 }), now };
  assert.equal(isSlotFree(input, utc("2026-09-29T07:30:00Z")), true); // mardi 09:30
  assert.equal(isSlotFree(input, utc("2026-09-29T07:40:00Z")), false); // pas aligné
  assert.equal(isSlotFree(input, utc("2026-10-03T07:30:00Z")), false); // samedi
  assert.equal(isSlotFree({ ...input, bookings: [{ start: utc("2026-09-29T07:30:00Z"), end: utc("2026-09-29T08:00:00Z") }] }, utc("2026-09-29T07:30:00Z")), false);
});
