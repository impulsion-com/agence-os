// Veille concurrentielle : calculs purs (client, serveur et tests node).
// Aucun import de valeur : ce fichier doit rester exécutable par
// `node --experimental-strip-types` (voir tests/intel.test.mjs).

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export interface IntelTags {
  angle: string;
  hook_type: HookType;
  hook: string;
  awareness: "unaware" | "problem" | "solution" | "product" | "most";
  format: "static" | "carousel" | "short_video" | "ugc" | "motion" | "dpa" | "other";
  promise: string;
  proof: string;
  offer: string;
  cta: string;
  persona: string;
}

export type HookType = "question" | "chiffre" | "douleur" | "temoignage" | "contraste" | "curiosite" | "promesse" | "autorite" | "offre" | "humour" | "autre";

export const HOOK_TYPES: { id: HookType; name: string }[] = [
  { id: "question", name: "Question" },
  { id: "chiffre", name: "Chiffre" },
  { id: "douleur", name: "Douleur" },
  { id: "temoignage", name: "Témoignage" },
  { id: "contraste", name: "Contraste" },
  { id: "curiosite", name: "Curiosité" },
  { id: "promesse", name: "Promesse" },
  { id: "autorite", name: "Autorité" },
  { id: "offre", name: "Offre" },
  { id: "humour", name: "Humour" },
  { id: "autre", name: "Autre" },
];
export const hookTypeName = (id: string | null | undefined) => HOOK_TYPES.find((h) => h.id === id)?.name ?? "";

/** Pub concurrente telle que stockée (competitor_ads). */
export interface CompetitorAd {
  id: string;
  workspace_id: string;
  watch_id: string | null;
  archive_id: string;
  page_id: string;
  page_name: string;
  bodies: string[];
  titles: string[];
  descriptions: string[];
  captions: string[];
  start_time: string | null;
  stop_time: string | null;
  snapshot_url: string | null;
  platforms: string[];
  languages: string[];
  eu_reach: number | null;
  is_active: boolean;
  first_seen: string;
  last_seen: string;
  ai_tags: IntelTags | null;
  concept_id: string | null;
  is_demo: boolean;
}

/** Pub lue dans la réponse de l'API Ad Library (avant stockage). */
export interface ParsedAd {
  archive_id: string;
  page_id: string;
  page_name: string;
  bodies: string[];
  titles: string[];
  descriptions: string[];
  captions: string[];
  start_time: string | null;
  stop_time: string | null;
  snapshot_url: string | null;
  platforms: string[];
  languages: string[];
  eu_reach: number | null;
  target_ages: string | null;
  target_gender: string | null;
  target_locations: unknown;
}

export const PLATFORM_NAMES: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  threads: "Threads",
  oculus: "Oculus",
  streaming_services: "Streaming",
};
export const platformName = (p: string) => PLATFORM_NAMES[p] ?? p;

// Pays où les pubs commerciales sont consultables (UE + Royaume-Uni, DSA)
export const INTEL_COUNTRIES: { id: string; name: string }[] = [
  { id: "FR", name: "France" }, { id: "BE", name: "Belgique" }, { id: "LU", name: "Luxembourg" }, { id: "DE", name: "Allemagne" },
  { id: "ES", name: "Espagne" }, { id: "IT", name: "Italie" }, { id: "NL", name: "Pays-Bas" }, { id: "PT", name: "Portugal" },
  { id: "AT", name: "Autriche" }, { id: "IE", name: "Irlande" }, { id: "SE", name: "Suède" }, { id: "DK", name: "Danemark" },
  { id: "FI", name: "Finlande" }, { id: "PL", name: "Pologne" }, { id: "GB", name: "Royaume-Uni" },
];

