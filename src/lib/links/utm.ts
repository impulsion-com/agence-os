// Construction des URL trackées, conventions UTM, codes courts (pur, client et serveur).

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export const UTM_LABEL: Record<UtmKey, string> = {
  utm_source: "Source",
  utm_medium: "Support (medium)",
  utm_campaign: "Campagne",
  utm_content: "Contenu",
  utm_term: "Terme",
  utm_id: "ID de campagne",
};

export const UTM_HINT: Record<UtmKey, string> = {
  utm_source: "Qui envoie le trafic : facebook, google, newsletter, instagram…",
  utm_medium: "Le type de canal : paid_social, cpc, email, social, bio, qr_code…",
  utm_campaign: "Le nom de la campagne ou de l'opération",
  utm_content: "Ce qui distingue deux liens d'une même campagne : visuel, bouton, annonce",
  utm_term: "Mot-clé (Search) ou audience / ensemble de publicités",
  utm_id: "Identifiant numérique de la campagne (GA4 s'en sert pour rapprocher les coûts)",
};

export interface Param {
  k: string;
  v: string;
}

export type Utm = Record<UtmKey, string> & { extra: Param[] };

export const EMPTY_UTM: Utm = { utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "", utm_id: "", extra: [] };

/** Lecture tolérante de la colonne jsonb `links.utm`. */
export function readUtm(raw: unknown): Utm {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Utm = { ...EMPTY_UTM, extra: [] };
  for (const k of UTM_KEYS) if (typeof o[k] === "string") out[k] = o[k] as string;
  if (Array.isArray(o.extra))
    out.extra = (o.extra as unknown[])
      .map((p) => p as Partial<Param>)
      .filter((p) => typeof p?.k === "string")
      .map((p) => ({ k: String(p.k), v: String(p.v ?? "") }));
  return out;
}

/** Forme stockée : clés vides retirées. */
export function storeUtm(u: Utm) {
  const o: Record<string, unknown> = {};
  for (const k of UTM_KEYS) if (u[k].trim()) o[k] = u[k].trim();
  const extra = u.extra.filter((p) => p.k.trim()).map((p) => ({ k: p.k.trim(), v: p.v.trim() }));
  if (extra.length) o.extra = extra;
  return o;
}

// ---------------------------------------------------------------------
// Variables dynamiques des plateformes
// ---------------------------------------------------------------------
export interface Macro {
  token: string;
  label: string;
}
export interface MacroGroup {
  id: "meta" | "google" | "tiktok" | "linkedin";
  name: string;
  field: string; // où coller la chaîne dans la plateforme
  macros: Macro[];
}

