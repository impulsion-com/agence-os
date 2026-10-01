import "server-only";

import { AdsError } from "@/lib/ads/config";
import { googleAccessToken } from "@/lib/ads/google";
import { supabaseAdmin } from "@/lib/supabase/server";
import { clarityInsights } from "./clarity";
import { CLARITY_CALLS, clarityDailyShare, clarityPlan, clarityRows, type ClarityRow } from "./clarity-rows";
import { ga4Fetch } from "./ga4";
import { ga4Window } from "./ga4-rows";
import type { AnalyticsSyncResult } from "./types";

// Synchro de l'analytics de site, branchée sur la synchro du reporting (bouton « Synchroniser »,
// POST /api/reporting/sync, cron quotidien /api/cron/sync).
//  - GA4 : 90 jours à la première synchro, puis 7 jours glissants réécrits (deux appels par propriété) ;
//  - Clarity : un instantané de 24 heures par jour, trois requêtes par projet (voir clarity-rows.ts).
// Les sources de démonstration ne sont jamais synchronisées.

type Admin = ReturnType<typeof supabaseAdmin>;

export interface SyncSource {
  id: string;
  workspace_id: string;
  kind: string;
  connection_id: string | null;
  external_id: string;
  name: string;
  settings: unknown;
  first_synced_at: string | null;
  last_synced_at: string | null;
}

const SOURCE = "id, workspace_id, kind, connection_id, external_id, name, settings, first_synced_at, last_synced_at";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const settingsOf = (s: SyncSource) => (s.settings && typeof s.settings === "object" ? (s.settings as { key_event?: string | null }) : {});

