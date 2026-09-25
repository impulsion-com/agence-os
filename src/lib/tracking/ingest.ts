import "server-only";

import { z } from "zod";

import { supabaseAdmin } from "@/lib/supabase/server";
import { classify, deviceOf, hostMatches } from "./channels";
import { readSettings, type SiteSettings } from "./settings";

// =====================================================================
// Ingestion : script (/api/t/collect) et API serveur (/api/t/conversion).
// Tout passe par le service role ; aucune donnée n'est renvoyée au site.
// =====================================================================

export interface Site {
  id: string;
  workspace_id: string;
  company_id: string | null;
  domains: string[];
  settings: SiteSettings;
}

const SITE_COLS = "id, workspace_id, company_id, domains, settings";
const TTL = 60_000;
const siteCache = new Map<string, { site: Site | null; at: number }>();

function toSite(r: { id: string; workspace_id: string; company_id: string | null; domains: string[]; settings: unknown } | null): Site | null {
  return r ? { ...r, settings: readSettings(r.settings) } : null;
}

/** Site par clé publique (cache mémoire 60 s, y compris les clés inconnues). */
export async function siteByPublicKey(pk: string): Promise<Site | null> {
  const hit = siteCache.get(pk);
  if (hit && Date.now() - hit.at < TTL) return hit.site;
  const { data } = await supabaseAdmin().from("tracking_sites").select(SITE_COLS).eq("public_key", pk).maybeSingle();
  const site = toSite(data);
  if (siteCache.size > 2000) siteCache.clear();
  siteCache.set(pk, { site, at: Date.now() });
  return site;
}

/** Site par clé secrète (API serveur). Pas de cache : la régénération doit être immédiate. */
export async function siteBySecretKey(sk: string): Promise<Site | null> {
  if (!/^sk_[a-f0-9]{16,96}$/.test(sk)) return null;
  const { data } = await supabaseAdmin().from("tracking_sites").select(SITE_COLS).eq("secret_key", sk).maybeSingle();
  return toSite(data);
}

export function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

/** L'origine de la requête est-elle un des domaines du site ? (pas d'Origin = appel serveur, accepté) */
export function originAllowed(site: Site, origin: string | null) {
  // « null » : iframe isolée (pixel personnalisé Shopify, sandbox) : pas d'origine vérifiable
  if (!origin || origin === "null" || !site.domains.length) return true;
  try {
    return hostMatches(new URL(origin).hostname, site.domains);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Limite de débit simple (mémoire, par instance) : 300 requêtes / minute / clé + IP
// ---------------------------------------------------------------------
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, limit = 300) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    buckets.set(key, { n: 1, reset: now + 60_000 });
    return false;
  }
  b.n += 1;
  return b.n > limit;
}

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "0";
}

// ---------------------------------------------------------------------
// Schémas
// ---------------------------------------------------------------------
const str = (n: number) => z.string().trim().max(n);
const optNum = z.preprocess((v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v.replace(",", ".")) : v), z.number().finite().min(-1e11).max(1e11).optional());
const currency = z.preprocess((v) => (typeof v === "string" && v ? v.toUpperCase() : undefined), z.string().regex(/^[A-Z]{3}$/).optional());
const orderId = z.preprocess((v) => (v === null || v === undefined || v === "" ? undefined : String(v)), z.string().max(120).optional());

