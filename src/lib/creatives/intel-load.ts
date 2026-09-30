import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { AI_MODEL_FAST, AI_MODEL_SMART, aiEnabled } from "./ai";
import type { IntelData, Watch, RecommendationRow, IntelStatus } from "./intel-types";
import type { CompetitorAd } from "./intel-core";

const AD_COLS =
  "id, workspace_id, watch_id, archive_id, page_id, page_name, bodies, titles, descriptions, captions, start_time, stop_time, snapshot_url, platforms, languages, eu_reach, is_active, first_seen, last_seen, ai_tags, concept_id, is_demo";

/** Données des onglets Veille et Recommandations (droits de l'utilisateur). */
export async function loadIntel(ws: string): Promise<IntelData> {
  const sb = await supabaseServer();
  const ads: CompetitorAd[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await sb.from("competitor_ads").select(AD_COLS).eq("workspace_id", ws).order("first_seen", { ascending: false }).range(from, from + 999);
    if (error) break;
    ads.push(...((data ?? []) as unknown as CompetitorAd[]));
    if (!data || data.length < 1000) break;
  }
  const [watches, recs, status] = await Promise.all([
    sb
      .from("competitor_watches")
      .select("id, company_id, kind, page_id, page_name, search_terms, countries, active_only, enabled, last_synced_at, last_error, is_demo, created_at")
      .eq("workspace_id", ws)
      .order("created_at"),
    sb.from("creative_recommendations").select("id, company_id, model, output, created_concepts, is_demo, created_by, created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(50),
    sb.rpc("creative_intel_status", { ws }),
  ]);
  const s = (status.data ?? [])[0];
  const st: IntelStatus = {
    manual: s?.has_manual ? { label: s.manual_label, expires_at: s.manual_expires_at, checked_at: s.manual_checked_at, ok: s.manual_ok, error: s.manual_error } : null,
    connection: s?.has_connection ? { label: s.connection_label, expires_at: s.connection_expires_at } : null,
  };
  return {
    watches: (watches.data ?? []) as Watch[],
    ads,
    recommendations: (recs.data ?? []) as unknown as RecommendationRow[],
    status: st,
    ai: { enabled: aiEnabled(), fast: AI_MODEL_FAST(), smart: AI_MODEL_SMART() },
  };
}