// ---------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------
/** Normalisation pour comparer deux textes : minuscules, sans accents, URL, emojis ni ponctuation. */
export function normText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Première phrase (hook probable), 160 caractères au plus. */
export function firstSentence(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = /^(.+?[.!?…])(\s|$)/.exec(t);
  const out = (m ? m[1] : t).trim();
  return out.length > 160 ? out.slice(0, 159).trimEnd() + "…" : out;
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------
const DAY = 86_400_000;

/** Jours de diffusion : du lancement à l'arrêt (ou à maintenant si active). */
export function longevityDays(start: string | null, stop: string | null, now: number = Date.now()): number | null {
  if (!start) return null;
  const s = Date.parse(start);
  if (Number.isNaN(s)) return null;
  const e = stop ? Date.parse(stop) : now;
  return Math.max(0, Math.floor(((Number.isNaN(e) ? now : e) - s) / DAY));
}

/** « Nouvelle » : vue pour la première fois il y a moins de 7 jours. */
export const isNew = (firstSeen: string, now: number = Date.now()) => now - Date.parse(firstSeen) < 7 * DAY;

// ---------------------------------------------------------------------
// Groupes de variantes : même texte principal OU même titre (normalisés),
// sur la même page. Union-find pour relier les chaînes (A~B par texte, B~C par titre).
// ---------------------------------------------------------------------
type Groupable = Pick<CompetitorAd, "id" | "page_id" | "bodies" | "titles">;

const MIN_KEY = 12; // un titre trop court (« Découvrir ») ne suffit pas à relier deux pubs

export function variantGroups(ads: Groupable[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
  };
  const seen = new Map<string, string>();
  for (const a of ads) parent.set(a.id, a.id);
  for (const a of ads) {
    const keys = [
      ...a.bodies.map((b) => normText(b).slice(0, 200)).filter((k) => k.length >= MIN_KEY).map((k) => `b|${a.page_id}|${k}`),
      ...a.titles.map((t) => normText(t)).filter((k) => k.length >= MIN_KEY).map((k) => `t|${a.page_id}|${k}`),
    ];
    for (const k of keys) {
      const other = seen.get(k);
      if (other) union(a.id, other);
      else seen.set(k, a.id);
    }
  }
  const out = new Map<string, string>();
  for (const a of ads) out.set(a.id, find(a.id));
  return out;
}

/** Nombre de pubs par groupe. */
export function groupSizes(groups: Map<string, string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of groups.values()) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------------
// Score « probablement gagnante » (0 à 100), explicable ligne par ligne
// ---------------------------------------------------------------------
export interface Score {
  score: number;
  winner: boolean;
  longevity: number | null;
  variants: number;
  reasons: { label: string; points: number }[];
}

const fmtInt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
const fmtReach = (n: number) =>
  n >= 1_000_000 ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n / 1_000_000)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : fmtInt(n);

/**
 * Barème : une pub qui reste en ligne longtemps et qu'on décline est une pub qui rapporte.
 *  - longévité : 7 j = 10, 14 j = 20, 30 j = 35, 60 j = 45, 90 j = 50
 *  - variantes du même concept : 2 = 10, 3 = 15, 4 et + = 20, 7 et + = 25
 *  - toujours active : 15
 *  - portée UE (si disponible) : 10 k = 4, 100 k = 7, 1 M = 10
 * Gagnante probable : toujours active, en ligne depuis au moins 30 jours et score ≥ 60.
 */