export const IdentitySchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email().max(254)),
  name: str(200).optional(),
  phone: str(40).optional(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const HitSchema = z.object({
  k: z.string().regex(/^pk_[a-f0-9]{8,64}$/),
  a: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  t: z.enum(["page", "identify", "event"]),
  u: z.string().max(4096),
  r: z.string().max(2048).optional(),
  s: z.union([z.literal(0), z.literal(1)]).optional(),
  d: z.unknown().optional(),
  e: z
    .object({
      type: z.string().trim().min(1).max(40),
      value: optNum,
      currency,
      order_id: orderId,
      props: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type Hit = z.infer<typeof HitSchema>;

export const ConversionSchema = z
  .object({
    email: z.unknown().optional(),
    anon_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    type: z.string().trim().min(1).max(40).default("purchase"),
    value: optNum,
    currency,
    order_id: orderId,
    name: str(200).optional(),
    phone: str(40).optional(),
    ts: z.union([z.string().max(40), z.number()]).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((c) => c.email || c.anon_id, { message: "email ou anon_id requis" });
export type ConversionInput = z.infer<typeof ConversionSchema>;

/** Nom d'évènement normalisé : purchase, lead, booking… ou nom libre en minuscules. */
export function eventType(t: string) {
  const x = t.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!x || x === "pageview") return "custom";
  if (x === "achat" || x === "order" || x === "checkout_completed") return "purchase";
  if (x === "prospect" || x === "signup" || x === "sign_up" || x === "generate_lead") return "lead";
  if (x === "rdv" || x === "rendez_vous" || x === "schedule") return "booking";
  return x;
}

/** Propriétés libres : 20 clés au plus, valeurs simples, chaînes coupées. */
function cleanProps(p: Record<string, unknown> | undefined) {
  const out: Record<string, string | number | boolean> = {};
  if (!p) return out;
  for (const [k, v] of Object.entries(p).slice(0, 20)) {
    const key = k.slice(0, 40);
    if (typeof v === "string") out[key] = v.slice(0, 200);
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

const DUP = "23505";
const lastTouch = new Map<string, number>();

async function markSite(siteId: string) {
  const t = lastTouch.get(siteId) ?? 0;
  if (Date.now() - t < 30_000) return;
  lastTouch.set(siteId, Date.now());
  await supabaseAdmin().from("tracking_sites").update({ last_event_at: new Date().toISOString() }).eq("id", siteId);
}

// ---------------------------------------------------------------------
// Identité : email sur le visiteur, prospect automatique, contact CRM (site de l'agence)
// ---------------------------------------------------------------------
async function identify(site: Site, visitor: { id: string; email: string | null; contact_id: string | null }, who: Identity, at = new Date().toISOString()) {
  const sb = supabaseAdmin();
  const patch: { email?: string; name?: string; phone?: string; identified_at?: string; contact_id?: string } = {};
  if (visitor.email !== who.email) {
    patch.email = who.email;
    patch.identified_at = at;
  }
  if (who.name) patch.name = who.name;
  if (who.phone) patch.phone = who.phone;

  // Site de l'agence elle-même (aucun client) : on relie ou crée un contact CRM.
  // Pour un site client, les visiteurs sont les prospects du client : jamais de contact CRM de l'agence.
  if (!site.company_id && site.settings.auto_contacts && !visitor.contact_id) {
    const { data: found } = await sb.from("contacts").select("id").eq("workspace_id", site.workspace_id).ilike("email", who.email.replace(/[\\%_]/g, "\\$&")).limit(1).maybeSingle();
    if (found) patch.contact_id = found.id;
    else {
      const [first, ...rest] = (who.name ?? "").split(/\s+/).filter(Boolean);
      const { data: created } = await sb
        .from("contacts")
        .insert({
          workspace_id: site.workspace_id,
          first_name: first ?? who.email.split("@")[0],
          last_name: rest.join(" "),
          email: who.email,
          phone: who.phone ?? "",
          notes: "Créé automatiquement par le tracking du site.",
        })
        .select("id")
        .single();
      if (created) patch.contact_id = created.id;
    }
  }
  if (Object.keys(patch).length) await sb.from("visitors").update(patch).eq("id", visitor.id);

  // Première identification de cet email sur le site = un prospect (dédoublonné par l'index unique)
  if (patch.email) {
    const { error } = await sb.from("tracking_events").insert({
      site_id: site.id,
      workspace_id: site.workspace_id,
      visitor_id: visitor.id,
      type: "lead",
      name: "identify",
      order_id: `auto:${who.email}`,
      source: "script",
      ts: at,
    });
    if (error && error.code !== DUP) console.error("[tracking] lead auto", error.message);
  }
}

// ---------------------------------------------------------------------
// Hit du script
// ---------------------------------------------------------------------
export async function ingestHit(site: Site, hit: Hit, ctx: { ua: string; country: string | null }) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: visitor, error } = await sb
    .from("visitors")
    .upsert(
      {
        site_id: site.id,
        workspace_id: site.workspace_id,
        anon_id: hit.a,
        device: deviceOf(ctx.ua),
        ...(ctx.country ? { country: ctx.country } : {}),
        last_seen: now,
      },
      { onConflict: "site_id,anon_id" },
    )
    .select("id, email, contact_id")
    .single();
  if (error || !visitor) {
    console.error("[tracking] visiteur", error?.message);
    return;
  }

  const url = hit.u.slice(0, 2000);
  if (hit.t === "page") {
    if (hit.s === 1) {
      const a = classify(url, hit.r ?? "", site.domains);
      let link: { id: number; link_id: string } | null = null;
      if (a.link_token) {
        const { data } = await sb.from("link_clicks").select("id, link_id").eq("token", a.link_token).eq("workspace_id", site.workspace_id).limit(1).maybeSingle();
        link = data;
      }
      await sb.from("touchpoints").insert({
        site_id: site.id,
        workspace_id: site.workspace_id,
        visitor_id: visitor.id,
        ts: now,
        landing_url: url,
        referrer: (hit.r ?? "").slice(0, 1000),
        utm_source: a.utm_source,
        utm_medium: a.utm_medium,
        utm_campaign: a.utm_campaign,
        utm_content: a.utm_content,
        utm_term: a.utm_term,
        utm_id: a.utm_id,
        click_id_type: a.click_id_type,
        click_id: a.click_id,
        channel: link && a.channel === "direct" ? "short_link" : a.channel,
        platform: a.platform,
        campaign_key: a.campaign_key,
        adset_key: a.adset_key,
        ad_key: a.ad_key,
        link_id: link?.link_id ?? null,
        link_click_id: link?.id ?? null,
      });
    }
    await sb.from("tracking_events").insert({ site_id: site.id, workspace_id: site.workspace_id, visitor_id: visitor.id, type: "pageview", url, ts: now });
  }

  const who = hit.d ? IdentitySchema.safeParse(hit.d) : null;
  if (who?.success) await identify(site, visitor, who.data);

  if (hit.t === "event" && hit.e) {
    const { error: e2 } = await sb.from("tracking_events").insert({
      site_id: site.id,
      workspace_id: site.workspace_id,
      visitor_id: visitor.id,
      type: eventType(hit.e.type),
      name: hit.e.type.slice(0, 80),
      value: hit.e.value ?? null,
      currency: hit.e.currency ?? null,
      order_id: hit.e.order_id ?? null,
      url,
      source: "script",
      props: cleanProps(hit.e.props),
      ts: now,
    });
    if (e2 && e2.code !== DUP) console.error("[tracking] évènement", e2.message);
  }
  await markSite(site.id);
}

// ---------------------------------------------------------------------
// Conversion serveur (API, webhooks) : idempotente par order_id
// ---------------------------------------------------------------------
function parseTs(ts: string | number | undefined) {
  if (ts === undefined) return new Date();
  const d = typeof ts === "number" ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return new Date();
  const now = Date.now();
  return new Date(Math.min(now, Math.max(now - 400 * 864e5, d.getTime())));
}

export async function recordConversion(site: Site, input: ConversionInput, source: "api" | "stripe" = "api") {
  const sb = supabaseAdmin();
  if (!input.email && !input.anon_id) return { ok: false as const, status: 400, error: "email ou anon_id requis" };
  const email = input.email ? IdentitySchema.shape.email.safeParse(input.email) : null;
  if (input.email && !email?.success) return { ok: false as const, status: 400, error: "email invalide" };
  const mail = email?.success ? email.data : null;
  const at = parseTs(input.ts).toISOString();

  let visitor: { id: string; email: string | null; contact_id: string | null } | null = null;
  if (input.anon_id) {
    const { data: known } = await sb.from("visitors").select("id, email, contact_id").eq("site_id", site.id).eq("anon_id", input.anon_id).maybeSingle();
    visitor = known;
  }
  if (!visitor && mail) {
    const { data } = await sb.from("visitors").select("id, email, contact_id").eq("site_id", site.id).eq("email", mail).order("last_seen", { ascending: false }).limit(1).maybeSingle();
    visitor = data;
  }
  if (!visitor) {
    const { data, error } = await sb
      .from("visitors")
      .insert({ site_id: site.id, workspace_id: site.workspace_id, anon_id: input.anon_id ?? `srv_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, first_seen: at, last_seen: at })
      .select("id, email, contact_id")
      .single();
    if (error || !data) return { ok: false as const, status: 500, error: "enregistrement impossible" };
    visitor = data;
  }
  if (mail) await identify(site, visitor, { email: mail, name: input.name, phone: input.phone }, at);

  const { data: ev, error } = await sb
    .from("tracking_events")
    .insert({
      site_id: site.id,
      workspace_id: site.workspace_id,
      visitor_id: visitor.id,
      type: eventType(input.type),
      name: input.type.slice(0, 80),
      value: input.value ?? null,
      currency: input.currency ?? null,
      order_id: input.order_id ?? null,
      source,
      props: cleanProps(input.props),
      ts: at,
    })
    .select("id")
    .single();
  await markSite(site.id);
  if (error?.code === DUP) return { ok: true as const, status: 200, duplicate: true };
  if (error || !ev) return { ok: false as const, status: 500, error: "enregistrement impossible" };
  return { ok: true as const, status: 201, id: ev.id, duplicate: false };
}
