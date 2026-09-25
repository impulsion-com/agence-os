import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { AdsError, FIRST_SYNC_DAYS, ROLLING_SYNC_DAYS } from "./config";
import { googleAccessToken, googleListAccounts, googleMetrics } from "./google";
import { metaInsights, metaListAccounts } from "./meta";
import type { AvailableAccount, FetchedRow, SyncResult } from "./types";

type Admin = ReturnType<typeof supabaseAdmin>;

interface ConnRow {
  id: string;
  workspace_id: string;
  platform: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}
interface AccRow {
  id: string;
  workspace_id: string;
  connection_id: string | null;
  platform: string;
  external_id: string;
  name: string;
  login_customer_id: string | null;
  first_synced_at: string | null;
}

const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoUTC(new Date(Date.now() - n * 864e5));

const errMsg = (e: unknown) => (e instanceof AdsError ? e.message : e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Jeton d'accès utilisable pour une connexion (rafraîchi pour Google). */
export async function accessTokenFor(conn: ConnRow): Promise<string> {
  if (conn.platform === "google") {
    if (!conn.refresh_token) throw new AdsError("Connexion Google sans refresh token : reconnecte Google Ads.", "token");
    return googleAccessToken(conn.refresh_token);
  }
  if (conn.expires_at && new Date(conn.expires_at).getTime() < Date.now())
    throw new AdsError("Le jeton Meta a expiré : reconnecte Meta dans Réglages > Connexions publicitaires.", "token");
  return conn.access_token;
}

/** Relit la liste des comptes accessibles et la met en cache sur la connexion. */
export async function refreshConnectionAccounts(admin: Admin, conn: ConnRow, token?: string): Promise<AvailableAccount[]> {
  try {
    const t = token ?? (await accessTokenFor(conn));
    const accounts = conn.platform === "google" ? await googleListAccounts(t) : await metaListAccounts(t);
    await admin
      .from("ad_connections")
      .update({ accounts: accounts as unknown as never, accounts_refreshed_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);
    return accounts;
  } catch (e) {
    await admin.from("ad_connections").update({ last_error: errMsg(e) }).eq("id", conn.id);
    throw e;
  }
}

async function fetchRows(acc: AccRow, token: string, since: string, until: string): Promise<FetchedRow[]> {
  if (acc.platform === "google") return googleMetrics(token, acc.external_id, since, until, acc.login_customer_id);
  return metaInsights(token, acc.external_id, since, until);
}

/** Remplace les métriques de la fenêtre par celles de la plateforme. */
async function writeRows(admin: Admin, acc: AccRow, rows: FetchedRow[], since: string, until: string) {
  // Agrège d'éventuels doublons (même campagne, même jour)
  const byKey = new Map<string, FetchedRow>();
  for (const r of rows) {
    const k = `${r.date}|${r.campaign_id}`;
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { ...r });
    else {
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.conversions += r.conversions;
      cur.conversion_value += r.conversion_value;
    }
  }
  const del = await admin.from("ad_metrics_daily").delete().eq("ad_account_id", acc.id).gte("date", since).lte("date", until);
  if (del.error) throw new Error(del.error.message);
  const list = [...byKey.values()].map((r) => ({
    ad_account_id: acc.id,
    workspace_id: acc.workspace_id,
    date: r.date,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    spend: Math.round(r.spend * 100) / 100,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    conversions: Math.round(r.conversions * 100) / 100,
    conversion_value: Math.round(r.conversion_value * 100) / 100,
  }));
  for (let i = 0; i < list.length; i += 500) {
    const up = await admin.from("ad_metrics_daily").upsert(list.slice(i, i + 500), { onConflict: "ad_account_id,date,campaign_id" });
    if (up.error) throw new Error(up.error.message);
  }
  return list.length;
}

async function syncOne(admin: Admin, acc: AccRow, token: string, full: boolean): Promise<SyncResult> {
  const until = daysAgo(0);
  const since = daysAgo(full || !acc.first_synced_at ? FIRST_SYNC_DAYS : ROLLING_SYNC_DAYS);
  try {
    const rows = await fetchRows(acc, token, since, until);
    const n = await writeRows(admin, acc, rows, since, until);
    const now = new Date().toISOString();
    await admin
      .from("ad_accounts")
      .update({ last_synced_at: now, first_synced_at: acc.first_synced_at ?? now, sync_error: null })
      .eq("id", acc.id);
    return { account_id: acc.id, name: acc.name, ok: true, rows: n };
  } catch (e) {
    const error = errMsg(e);
    await admin.from("ad_accounts").update({ sync_error: error }).eq("id", acc.id);
    return { account_id: acc.id, name: acc.name, ok: false, error };
  }
}

/**
 * Synchronise les comptes suivis d'un espace (ou un seul compte).
 * Ignore les comptes de démonstration (demo-%) et ceux sans connexion (import CSV).
 */
export async function syncWorkspace(workspaceId: string, opts: { accountId?: string; full?: boolean } = {}): Promise<SyncResult[]> {
  const admin = supabaseAdmin();
  let q = admin
    .from("ad_accounts")
    .select("id, workspace_id, connection_id, platform, external_id, name, login_customer_id, first_synced_at")
    .eq("workspace_id", workspaceId)
    .not("connection_id", "is", null)
    .in("platform", ["meta", "google"])
    .not("external_id", "like", "demo-%");
  if (opts.accountId) q = q.eq("id", opts.accountId);
  const { data: accounts, error } = await q;
  if (error) throw new Error(error.message);
  if (!accounts?.length) return [];

  const connIds = [...new Set(accounts.map((a) => a.connection_id!))];
  const { data: conns } = await admin.from("ad_connections").select("id, workspace_id, platform, access_token, refresh_token, expires_at").in("id", connIds);
  const results: SyncResult[] = [];

  for (const conn of conns ?? []) {
    const accs = accounts.filter((a) => a.connection_id === conn.id);
    let token: string;
    try {
      token = await accessTokenFor(conn);
    } catch (e) {
      const msg = errMsg(e);
      await admin.from("ad_accounts").update({ sync_error: msg }).in("id", accs.map((a) => a.id));
      await admin.from("ad_connections").update({ last_error: msg }).eq("id", conn.id);
      results.push(...accs.map((a) => ({ account_id: a.id, name: a.name, ok: false, error: msg })));
      continue;
    }
    // Séquentiel par connexion : ménage les limites de débit des plateformes
    for (const acc of accs) results.push(await syncOne(admin, acc, token, !!opts.full));
  }
  return results;
}

/** Cron : tous les espaces. */
export async function syncAllWorkspaces() {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("ad_accounts")
    .select("workspace_id")
    .not("connection_id", "is", null)
    .not("external_id", "like", "demo-%");
  const ids = [...new Set((data ?? []).map((r) => r.workspace_id))];
  const out: { workspace_id: string; results: SyncResult[] }[] = [];
  for (const id of ids) {
    try {
      out.push({ workspace_id: id, results: await syncWorkspace(id) });
    } catch (e) {
      out.push({ workspace_id: id, results: [{ account_id: "", name: "", ok: false, error: errMsg(e) }] });
    }
  }
  return out;
}