export function scoreAd(ad: Pick<CompetitorAd, "start_time" | "stop_time" | "is_active" | "eu_reach">, variants: number, now: number = Date.now()): Score {
  const reasons: Score["reasons"] = [];
  const days = longevityDays(ad.start_time, ad.is_active ? null : ad.stop_time, now);
  if (days !== null) {
    const p = days >= 90 ? 50 : days >= 60 ? 45 : days >= 30 ? 35 : days >= 14 ? 20 : days >= 7 ? 10 : 0;
    if (p) reasons.push({ label: `${ad.is_active ? "En ligne depuis" : "Diffusée"} ${days} jours`, points: p });
  }
  if (variants >= 2) {
    const p = variants >= 7 ? 25 : variants >= 4 ? 20 : variants === 3 ? 15 : 10;
    reasons.push({ label: `${variants} variantes du même concept`, points: p });
  }
  if (ad.is_active) reasons.push({ label: "Toujours active", points: 15 });
  if (ad.eu_reach && ad.eu_reach >= 10_000) {
    const p = ad.eu_reach >= 1_000_000 ? 10 : ad.eu_reach >= 100_000 ? 7 : 4;
    reasons.push({ label: `Portée UE de ${fmtReach(ad.eu_reach)}`, points: p });
  }
  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  const winner = ad.is_active && (days ?? 0) >= 30 && score >= 60;
  return { score, winner, longevity: days, variants, reasons };
}

/** Score de toutes les pubs d'un ensemble (variantes calculées sur l'ensemble). */
export function scoreAll<T extends Groupable & Pick<CompetitorAd, "start_time" | "stop_time" | "is_active" | "eu_reach">>(ads: T[], now: number = Date.now()) {
  const groups = variantGroups(ads);
  const sizes = groupSizes(groups);
  const out = new Map<string, Score & { group: string }>();
  for (const a of ads) {
    const g = groups.get(a.id)!;
    out.set(a.id, { ...scoreAd(a, sizes.get(g) ?? 1, now), group: g });
  }
  return out;
}

// ---------------------------------------------------------------------
// API Ad Library : lecture d'une page de réponse
// ---------------------------------------------------------------------
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Retire le jeton d'accès de l'URL d'aperçu (ad_snapshot_url le contient). */
export function stripToken(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.delete("access_token");
    return u.toString();
  } catch {
    return null;
  }
}

