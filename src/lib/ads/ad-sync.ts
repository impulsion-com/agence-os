import "server-only";

import type { supabaseAdmin } from "@/lib/supabase/server";
import { googleAdCatalog, googleAdMetrics } from "./google";
import { metaAdCatalog, metaAdInsights } from "./meta";
import type { FetchedAd, FetchedAdRow } from "./types";

// Synchro au niveau annonce (bibliothèque créa). Appelée par syncOne après la synchro
// campagne, sur la même fenêtre (90 jours puis 7 jours glissants), et idempotente :
// la fenêtre est supprimée puis réécrite, le catalogue est mis à jour par upsert.

type Admin = ReturnType<typeof supabaseAdmin>;

export interface AdSyncAccount {
  id: string;
  workspace_id: string;
  platform: string;
  external_id: string;
  login_customer_id: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function merge(rows: FetchedAdRow[]) {
  const byKey = new Map<string, FetchedAdRow>();
  const addN = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  for (const r of rows) {
    const k = `${r.date}|${r.ad_id}`;
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { ...r });
    else {
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      cur.reach = addN(cur.reach, r.reach);
      cur.clicks += r.clicks;
      cur.conversions += r.conversions;
      cur.conversion_value += r.conversion_value;
      cur.video_3s = addN(cur.video_3s, r.video_3s);
      cur.video_p25 = addN(cur.video_p25, r.video_p25);
      cur.video_p50 = addN(cur.video_p50, r.video_p50);
      cur.video_p75 = addN(cur.video_p75, r.video_p75);
      cur.video_p100 = addN(cur.video_p100, r.video_p100);
      cur.thruplay = addN(cur.thruplay, r.thruplay);
    }
  }
  return [...byKey.values()];
}

/** Récupère et écrit les métriques par annonce d'un compte. Renvoie le nombre de lignes. */
export async function syncAccountAds(admin: Admin, acc: AdSyncAccount, token: string, since: string, until: string): Promise<number> {
  const google = acc.platform === "google";
  const rows = merge(
    google ? await googleAdMetrics(token, acc.external_id, since, until, acc.login_customer_id) : await metaAdInsights(token, acc.external_id, since, until),
  );

  const del = await admin.from("ad_metrics_ad_daily").delete().eq("ad_account_id", acc.id).gte("date", since).lte("date", until);
  if (del.error) throw new Error(del.error.message);
  const list = rows.map((r) => ({
    ad_account_id: acc.id,
    workspace_id: acc.workspace_id,
    date: r.date,
    campaign_id: r.campaign_id,
    adset_id: r.adset_id,
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    spend: r2(r.spend),
    impressions: Math.round(r.impressions),
    reach: r.reach === null ? null : Math.round(r.reach),
    clicks: Math.round(r.clicks),
    conversions: r2(r.conversions),
    conversion_value: r2(r.conversion_value),
    video_3s: r.video_3s === null ? null : Math.round(r.video_3s),
    video_p25: r.video_p25 === null ? null : Math.round(r.video_p25),
    video_p50: r.video_p50 === null ? null : Math.round(r.video_p50),
    video_p75: r.video_p75 === null ? null : Math.round(r.video_p75),
    video_p100: r.video_p100 === null ? null : Math.round(r.video_p100),
    thruplay: r.thruplay === null ? null : Math.round(r.thruplay),
  }));
  for (let i = 0; i < list.length; i += 500) {
    const up = await admin.from("ad_metrics_ad_daily").upsert(list.slice(i, i + 500), { onConflict: "ad_account_id,date,ad_id" });
    if (up.error) throw new Error(up.error.message);
  }

  // Catalogue : uniquement les annonces diffusées sur la fenêtre
  const ids = [...new Set(rows.map((r) => r.ad_id))];
  if (ids.length) {
    let catalog: FetchedAd[] = [];
    try {
      catalog = google
        ? await googleAdCatalog(token, acc.external_id, ids, acc.login_customer_id)
        : await metaAdCatalog(token, acc.external_id, ids);
    } catch {
      // Catalogue facultatif : on retombe sur les noms vus dans les métriques
      const seen = new Map(rows.map((r) => [r.ad_id, r]));
      catalog = ids.map((id) => ({
        ad_id: id,
        name: seen.get(id)?.ad_name ?? "",
        campaign_id: seen.get(id)?.campaign_id ?? null,
        campaign_name: "",
        adset_id: seen.get(id)?.adset_id ?? null,
        adset_name: "",
        status: null,
        format: null,
        thumbnail_url: null,
        frequency_7d: null,
        reach_7d: null,
      }));
    }
    const now = new Date().toISOString();
    const cat = catalog.map((a) => ({ ...a, ad_account_id: acc.id, workspace_id: acc.workspace_id, synced_at: now }));
    for (let i = 0; i < cat.length; i += 500) {
      const up = await admin.from("ad_ads").upsert(cat.slice(i, i + 500), { onConflict: "ad_account_id,ad_id" });
      if (up.error) throw new Error(up.error.message);
    }
  }
  return list.length;
}
