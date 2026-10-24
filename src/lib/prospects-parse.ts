// Prospection, partie pure (sans import) : lecture d'un export CSV de gosom/google-maps-scraper
// ou d'un autre outil, nettoyage des emails, dédoublonnage. Chargeable par les tests Node
// (node --experimental-strip-types --test src/lib/tests/prospects.test.mjs).

/** Fiche prête à insérer (sans espace ni auteur). */
export interface ProspectInput {
  source: string;
  external_id: string;
  name: string;
  category: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
  website: string;
  emails: string[];
  rating: number | null;
  reviews: number | null;
  maps_url: string;
  latitude: number | null;
  longitude: number | null;
  search: string;
}


const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ---------------------------------------------------------------------
// Emails : le scraper lit les sites et ramène aussi des noms d'images
// (« Twins@2x.png ») ou des adresses techniques (Sentry, Wix).
// ---------------------------------------------------------------------
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const FILE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?|css|js|pdf)$/;
const JUNK_DOMAINS = ["sentry.io", "sentry-next.wixpress.com", "wixpress.com", "example.com", "example.fr", "domain.com", "yourdomain.com", "votredomaine.fr", "test.com", "email.com"];
// adresses à éviter pour une prise de contact commerciale
const POOR_LOCAL = /^(no-?reply|ne-?pas-?repondre|newsletter|job|jobs|emploi|recrutement|candidature|rh|hr|career|careers|rgpd|dpo|privacy|compta|comptabilite|facturation|billing|webmaster|postmaster|abuse|support)\b/;

