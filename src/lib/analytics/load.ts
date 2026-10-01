import "server-only";

import type { Period } from "@/lib/ads/metrics";
import { supabaseServer } from "@/lib/supabase/server";
import { SOURCE_COLS, type AnalyticsSource, type SiteAnalytics } from "./types";

type SB = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Analytics de site d'un client sur une période (GA4, Clarity, tracking first-party), via la RPC
 * site_analytics réservée aux membres de l'espace. Null si le client n'a aucune source.
 */
export async function loadSiteAnalytics(companyId: string, period: Pick<Period, "start" | "end" | "prevStart" | "prevEnd">, client?: SB): Promise<SiteAnalytics | null> {
  const sb = client ?? (await supabaseServer());
  const { data, error } = await sb.rpc("site_analytics", {
    p_company: companyId,
    p_start: period.start,
    p_end: period.end,
    p_prev_start: period.prevStart,
    p_prev_end: period.prevEnd,
  });
  if (error || !data) return null;
  return data as unknown as SiteAnalytics;
}

export interface SiteOverviewRow {
  company_id: string;
  sessions: number;
  key_events: number;
  revenue: number;
}

/** Sessions et évènements clés GA4 par client, pour le tableau du reporting global. */
export async function loadSiteOverview(ws: string, period: Pick<Period, "start" | "end">): Promise<SiteOverviewRow[]> {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("analytics_overview", { p_ws: ws, p_start: period.start, p_end: period.end });
  return (data ?? []).map((r) => ({ company_id: r.company_id, sessions: Number(r.sessions), key_events: Number(r.key_events), revenue: Number(r.revenue) }));
}

/** Sources d'analytics de l'espace (Réglages > Connexions). Aucun jeton : ils ne quittent jamais le serveur. */
export async function loadAnalyticsSources(ws: string): Promise<AnalyticsSource[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("analytics_sources").select(SOURCE_COLS).eq("workspace_id", ws).order("name");
  return (data ?? []) as unknown as AnalyticsSource[];
}
