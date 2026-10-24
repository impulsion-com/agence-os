// Nomenclature des annonces : lire des propriétés (format, angle, accroche, créateur…) dans le nom
// d'une annonce, pour comparer les créas sans lier chaque annonce à un concept.
// Deux styles, comme les outils du marché :
//  - préfixes (façon Motion) : « F:UGC | A:Routine | H:Problème | Routine du soir » ;
//  - positions (façon Creaboost) : « UGC_Routine_Problème_V2 », le 1er champ est le format, etc.
// Module pur, sans import d'exécution : testé par src/lib/creatives/tests/naming.test.mjs.

export interface NamingField {
  /** Préfixe (mode préfixes, ex. « F ») ou position à partir de 1 (mode positions) */
  key: string;
  label: string;
}

export interface NamingConfig {
  mode: "prefix" | "position";
  /** Séparateur des champs ; vide = détection automatique ( | _ - ) */
  separator: string;
  fields: NamingField[];
}

/** Sans réglage : préfixes détectés automatiquement, libellé = le préfixe. */
export const DEFAULT_NAMING: NamingConfig = { mode: "prefix", separator: "", fields: [] };

const SEPARATORS = ["|", "_", " - ", "/", ">"];

export function readNaming(raw: unknown): NamingConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_NAMING;
  const r = raw as Partial<NamingConfig>;
  const fields = Array.isArray(r.fields)
    ? r.fields.filter((f): f is NamingField => !!f && typeof f.key === "string" && typeof f.label === "string" && !!f.key.trim()).map((f) => ({ key: f.key.trim(), label: f.label.trim() || f.key.trim() }))
    : [];
  return { mode: r.mode === "position" ? "position" : "prefix", separator: typeof r.separator === "string" ? r.separator : "", fields };
}

/** Séparateur le plus probable d'un nom : celui qui découpe en plus de morceaux. */
export function guessSeparator(name: string): string {
  let best = "";
  let n = 1;
  for (const s of SEPARATORS) {
    const c = name.split(s).length;
    if (c > n) {
      n = c;
      best = s;
    }
  }
  return best;
}

const split = (name: string, sep: string) => (sep ? name.split(sep) : [name]).map((x) => x.trim()).filter(Boolean);
const PREFIX = /^([\p{L}\p{N}]{1,15})\s*[:=]\s*(.+)$/u;

/** Propriétés lues dans un nom : libellé du champ → valeur. */
export function parseAdName(name: string, cfg: NamingConfig = DEFAULT_NAMING): Record<string, string> {
  const out: Record<string, string> = {};
  const sep = cfg.separator || guessSeparator(name);
  const parts = split(name, sep);
  if (cfg.mode === "position") {
    for (const f of cfg.fields) {
      const i = Number(f.key) - 1;
      if (Number.isInteger(i) && i >= 0 && parts[i]) out[f.label] = parts[i];
    }
    return out;
  }
  const labels = new Map(cfg.fields.map((f) => [f.key.toLowerCase(), f.label]));
  for (const p of parts) {
    const m = p.match(PREFIX);
    if (!m) continue;
    const key = m[1].toLowerCase();
    // Avec des champs déclarés, on ne lit qu'eux ; sinon, tout préfixe trouvé
    if (labels.size && !labels.has(key)) continue;
    out[labels.get(key) ?? m[1].toUpperCase()] = m[2].trim();
  }
  return out;
}

/**
 * Nom lisible d'une annonce : en mode préfixes, le texte libre sans les propriétés déjà lues
 * (« F:UGC | A:Routine | Routine du soir » donne « Routine du soir ») ; sinon le nom tel quel.
 */
export function displayName(name: string, cfg: NamingConfig = DEFAULT_NAMING): string {
  if (cfg.mode === "position") return name;
  const sep = cfg.separator || guessSeparator(name);
  const rest = split(name, sep).filter((p) => !PREFIX.test(p));
  return rest.length && rest.length < split(name, sep).length ? rest.join(" ") : name;
}

/** Champs présents dans un ensemble de noms, triés par nombre d'annonces qui les portent. */
export function namingFields(names: string[], cfg: NamingConfig = DEFAULT_NAMING): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of names) for (const k of Object.keys(parseAdName(n, cfg))) m.set(k, (m.get(k) ?? 0) + 1);
  const order = cfg.fields.map((f) => f.label);
  return [...m]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      const ia = order.indexOf(a.label);
      const ib = order.indexOf(b.label);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return b.count - a.count;
    });
}

/** Part des noms qui donnent au moins une propriété : sert à dire « nomenclature non reconnue ». */
export function namingCoverage(names: string[], cfg: NamingConfig = DEFAULT_NAMING): number {
  if (!names.length) return 0;
  return names.filter((n) => Object.keys(parseAdName(n, cfg)).length > 0).length / names.length;
}
