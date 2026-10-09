// Téléphone → format international sans « + » (33612345678), pour rapprocher une personne
// d'un appareil à l'autre et, plus tard, pour l'envoi haché aux régies. Pur : client et serveur.

// Indicatif, et présence d'un 0 initial à retirer dans l'écriture nationale.
const COUNTRIES: Record<string, { cc: string; trunk?: boolean }> = {
  FR: { cc: "33", trunk: true },
  BE: { cc: "32", trunk: true },
  CH: { cc: "41", trunk: true },
  LU: { cc: "352" },
  MC: { cc: "377" },
  CA: { cc: "1" },
  US: { cc: "1" },
  GB: { cc: "44", trunk: true },
  DE: { cc: "49", trunk: true },
  NL: { cc: "31", trunk: true },
  ES: { cc: "34" },
  PT: { cc: "351" },
  IT: { cc: "39" },
  MA: { cc: "212", trunk: true },
  DZ: { cc: "213", trunk: true },
  TN: { cc: "216" },
  SN: { cc: "221" },
  CI: { cc: "225" },
  MU: { cc: "230" },
  RE: { cc: "262", trunk: true },
  GP: { cc: "590", trunk: true },
  GF: { cc: "594", trunk: true },
  MQ: { cc: "596", trunk: true },
};

// Outre-mer saisi depuis la métropole : le numéro national porte déjà l'indicatif (0692… → 262 692…)
const FR_OVERSEAS: [RegExp, string][] = [
  [/^(262|263|692|693)/, "262"],
  [/^(590|690|691)/, "590"],
  [/^(594|694)/, "594"],
  [/^(596|696|697)/, "596"],
];

/** Rend null si le numéro n'est pas exploitable. `country` (ISO 2 lettres) sert aux numéros écrits sans indicatif. */
export function normalizePhone(raw: string | null | undefined, country: string | null = "FR"): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\(0\)/g, "");
  const intl = s.startsWith("+") || s.startsWith("00");
  let d = s.replace(/\D/g, "");
  if (s.startsWith("00")) d = d.slice(2);
  if (!intl) {
    const c = COUNTRIES[(country ?? "").toUpperCase()] ?? COUNTRIES.FR;
    const national = c.trunk && d.startsWith("0");
    if (national) d = d.slice(1);
    // Indicatif déjà présent sans « + » (33612345678) : on ne le double pas
    const already = !national && d.startsWith(c.cc) && d.length >= c.cc.length + 8;
    if (!already) {
      const over = c.cc === "33" ? FR_OVERSEAS.find(([re]) => re.test(d)) : undefined;
      d = (over ? over[1] : c.cc) + d;
    }
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}