export const MACROS: MacroGroup[] = [
  {
    id: "meta",
    name: "Meta Ads",
    field: "Annonce > Suivi > Paramètres d'URL",
    macros: [
      { token: "{{campaign.name}}", label: "Nom de la campagne" },
      { token: "{{campaign.id}}", label: "ID de la campagne" },
      { token: "{{adset.name}}", label: "Nom de l'ensemble de publicités" },
      { token: "{{adset.id}}", label: "ID de l'ensemble de publicités" },
      { token: "{{ad.name}}", label: "Nom de la publicité" },
      { token: "{{ad.id}}", label: "ID de la publicité" },
      { token: "{{placement}}", label: "Placement (Feed, Stories…)" },
      { token: "{{site_source_name}}", label: "Plateforme (fb, ig, an, msg)" },
    ],
  },
  {
    id: "google",
    name: "Google Ads",
    field: "Campagne > Paramètres > Options d'URL > Suffixe de l'URL finale",
    macros: [
      { token: "{campaignid}", label: "ID de la campagne" },
      { token: "{adgroupid}", label: "ID du groupe d'annonces" },
      { token: "{creative}", label: "ID de l'annonce" },
      { token: "{keyword}", label: "Mot-clé déclenché" },
      { token: "{matchtype}", label: "Type de correspondance (e, p, b)" },
      { token: "{network}", label: "Réseau (g, s, d, ytv…)" },
      { token: "{device}", label: "Appareil (m, t, c)" },
      { token: "{placement}", label: "Emplacement (Display)" },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    field: "Annonce > Destination > Paramètres d'URL",
    macros: [
      { token: "__CAMPAIGN_ID__", label: "ID de la campagne" },
      { token: "__CAMPAIGN_NAME__", label: "Nom de la campagne" },
      { token: "__AID__", label: "ID du groupe d'annonces" },
      { token: "__AID_NAME__", label: "Nom du groupe d'annonces" },
      { token: "__CID__", label: "ID de l'annonce" },
      { token: "__CID_NAME__", label: "Nom de l'annonce" },
      { token: "__PLACEMENT__", label: "Placement" },
    ],
  },
  {
    id: "linkedin",
    name: "LinkedIn Ads",
    field: "Campagne > Suivi des URL (paramètres UTM)",
    macros: [
      { token: "{{CAMPAIGN_ID}}", label: "ID de la campagne" },
      { token: "{{CAMPAIGN_GROUP_ID}}", label: "ID du groupe de campagnes" },
      { token: "{{CREATIVE_ID}}", label: "ID de la publicité" },
    ],
  },
];

const MACRO_RE = /\{\{[^{}]+\}\}|\{[a-z_]+\}|__[A-Z_]+__/g;

/** Macros de plateformes présentes dans une chaîne. */
export function findMacros(s: string) {
  return [...new Set(s.match(MACRO_RE) ?? [])];
}

/** Plateforme dominante des macros (pour indiquer où coller la chaîne). */
export function macroPlatform(tokens: string[]): MacroGroup | null {
  for (const g of MACROS) if (tokens.some((t) => g.macros.some((m) => m.token === t))) return g;
  if (tokens.some((t) => t.startsWith("{{"))) return MACROS[0];
  if (tokens.some((t) => t.startsWith("__"))) return MACROS[2];
  if (tokens.length) return MACROS[1];
  return null;
}

// ---------------------------------------------------------------------
// Conventions : minuscules, sans accents ni espaces
// ---------------------------------------------------------------------
/** Normalise une valeur UTM en conservant les macros de plateforme intactes. */
export function normalizeValue(s: string) {
  const parts: string[] = [];
  let last = 0;
  for (const m of s.matchAll(MACRO_RE)) {
    parts.push(norm(s.slice(last, m.index)), m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(norm(s.slice(last)));
  return parts.join("");
}
function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_");
}
export const normalizeUtm = (s: string) => normalizeValue(s).replace(/^_+|_+$/g, "");

/** Écarts à la convention (hors macros). */
export function conventionIssues(s: string): string[] {
  const plain = s.replace(MACRO_RE, "");
  const out: string[] = [];
  if (/[A-Z]/.test(plain)) out.push("majuscules");
  if (/[À-ÿ]/.test(plain)) out.push("accents");
  if (/\s/.test(plain)) out.push("espaces");
  if (/[^A-Za-z0-9À-ÿ\s._-]/.test(plain)) out.push("caractères spéciaux");
  return out;
}

// ---------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------
/** Encode une valeur de paramètre en laissant lisibles les macros ({{…}}, {…}, __X__). */
export function encodeValue(v: string) {
  return encodeURIComponent(v).replace(/%7B/gi, "{").replace(/%7D/gi, "}").replace(/%2E/gi, ".");
}

export interface ParsedDestination {
  ok: boolean;
  error?: string;
  url?: URL;
  /** URL de destination sans paramètres UTM */
  clean: string;
  /** UTM trouvées dans l'URL collée */
  found: Partial<Record<UtmKey, string>>;
}

/** Valide une URL de destination et en retire les UTM déjà présentes. */
export function parseDestination(input: string): ParsedDestination {
  let raw = input.trim();
  if (!raw) return { ok: false, clean: "", found: {} };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Adresse invalide", clean: input, found: {} };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "L'adresse doit commencer par https://", clean: input, found: {} };
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return { ok: false, error: "Nom de domaine incomplet", clean: input, found: {} };
  const found: Partial<Record<UtmKey, string>> = {};
  // Lecture brute pour ne pas décoder les macros
  const [base, hash = ""] = splitHash(raw);
  const [path, query = ""] = splitQuery(base);
  const kept: string[] = [];
  for (const pair of query.split("&").filter(Boolean)) {
    const [k, ...rest] = pair.split("=");
    const key = safeDecode(k).toLowerCase();
    if ((UTM_KEYS as readonly string[]).includes(key)) found[key as UtmKey] = safeDecode(rest.join("="));
    else kept.push(pair);
  }
  const clean = path + (kept.length ? "?" + kept.join("&") : "") + (hash ? "#" + hash : "");
  return { ok: true, url, clean, found };
}

function splitHash(s: string): [string, string?] {
  const i = s.indexOf("#");
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + 1)];
}
function splitQuery(s: string): [string, string?] {
  const i = s.indexOf("?");
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + 1)];
}
function safeDecode(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** Chaîne de paramètres seule (champ « Paramètres d'URL » / « Suffixe de l'URL finale »). */
export function paramString(u: Utm) {
  const pairs: string[] = [];
  for (const k of UTM_KEYS) if (u[k].trim()) pairs.push(`${k}=${encodeValue(u[k].trim())}`);
  for (const p of u.extra) if (p.k.trim()) pairs.push(`${encodeURIComponent(p.k.trim())}=${encodeValue(p.v.trim())}`);
  return pairs.join("&");
}

/** URL finale : destination (sans UTM) + paramètres, fragment conservé en fin. */
export function buildUrl(destination: string, u: Utm) {
  const d = parseDestination(destination);
  const src = d.ok ? d.clean : destination.trim();
  const qs = paramString(u);
  if (!qs) return src;
  const [base, hash] = splitHash(src);
  const sep = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?";
  return base + sep + qs + (hash ? "#" + hash : "");
}

/** Ajoute un paramètre à une URL (redirection des liens courts) en gardant le reste intact. */
export function appendParam(url: string, key: string, value: string) {
  const [base, hash] = splitHash(url);
  const sep = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?";
  return `${base}${sep}${key}=${encodeURIComponent(value)}${hash !== undefined ? "#" + hash : ""}`;
}

/** Paramètres supplémentaires d'un preset : « utm_id=…&aos_ad=… ». */
export function parseExtra(s: string): Param[] {
  return s
    .split("&")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [k, ...rest] = p.split("=");
      return { k: safeDecode(k), v: safeDecode(rest.join("=")) };
    });
}
export const extraToString = (ps: Param[]) =>
  ps
    .filter((p) => p.k.trim())
    .map((p) => `${p.k.trim()}=${p.v.trim()}`)
    .join("&");

