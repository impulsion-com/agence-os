import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { withPrevious, type Period } from "./metrics";
import type { TrackedAccount } from "./types";

type SB = Awaited<ReturnType<typeof supabaseServer>>;

const PAGE = 1000;

/** Lit toutes les pages d'une requête (PostgREST plafonne à 1 000 lignes). */
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

export interface DailyRow {
  ad_account_id: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

export interface CampaignRow {
  ad_account_id: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

export interface ReportListItem {
  id: string;
  company_id: string;
  title: string;
  period_start: string;
  period_end: string;
  shared: boolean;
  public_token: string;
  created_at: string;
}

const ACCOUNT_COLS = "id, connection_id, company_id, platform, external_id, name, currency, login_customer_id, last_synced_at, first_synced_at, sync_error";
const REPORT_COLS = "id, company_id, title, period_start, period_end, shared, public_token, created_at";

async function daily(sb: SB, ws: string, start: string, end: string, company?: string) {
  const rows = await paged<DailyRow>((a, b) =>
    sb.rpc("ad_daily", { p_ws: ws, p_start: start, p_end: end, ...(company ? { p_company: company } : {}) }).range(a, b),
  );
  return rows.map((r) => ({
    ...r,
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    conversions: Number(r.conversions),
    conversion_value: Number(r.conversion_value),
  }));
}

/** Données de /reporting (tous les clients). */
export async function loadOverview(ws: string, period: Period) {
  const sb = await supabaseServer();
  const [accounts, rows, targets, reports, conns] = await Promise.all([
    sb.from("ad_accounts").select(ACCOUNT_COLS).eq("workspace_id", ws).order("name"),
    daily(sb, ws, period.prevStart, period.end),
    sb.from("kpi_targets").select("company_id, metric, target").eq("workspace_id", ws),
    sb.from("reports").select(REPORT_COLS).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(300),
    sb.from("ad_connections_public").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
  ]);
  return {
    accounts: (accounts.data ?? []) as TrackedAccount[],
    rows,
    targets: (targets.data ?? []).map((t) => ({ ...t, target: Number(t.target) })),
    reports: (reports.data ?? []) as ReportListItem[],
    connections: conns.count ?? 0,
  };
}

/** Données de /reporting/[companyId]. */
export async function loadCompany(ws: string, companyId: string, period: Period) {
  const sb = await supabaseServer();
  const camp = (start: string, end: string) =>
    paged<CampaignRow>((a, b) => sb.rpc("ad_campaigns", { p_ws: ws, p_start: start, p_end: end, p_company: companyId }).range(a, b));
  const [company, accounts, rows, campaigns, prevCampaigns, targets, reports] = await Promise.all([
    sb.from("companies").select("id, name, color, status, website, industry").eq("id", companyId).eq("workspace_id", ws).maybeSingle(),
    sb.from("ad_accounts").select(ACCOUNT_COLS).eq("workspace_id", ws).eq("company_id", companyId).order("name"),
    daily(sb, ws, period.prevStart, period.end, companyId),
    camp(period.start, period.end),
    camp(period.prevStart, period.prevEnd),
    sb.from("kpi_targets").select("id, metric, target").eq("company_id", companyId),
    sb.from("reports").select(REPORT_COLS).eq("company_id", companyId).order("created_at", { ascending: false }),
  ]);
  const num = (r: CampaignRow) => ({
    ...r,
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    conversions: Number(r.conversions),
    conversion_value: Number(r.conversion_value),
  });
  return {
    company: company.data,
    accounts: (accounts.data ?? []) as TrackedAccount[],
    rows,
    campaigns: campaigns.map(num),
    prevCampaigns: prevCampaigns.map(num),
    targets: (targets.data ?? []).map((t) => ({ ...t, target: Number(t.target) })),
    reports: (reports.data ?? []) as ReportListItem[],
  };
}

// ---------------------------------------------------------------------
// Rapport : même forme que la RPC public_report (aperçu = version client)
// ---------------------------------------------------------------------
export interface ReportData {
  report: {
    id: string;
    company_id: string;
    title: string;
    period_start: string;
    period_end: string;
    commentary: string;
    next_steps: string;
    shared: boolean;
    created_at: string;
  };
  workspace: { name: string; accent: string; currency: string };
  company: { name: string };
  targets: Record<string, number>;
  accounts: { id: string; platform: string; name: string; currency: string }[];
  metrics: {
    account: string;
    date: string;
    campaign: string;
    campaign_id?: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    value: number;
  }[];
}

export async function loadReport(ws: { id: string; name: string; accent: string; currency: string }, reportId: string) {
  const sb = await supabaseServer();
  const { data: r } = await sb
    .from("reports")
    .select("id, company_id, title, period_start, period_end, commentary, next_steps, shared, created_at, public_token")
    .eq("id", reportId)
    .eq("workspace_id", ws.id)
    .maybeSingle();
  if (!r) return null;
  const p = withPrevious("custom", r.period_start, r.period_end);
  const [company, accounts, targets] = await Promise.all([
    sb.from("companies").select("name").eq("id", r.company_id).maybeSingle(),
    sb.from("ad_accounts").select("id, platform, name, currency").eq("company_id", r.company_id),
    sb.from("kpi_targets").select("metric, target").eq("company_id", r.company_id),
  ]);
  const ids = (accounts.data ?? []).map((a) => a.id);
  const metrics = ids.length
    ? await paged<{
        ad_account_id: string;
        date: string;
        campaign_id: string;
        campaign_name: string;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        conversion_value: number;
      }>((a, b) =>
        sb
          .from("ad_metrics_daily")
          .select("ad_account_id, date, campaign_id, campaign_name, spend, impressions, clicks, conversions, conversion_value")
          .in("ad_account_id", ids)
          .gte("date", p.prevStart)
          .lte("date", p.end)
          .order("date")
          .order("ad_account_id")
          .order("campaign_id")
          .range(a, b),
      )
    : [];
  const { public_token, ...report } = r;
  const data: ReportData = {
    report,
    workspace: { name: ws.name, accent: ws.accent, currency: ws.currency },
    company: { name: company.data?.name ?? "" },
    targets: Object.fromEntries((targets.data ?? []).map((t) => [t.metric, Number(t.target)])),
    accounts: accounts.data ?? [],
    metrics: metrics.map((m) => ({
      account: m.ad_account_id,
      date: m.date,
      campaign: m.campaign_name,
      campaign_id: m.campaign_id,
      spend: Number(m.spend),
      impressions: Number(m.impressions),
      clicks: Number(m.clicks),
      conversions: Number(m.conversions),
      value: Number(m.conversion_value),
    })),
  };
  return { data, publicToken: public_token };
}