async function insertAll<T extends object>(run: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>, rows: T[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await run(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

// ---------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------
/** Synchronise une propriété GA4 avec un jeton d'accès déjà valide. La fenêtre est supprimée puis réécrite. */
export async function syncGa4Source(admin: Admin, src: SyncSource, token: string, opts: { full?: boolean; now?: Date } = {}): Promise<AnalyticsSyncResult> {
  const now = opts.now ?? new Date();
  const { since, until } = ga4Window(now, src.first_synced_at, opts.full);
  try {
    const data = await ga4Fetch(token, src.external_id, since, until, { keyEvent: settingsOf(src).key_event });
    const base = { source_id: src.id, workspace_id: src.workspace_id };
    for (const table of ["ga4_channels_daily", "ga4_pages_daily", "ga4_dims_daily"] as const) {
      const del = await admin.from(table).delete().eq("source_id", src.id).gte("date", since).lte("date", until);
      if (del.error) throw new Error(del.error.message);
    }
    await insertAll((c) => admin.from("ga4_channels_daily").upsert(c, { onConflict: "source_id,date,channel,source,medium" }), data.channels.map((r) => ({ ...base, ...r })));
    await insertAll((c) => admin.from("ga4_dims_daily").upsert(c, { onConflict: "source_id,date,dim,value" }), data.dims.map((r) => ({ ...base, ...r })));
    await insertAll((c) => admin.from("ga4_pages_daily").upsert(c, { onConflict: "source_id,date,page" }), data.pages.map((r) => ({ ...base, ...r })));
    const stamp = now.toISOString();
    await admin
      .from("analytics_sources")
      .update({
        last_synced_at: stamp,
        first_synced_at: src.first_synced_at ?? stamp,
        sync_error: null,
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.timezone ? { timezone: data.timezone } : {}),
      })
      .eq("id", src.id);
    return { account_id: src.id, name: src.name, kind: "ga4", ok: true, rows: data.channels.length + data.dims.length + data.pages.length };
  } catch (e) {
    const error = errMsg(e);
    await admin.from("analytics_sources").update({ sync_error: error }).eq("id", src.id);
    return { account_id: src.id, name: src.name, kind: "ga4", ok: false, error };
  }
}

// ---------------------------------------------------------------------
// Clarity
// ---------------------------------------------------------------------
/**
 * Prend l'instantané Clarity du jour (3 requêtes), sauf si la dernière synchro a moins de 8 heures.
 * Si la première requête échoue, rien n'est écrit. Si une requête suivante échoue (quota atteint),
 * ce qui a été lu est gardé et l'erreur est affichée : les requêtes déjà dépensées ne sont pas perdues.
 */
export async function syncClaritySource(admin: Admin, src: SyncSource, token: string, opts: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<AnalyticsSyncResult> {
  const now = opts.now ?? new Date();
  const plan = clarityPlan(now, src.last_synced_at);
  if (plan.skip) return { account_id: src.id, name: src.name, kind: "clarity", ok: true, skipped: plan.reason };

  const rows: ClarityRow[] = [];
  let partial: string | null = null;
  for (const [i, c] of CLARITY_CALLS.entries()) {
    try {
      rows.push(...clarityRows(await clarityInsights(token, plan.numOfDays, c.dimensions, opts.fetchImpl), c.scope));
    } catch (e) {
      const error = errMsg(e);
      if (i === 0) {
        await admin.from("analytics_sources").update({ sync_error: error }).eq("id", src.id);
        return { account_id: src.id, name: src.name, kind: "clarity", ok: false, error, code: e instanceof AdsError ? e.code : undefined };
      }
      partial = `Instantané partiel : ${error}`;
      // Jeton refusé ou quota atteint : inutile de dépenser la requête suivante
      if (e instanceof AdsError && (e.code === "quota" || e.code === "token")) break;
    }
  }

  try {
    const n = plan.dates.length;
    const shared = clarityDailyShare(rows, n);
    const del = await admin.from("clarity_daily").delete().eq("source_id", src.id).in("date", plan.dates);
    if (del.error) throw new Error(del.error.message);
    const list = plan.dates.flatMap((date) => shared.map((r) => ({ ...r, source_id: src.id, workspace_id: src.workspace_id, date, window_days: n })));
    await insertAll((c) => admin.from("clarity_daily").upsert(c, { onConflict: "source_id,date,scope,key,device" }), list);
    const stamp = now.toISOString();
    await admin
      .from("analytics_sources")
      .update({ last_synced_at: stamp, first_synced_at: src.first_synced_at ?? stamp, sync_error: partial })
      .eq("id", src.id);
    return partial
      ? { account_id: src.id, name: src.name, kind: "clarity", ok: false, rows: list.length, error: partial }
      : { account_id: src.id, name: src.name, kind: "clarity", ok: true, rows: list.length };
  } catch (e) {
    const error = errMsg(e);
    await admin.from("analytics_sources").update({ sync_error: error }).eq("id", src.id);
    return { account_id: src.id, name: src.name, kind: "clarity", ok: false, error };
  }
}

// ---------------------------------------------------------------------
// Espace
// ---------------------------------------------------------------------
/**
 * Synchronise les sources d'analytics d'un espace (ou une seule). Une propriété GA4 sans connexion
 * (connexion supprimée) et une source de démonstration sont ignorées.
 */
export async function syncAnalytics(workspaceId: string, opts: { sourceId?: string; full?: boolean } = {}): Promise<AnalyticsSyncResult[]> {
  const admin = supabaseAdmin();
  let q = admin.from("analytics_sources").select(SOURCE).eq("workspace_id", workspaceId).eq("is_demo", false);
  if (opts.sourceId) q = q.eq("id", opts.sourceId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const sources = (data ?? []) as SyncSource[];
  const results: AnalyticsSyncResult[] = [];

  // GA4 : un jeton d'accès par connexion. La connexion doit appartenir au même espace que la source.
  const ga4 = sources.filter((s) => s.kind === "ga4" && s.connection_id);
  if (ga4.length) {
    const { data: conns } = await admin
      .from("ad_connections")
      .select("id, refresh_token")
      .eq("workspace_id", workspaceId)
      .eq("platform", "ga4")
      .in("id", [...new Set(ga4.map((s) => s.connection_id!))]);
    for (const s of ga4.filter((x) => !(conns ?? []).some((c) => c.id === x.connection_id))) {
      results.push({ account_id: s.id, name: s.name, kind: "ga4", ok: false, error: "Connexion Google Analytics introuvable : reconnecte Google Analytics puis rattache la propriété." });
    }
    for (const conn of conns ?? []) {
      const list = ga4.filter((s) => s.connection_id === conn.id);
      let token: string;
      try {
        if (!conn.refresh_token) throw new AdsError("Connexion Google Analytics sans refresh token : reconnecte Google Analytics.", "token");
        token = await googleAccessToken(conn.refresh_token);
      } catch (e) {
        const msg = errMsg(e);
        await admin.from("analytics_sources").update({ sync_error: msg }).in("id", list.map((s) => s.id));
        await admin.from("ad_connections").update({ last_error: msg }).eq("id", conn.id);
        results.push(...list.map((s) => ({ account_id: s.id, name: s.name, kind: "ga4" as const, ok: false, error: msg })));
        continue;
      }
      // Séquentiel : ménage les quotas de la Data API
      for (const s of list) results.push(await syncGa4Source(admin, s, token, { full: opts.full }));
    }
  }

  // Clarity : le jeton de chaque projet est dans analytics_secrets (service role uniquement)
  const clarity = sources.filter((s) => s.kind === "clarity");
  if (clarity.length) {
    const { data: secrets } = await admin.from("analytics_secrets").select("source_id, token").in("source_id", clarity.map((s) => s.id));
    const tokens = new Map((secrets ?? []).map((x) => [x.source_id, x.token]));
    for (const s of clarity) {
      const token = tokens.get(s.id);
      if (!token) {
        const msg = "Jeton API Clarity manquant : colle-le à nouveau dans Réglages > Connexions.";
        await admin.from("analytics_sources").update({ sync_error: msg }).eq("id", s.id);
        results.push({ account_id: s.id, name: s.name, kind: "clarity", ok: false, error: msg });
        continue;
      }
      results.push(await syncClaritySource(admin, s, token));
    }
  }
  return results;
}

/** Cron : tous les espaces qui ont au moins une source réelle. */
export async function syncAllAnalytics() {
  const admin = supabaseAdmin();
  const { data } = await admin.from("analytics_sources").select("workspace_id").eq("is_demo", false);
  const ids = [...new Set((data ?? []).map((r) => r.workspace_id))];
  const out: { workspace_id: string; results: AnalyticsSyncResult[] }[] = [];
  for (const id of ids) {
    try {
      out.push({ workspace_id: id, results: await syncAnalytics(id) });
    } catch (e) {
      out.push({ workspace_id: id, results: [{ account_id: "", name: "", kind: "ga4", ok: false, error: errMsg(e) }] });
    }
  }
  return out;
}
