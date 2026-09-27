import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { addDays, iso, parseDay, today } from "@/lib/format";
import type { Period } from "@/lib/ads/metrics";
import { CONCEPT_COLS, type AdDay, type AdLink, type Asset, type Attribution, type CatalogAd, type Concept, type Variant } from "./types";

type SB = Awaited<ReturnType<typeof supabaseServer>>;
const PAGE = 1000;

async function paged<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Plage de lecture : période + période précédente, et au moins 60 jours pour la fatigue. */
export function readRange(p: Period) {
  const y = iso(addDays(today(), -1));
  const fat = iso(addDays(parseDay(p.end < y ? p.end : y)!, -59));
  return { start: p.prevStart < fat ? p.prevStart : fat, end: p.end };
}

async function adDaily(sb: SB, ws: string, start: string, end: string, company?: string | null): Promise<AdDay[]> {
  const rows = await paged<AdDay>((a, b) =>
    sb.rpc("creative_ad_daily", { p_ws: ws, p_start: start, p_end: end, ...(company ? { p_company: company } : {}) }).range(a, b) as never,
  );
  return rows.map((r) => ({
    ...r,
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    conversions: Number(r.conversions),
    conversion_value: Number(r.conversion_value),
    video_3s: n(r.video_3s),
    video_p25: n(r.video_p25),
    video_p50: n(r.video_p50),
    video_p75: n(r.video_p75),
    video_p100: n(r.video_p100),
    thruplay: n(r.thruplay),
  }));
}

async function catalog(sb: SB, ws: string): Promise<CatalogAd[]> {
  const rows = await paged<{
    ad_account_id: string;
    ad_id: string;
    name: string;
    campaign_name: string;
    adset_name: string;
    status: string | null;
    format: string | null;
    thumbnail_url: string | null;
    frequency_7d: number | null;
    account: { platform: string; company_id: string | null } | null;
  }>((a, b) =>
    sb
      .from("ad_ads")
      .select("ad_account_id, ad_id, name, campaign_name, adset_name, status, format, thumbnail_url, frequency_7d, account:ad_accounts(platform, company_id)")
      .eq("workspace_id", ws)
      .order("ad_id")
      .range(a, b) as never,
  );
  return rows.map(({ account, ...r }) => ({
    ...r,
    frequency_7d: n(r.frequency_7d),
    platform: account?.platform ?? "meta",
    company_id: account?.company_id ?? null,
  }));
}

async function attribution(sb: SB, ws: string, p: Period, keys: string[]): Promise<Attribution> {
  if (!keys.length) return {};
  const { data, error } = await sb.rpc("creative_ad_attribution", { p_ws: ws, p_start: p.start, p_end: p.end, p_ad_keys: keys });
  if (error) return {}; // attribution facultative (pas de tracking, délai dépassé…)
  return Object.fromEntries((data ?? []).map((r) => [r.ad_key, { sales: Number(r.sales), revenue: Number(r.revenue) }]));
}

/** Données de /creatives (galerie, tableau, production, analyse). */
export async function loadLibrary(ws: string, period: Period) {
  const sb = await supabaseServer();
  const range = readRange(period);
  const [concepts, variants, links, cat, rows] = await Promise.all([
    sb.from("creative_concepts").select(CONCEPT_COLS).eq("workspace_id", ws).order("position"),
    sb.from("creative_variants").select("id, concept_id, name, hook, notes, position").eq("workspace_id", ws).order("position"),
    sb.from("creative_ads").select("id, concept_id, variant_id, platform, ad_id").eq("workspace_id", ws),
    catalog(sb, ws),
    adDaily(sb, ws, range.start, range.end),
  ]);
  const linkRows = (links.data ?? []) as AdLink[];
  const att = await attribution(sb, ws, period, [...new Set(linkRows.map((l) => l.ad_id))]);
  return {
    concepts: (concepts.data ?? []) as unknown as Concept[],
    variants: (variants.data ?? []) as Variant[],
    links: linkRows,
    catalog: cat,
    rows,
    attribution: att,
  };
}

/** Données de la fiche concept. */
export async function loadConcept(ws: string, id: string, period: Period) {
  const sb = await supabaseServer();
  const { data: concept } = await sb.from("creative_concepts").select(CONCEPT_COLS).eq("id", id).eq("workspace_id", ws).maybeSingle();
  if (!concept) return null;
  const c = concept as unknown as Concept;
  const range = readRange(period);
  const [variants, assets, links, cat, rows, task] = await Promise.all([
    sb.from("creative_variants").select("id, concept_id, name, hook, notes, position").eq("concept_id", id).order("position"),
    sb.from("creative_assets").select("id, concept_id, variant_id, name, path, size, mime, created_at").eq("concept_id", id).order("created_at", { ascending: false }),
    sb.from("creative_ads").select("id, concept_id, variant_id, platform, ad_id").eq("workspace_id", ws),
    catalog(sb, ws),
    adDaily(sb, ws, range.start, range.end, c.company_id),
    c.task_id ? sb.from("tasks").select("id, number, title, project_id, status").eq("id", c.task_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const allLinks = (links.data ?? []) as AdLink[];
  const mine = allLinks.filter((l) => l.concept_id === id);
  const att = await attribution(sb, ws, period, [...new Set(mine.map((l) => l.ad_id))]);
  return {
    concept: c,
    variants: (variants.data ?? []) as Variant[],
    assets: (assets.data ?? []) as Asset[],
    links: mine,
    /** annonces déjà liées à un autre concept (pour le sélecteur) */
    taken: allLinks.filter((l) => l.concept_id !== id).map((l) => `${l.platform}|${l.ad_id}`),
    catalog: cat.filter((a) => !c.company_id || a.company_id === c.company_id || mine.some((l) => l.ad_id === a.ad_id)),
    rows,
    attribution: att,
    task: task.data as { id: string; number: number; title: string; project_id: string; status: string } | null,
  };
}

/** Données du brief imprimable. */
export async function loadBrief(ws: string, id: string) {
  const sb = await supabaseServer();
  const { data: concept } = await sb.from("creative_concepts").select(CONCEPT_COLS).eq("id", id).eq("workspace_id", ws).maybeSingle();
  if (!concept) return null;
  const c = concept as unknown as Concept;
  const [variants, company] = await Promise.all([
    sb.from("creative_variants").select("id, concept_id, name, hook, notes, position").eq("concept_id", id).order("position"),
    c.company_id ? sb.from("companies").select("name, website, industry").eq("id", c.company_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    concept: c,
    variants: (variants.data ?? []) as Variant[],
    company: company.data as { name: string; website: string; industry: string } | null,
  };
}