export function cleanEmails(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(/[\s,;|]+/));
  const out: string[] = [];
  for (let p of parts) {
    p = p.trim().toLowerCase().replace(/^mailto:/, "").replace(/^[<("']+|[>)"'.]+$/g, "");
    if (!p || !EMAIL_RE.test(p) || FILE_RE.test(p) || /@\d+x\b/.test(p)) continue;
    const domain = p.split("@")[1];
    if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, 10);
}

/** L'adresse à utiliser pour un premier contact : la première qui n'est ni technique ni RH. */
export function bestEmail(emails: string[]): string {
  return emails.find((e) => !POOR_LOCAL.test(e.split("@")[0])) ?? emails[0] ?? "";
}

// ---------------------------------------------------------------------
// Normalisation d'une fiche (CSV ou MCP)
// ---------------------------------------------------------------------
const cut = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : typeof s === "number" ? String(s) : "");

function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function cleanUrl(raw: unknown): string {
  const s = cut(raw, 500);
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : "";
}

export function normalizeProspect(p: Partial<Record<keyof ProspectInput, unknown>>): ProspectInput | null {
  const name = cut(p.name, 200);
  if (!name) return null;
  const rating = num(p.rating);
  const reviews = num(p.reviews);
  const lat = num(p.latitude);
  const lon = num(p.longitude);
  return {
    source: cut(p.source, 40) || "google_maps",
    external_id: cut(p.external_id, 200),
    name,
    category: cut(p.category, 120),
    address: cut(p.address, 300),
    city: cut(p.city, 120),
    postal_code: cut(p.postal_code, 20),
    country: cut(p.country, 80),
    phone: cut(p.phone, 40),
    website: cleanUrl(p.website),
    emails: cleanEmails(Array.isArray(p.emails) ? p.emails.filter((e): e is string => typeof e === "string") : cut(p.emails, 2000)),
    rating: rating === null ? null : Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10,
    reviews: reviews === null ? null : Math.max(0, Math.round(reviews)),
    maps_url: cleanUrl(p.maps_url),
    latitude: lat !== null && Math.abs(lat) <= 90 ? lat : null,
    longitude: lon !== null && Math.abs(lon) <= 180 ? lon : null,
    search: cut(p.search, 200),
  };
}

/** Clé de dédoublonnage : identifiant de la source, sinon nom + code postal (ou adresse). */
export const prospectKey = (p: Pick<ProspectInput, "source" | "external_id" | "name" | "postal_code" | "address">) =>
  p.external_id ? `${p.source}:${p.external_id}` : `nom:${norm(p.name)}|${norm(p.postal_code || p.address)}`;

// ---------------------------------------------------------------------
// Fichier CSV : colonnes de gosom/google-maps-scraper, et les noms usuels
// des autres outils (Outscraper, Apify, export maison).
// ---------------------------------------------------------------------
type Col = "name" | "category" | "address" | "complete_address" | "city" | "postal_code" | "country" | "phone" | "website" | "emails" | "rating" | "reviews" | "maps_url" | "latitude" | "longitude" | "place_id" | "cid" | "status";

const ALIASES: Record<Col, string[]> = {
  name: ["title", "name", "nom", "entreprise", "business name", "raison sociale", "societe"],
  category: ["category", "categorie", "type", "main category", "secteur"],
  address: ["address", "adresse", "full address", "full_address", "street"],
  complete_address: ["complete_address"],
  city: ["city", "ville", "commune"],
  postal_code: ["postal_code", "postal code", "code postal", "cp", "zip", "zipcode"],
  country: ["country", "pays"],
  phone: ["phone", "telephone", "tel", "phone number", "phone_number", "numero"],
  website: ["website", "site", "site web", "site internet", "url du site", "domain"],
  emails: ["emails", "email", "e-mail", "mail", "email_1"],
  rating: ["review_rating", "rating", "note", "stars", "average rating"],
  reviews: ["review_count", "reviews", "avis", "nombre d'avis", "reviews count", "reviews_count"],
  maps_url: ["link", "google maps url", "maps url", "location_link", "url", "place url"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon", "long"],
  place_id: ["place_id", "google_id", "place id"],
  cid: ["cid", "data_id"],
  status: ["status", "business_status", "statut"],
};

const CLOSED_RE = /ferm[ée] d[ée]finitivement|permanently closed|closed_permanently/i;

export interface ProspectsCsv {
  rows: ProspectInput[];
  /** colonnes du fichier reconnues */
  recognized: Col[];
  /** fiches d'entreprises fermées définitivement, écartées */
  closed: number;
  /** lignes sans nom */
  empty: number;
}

/** Lit une grille CSV (première ligne = en-têtes). `rows` est vide si la colonne du nom manque. */
export function parseProspectsGrid(grid: string[][], search = ""): ProspectsCsv {
  const head = (grid[0] ?? []).map((h) => norm(h.replace(/^﻿/, "")));
  const idx = Object.fromEntries((Object.keys(ALIASES) as Col[]).map((c) => [c, head.findIndex((h) => ALIASES[c].includes(h))])) as Record<Col, number>;
  const recognized = (Object.keys(idx) as Col[]).filter((c) => idx[c] >= 0);
  const out: ProspectsCsv = { rows: [], recognized, closed: 0, empty: 0 };
  if (idx.name < 0) return out;
  for (const r of grid.slice(1)) {
    const get = (c: Col) => (idx[c] >= 0 ? (r[idx[c]] ?? "").trim() : "");
    if (CLOSED_RE.test(get("status"))) {
      out.closed++;
      continue;
    }
    // gosom : {"street":"…","city":"…","postal_code":"…","country":"…"}
    let full: Record<string, string> = {};
    try {
      const j = get("complete_address") ? JSON.parse(get("complete_address")) : null;
      if (j && typeof j === "object") full = j;
    } catch {
      // colonne illisible : on garde les autres
    }
    const p = normalizeProspect({
      source: "google_maps",
      external_id: get("place_id") || get("cid"),
      name: get("name"),
      category: get("category"),
      address: get("address") || [full.street, full.postal_code, full.city].filter(Boolean).join(", "),
      city: get("city") || full.city || "",
      postal_code: get("postal_code") || full.postal_code || "",
      country: get("country") || full.country || "",
      phone: get("phone"),
      website: get("website"),
      emails: get("emails"),
      rating: get("rating"),
      reviews: get("reviews"),
      maps_url: get("maps_url"),
      latitude: get("latitude"),
      longitude: get("longitude"),
      search,
    });
    if (p) out.rows.push(p);
    else out.empty++;
  }
  return out;
}