/** Lien public de la pub dans la bibliothèque publicitaire Meta (sans jeton). */
export const adLibraryUrl = (archiveId: string) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(archiveId)}`;

export function parseAd(raw: Record<string, unknown>): ParsedAd | null {
  const id = str(raw.id) ?? (typeof raw.id === "number" ? String(raw.id) : null);
  if (!id) return null;
  const reach = raw.eu_total_reach;
  const ages = raw.target_ages;
  return {
    archive_id: id,
    page_id: str(raw.page_id) ?? (typeof raw.page_id === "number" ? String(raw.page_id) : ""),
    page_name: str(raw.page_name) ?? "",
    bodies: [...new Set(arr(raw.ad_creative_bodies))],
    titles: [...new Set(arr(raw.ad_creative_link_titles))],
    descriptions: [...new Set(arr(raw.ad_creative_link_descriptions))],
    captions: [...new Set(arr(raw.ad_creative_link_captions))],
    start_time: str(raw.ad_delivery_start_time),
    stop_time: str(raw.ad_delivery_stop_time),
    snapshot_url: stripToken(str(raw.ad_snapshot_url)),
    platforms: arr(raw.publisher_platforms).map((p) => p.toLowerCase()),
    languages: arr(raw.languages).map((l) => l.toLowerCase()),
    eu_reach: typeof reach === "number" ? reach : typeof reach === "string" && /^\d+$/.test(reach) ? Number(reach) : null,
    target_ages: Array.isArray(ages) ? ages.join("-") : str(ages),
    target_gender: str(raw.target_gender),
    target_locations: Array.isArray(raw.target_locations) ? raw.target_locations : null,
  };
}

/** Une page de réponse : pubs lues + URL de la page suivante (null en fin de résultats). */
export function parseArchivePage(body: unknown): { ads: ParsedAd[]; next: string | null } {
  const b = (body ?? {}) as { data?: unknown; paging?: { next?: unknown } };
  const data = Array.isArray(b.data) ? b.data : [];
  const ads = data.map((d) => parseAd((d ?? {}) as Record<string, unknown>)).filter((a): a is ParsedAd => !!a);
  // Fin des résultats : page vide, ou pas de lien « next »
  const next = data.length && typeof b.paging?.next === "string" ? b.paging.next : null;
  return { ads, next };
}

// ---------------------------------------------------------------------
// Erreurs de l'API Graph → message en français
// ---------------------------------------------------------------------
export interface GraphErr {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  error_user_title?: string;
}

export type IntelErrorCode = "identity" | "token" | "rate" | "permission" | "param" | "other";

export function mapGraphError(e: GraphErr): { code: IntelErrorCode; message: string } {
  const sub = e.error_subcode;
  if (sub === 2332002 || sub === 2332004 || /confirm your identity|identity confirmation|ads\/library\/api/i.test(`${e.message} ${e.error_user_msg}`))
    return {
      code: "identity",
      message:
        "Meta refuse l'accès à l'API Ad Library : le compte Facebook qui a généré le jeton n'a pas confirmé son identité (facebook.com/ID), ou l'app développeur n'a pas accepté les conditions de l'API sur facebook.com/ads/library/api. La vérification prend de quelques heures à 2 jours.",
    };
  if (e.code === 190 || e.code === 102 || e.code === 463 || e.code === 467)
    return { code: "token", message: "Le jeton Meta est invalide ou a expiré : génère-en un nouveau (ou reconnecte Meta) puis teste-le." };
  if (e.code === 613 || e.code === 4 || e.code === 17 || e.code === 32 || e.code === 80004)
    return { code: "rate", message: "Limite de l'API Ad Library atteinte (environ 200 appels par heure) : la prochaine synchro reprendra automatiquement." };
  if (e.code === 10 || e.code === 200)
    return { code: "permission", message: `Permission Meta insuffisante pour l'API Ad Library${e.message ? ` (${e.message})` : ""}. Vérifie la confirmation d'identité et l'accès à l'API sur facebook.com/ads/library/api.` };
  if (e.code === 100 || e.code === 1009 || e.code === 2500)
    return { code: "param", message: `Requête refusée par Meta : ${e.error_user_msg || e.message || "paramètre invalide"}` };
  if (e.code === 1 && /unknown error/i.test(e.message ?? ""))
    return { code: "token", message: "Meta renvoie une erreur inconnue : le plus souvent un jeton manquant ou révoqué. Teste le jeton dans les réglages de la veille." };
  return { code: "other", message: `Meta : ${e.error_user_msg || e.message || "erreur inconnue"}` };
}

// ---------------------------------------------------------------------
// Saisie d'une page : ID, URL de page, URL de la bibliothèque publicitaire
// ---------------------------------------------------------------------
export function parsePageInput(input: string): { pageId: string } | { name: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{5,30}$/.test(s)) return { pageId: s };
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (/(^|\.)(facebook|fb)\.com$/i.test(u.hostname)) {
      const id = u.searchParams.get("view_all_page_id") || u.searchParams.get("id");
      if (id && /^\d{5,30}$/.test(id)) return { pageId: id };
      const m = /-(\d{8,30})\/?$/.exec(u.pathname) || /^\/(\d{5,30})\/?$/.exec(u.pathname);
      if (m) return { pageId: m[1] };
      const slug = u.pathname.split("/").filter(Boolean)[0];
      if (slug && !["ads", "pages", "profile.php"].includes(slug)) return { name: decodeURIComponent(slug).replace(/[-_.]+/g, " ") };
      return null;
    }
  } catch {
    /* pas une URL : recherche par nom */
  }
  return { name: s.slice(0, 100) };
}

// ---------------------------------------------------------------------
// Empreinte du contenu à taguer (idempotence du tagging IA)
// ---------------------------------------------------------------------
export function contentKey(parts: (string | null | undefined)[]): string {
  return parts.map((p) => normText(p)).filter(Boolean).join(" | ").slice(0, 4000);
}
