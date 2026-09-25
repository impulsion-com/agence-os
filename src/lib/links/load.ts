import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { Period } from "@/lib/ads/metrics";
import type { Preset } from "./utm";

export interface LinkRow {
  id: string;
  company_id: string | null;
  site_id: string | null;
  name: string;
  destination: string;
  utm: unknown;
  final_url: string;
  code: string | null;
  tags: string[];
  active: boolean;
  expires_at: string | null;
  clicks: number;
  last_click_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Attribution {
  visitors: number;
  leads: number;
  sales: number;
  revenue: number;
}

export interface SiteLite {
  id: string;
  name: string;
  company_id: string | null;
  domains: string[];
}

const LINK_COLS = "id, company_id, site_id, name, destination, utm, final_url, code, tags, active, expires_at, clicks, last_click_at, created_by, created_at";

async function attribution(ws: string, link?: string, from?: string, to?: string) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("link_attribution", { p_ws: ws, p_link: link, p_from: from, p_to: to });
  if (error) return {} as Record<string, Attribution>;
  return Object.fromEntries(
    (data ?? []).map((r) => [r.link_id, { visitors: Number(r.visitors), leads: Number(r.leads), sales: Number(r.sales), revenue: Number(r.revenue) }]),
  ) as Record<string, Attribution>;
}

async function trackingInstalled(ws: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("tracking_sites").select("id, last_event_at").eq("workspace_id", ws);
  return { sites: (data ?? []).length, active: (data ?? []).some((s) => s.last_event_at) };
}

export async function loadLinks(ws: string) {
  const sb = await supabaseServer();
  const [links, attr, tracking] = await Promise.all([
    sb.from("links").select(LINK_COLS).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(2000),
    attribution(ws),
    trackingInstalled(ws),
  ]);
  return { links: (links.data ?? []) as LinkRow[], attribution: attr, tracking };
}

export async function loadEditor(ws: string, linkId?: string | null) {
  const sb = await supabaseServer();
  const [presets, settings, sites, tags, link] = await Promise.all([
    sb.from("utm_presets").select("*").eq("workspace_id", ws).order("position"),
    sb.from("link_settings").select("naming_rule, naming_help").eq("workspace_id", ws).maybeSingle(),
    sb.from("tracking_sites").select("id, name, company_id, domains").eq("workspace_id", ws).order("name"),
    sb.from("links").select("tags").eq("workspace_id", ws).limit(1000),
    linkId ? sb.from("links").select(LINK_COLS).eq("workspace_id", ws).eq("id", linkId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    presets: (presets.data ?? []) as Preset[],
    rule: settings.data?.naming_rule ?? "",
    ruleHelp: settings.data?.naming_help ?? "",
    sites: (sites.data ?? []) as SiteLite[],
    tags: [...new Set((tags.data ?? []).flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, "fr")),
    link: (link.data ?? null) as LinkRow | null,
  };
}

/** Minuit d'un jour donné dans un fuseau, en instant UTC. */
function zonedMidnight(day: string, tz = STATS_TZ) {
  const utc = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(utc);
  const g = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const offset = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - utc.getTime();
  return new Date(utc.getTime() - offset);
}

export const STATS_TZ = "Europe/Paris";

export interface LinkStats {
  humans: number;
  bots: number;
  prev_humans: number | null;
  days: { d: string; h: number; b: number }[];
  hours: { k: number; n: number }[];
  referrers: { k: string; n: number }[];
  devices: { k: string; n: number }[];
  browsers: { k: string; n: number }[];
  os: { k: string; n: number }[];
  countries: { k: string; n: number }[];
}

export async function loadLinkStats(ws: string, id: string, period: Period) {
  const sb = await supabaseServer();
  const { data: link } = await sb.from("links").select(LINK_COLS).eq("workspace_id", ws).eq("id", id).maybeSingle();
  if (!link) return null;
  // Bornes en heure de Paris, comme les statistiques
  const from = zonedMidnight(period.start).toISOString();
  const end = zonedMidnight(period.end);
  end.setTime(end.getTime() + 864e5);
  const [stats, attr, total, tracking] = await Promise.all([
    sb.rpc("link_stats", { p_link: id, p_from: period.start, p_to: period.end, p_tz: STATS_TZ, p_prev_from: period.prevStart, p_prev_to: period.prevEnd }),
    attribution(ws, id, from, end.toISOString()),
    attribution(ws, id),
    trackingInstalled(ws),
  ]);
  const zero: Attribution = { visitors: 0, leads: 0, sales: 0, revenue: 0 };
  return {
    link: link as LinkRow,
    stats: (stats.data ?? { humans: 0, bots: 0, prev_humans: 0, days: [], hours: [], referrers: [], devices: [], browsers: [], os: [], countries: [] }) as unknown as LinkStats,
    attribution: attr[id] ?? zero,
    attributionTotal: total[id] ?? zero,
    tracking,
  };
}

export async function loadUtmSettings(ws: string) {
  const sb = await supabaseServer();
  const [presets, settings] = await Promise.all([
    sb.from("utm_presets").select("*").eq("workspace_id", ws).order("position"),
    sb.from("link_settings").select("naming_rule, naming_help").eq("workspace_id", ws).maybeSingle(),
  ]);
  return { presets: (presets.data ?? []) as Preset[], rule: settings.data?.naming_rule ?? "", ruleHelp: settings.data?.naming_help ?? "" };
}