export interface Preset {
  id: string;
  name: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  extra_params: string;
  position: number;
}

/**
 * Applique un preset : ses valeurs remplacent la saisie. Un champ vide du preset garde
 * la saisie actuelle, sauf si elle contient des variables d'une autre plateforme.
 */
export function applyPreset(cur: Utm, p: Preset): Utm {
  const extra = parseExtra(p.extra_params);
  const id = extra.find((e) => e.k === "utm_id")?.v ?? "";
  const keep = (v: string) => (findMacros(v).length ? "" : v);
  return {
    utm_source: p.utm_source || keep(cur.utm_source),
    utm_medium: p.utm_medium || keep(cur.utm_medium),
    utm_campaign: p.utm_campaign || keep(cur.utm_campaign),
    utm_content: p.utm_content || keep(cur.utm_content),
    utm_term: p.utm_term || keep(cur.utm_term),
    utm_id: id || keep(cur.utm_id),
    extra: extra.filter((e) => e.k !== "utm_id"),
  };
}

// ---------------------------------------------------------------------
// Codes courts
// ---------------------------------------------------------------------
// Sans caractères ambigus (0/o, 1/l/i)
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export function randomCode(len = 7) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const CODE_RE = /^[A-Za-z0-9_-]{2,64}$/;
export const RESERVED_CODES = new Set([
  "api", "app", "admin", "auth", "login", "logout", "signup", "register", "invite", "settings", "w", "l", "p", "r", "t",
  "www", "static", "assets", "public", "robots", "sitemap", "favicon", "help", "aide", "support", "_next", "status",
]);

export function codeError(code: string): string | null {
  if (!code) return "Choisis un code";
  if (code.length < 2) return "2 caractères minimum";
  if (code.length > 64) return "64 caractères maximum";
  if (!CODE_RE.test(code)) return "Lettres sans accents, chiffres, tiret et tiret bas uniquement";
  if (RESERVED_CODES.has(code.toLowerCase())) return "Ce mot est réservé";
  return null;
}

/** Préfixe des liens courts : domaine court dédié, sinon <app>/l/. */
export function shortBase(origin?: string) {
  const dom = (process.env.NEXT_PUBLIC_SHORT_DOMAIN || "").trim().replace(/\/+$/, "");
  if (dom) return (/^https?:\/\//.test(dom) ? dom : `https://${dom}`) + "/";
  const app = (process.env.NEXT_PUBLIC_APP_URL || origin || "").replace(/\/+$/, "");
  return `${app}/l/`;
}
export const shortUrl = (code: string, origin?: string) => shortBase(origin) + code;
export const shortDisplay = (code: string, origin?: string) => shortUrl(code, origin).replace(/^https?:\/\//, "");

// ---------------------------------------------------------------------
// Règle de nommage de l'espace ({client}_{objectif}_{date})
// ---------------------------------------------------------------------
export const RULE_TOKENS: { token: string; label: string }[] = [
  { token: "client", label: "Nom du client associé" },
  { token: "source", label: "utm_source du lien" },
  { token: "medium", label: "utm_medium du lien" },
  { token: "date", label: "Année et mois (2026-09)" },
  { token: "jour", label: "Date du jour (2026-09-25)" },
  { token: "annee", label: "Année (2026)" },
  { token: "mois", label: "Mois (09)" },
];

export function ruleTokens(rule: string) {
  return [...new Set([...rule.matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1].toLowerCase()))];
}

export function applyRule(rule: string, ctx: Record<string, string>, now = new Date()) {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const auto: Record<string, string> = { date: `${y}-${m}`, jour: `${y}-${m}-${d}`, annee: y, mois: m };
  return normalizeUtm(
    rule.replace(/\{([a-z0-9_]+)\}/gi, (_, t: string) => {
      const k = t.toLowerCase();
      return ctx[k] ?? auto[k] ?? `{${k}}`;
    }),
  );
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
export function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: unknown[][]) {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Lecture CSV simple (virgule, point-virgule ou tabulation détectés sur la première ligne). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] ?? "";
  const counts = [",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1]);
  const sep = counts[0][1] > 1 ? counts[0][0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

export function download(name: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
