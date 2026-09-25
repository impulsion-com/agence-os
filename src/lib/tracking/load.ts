import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { dayList, type Period } from "@/lib/ads/metrics";
import { NONE, DIMENSIONS, attributeTree, attributedByDay, credits, inWindow, linkCampaigns, type Conversion, type ModelId, type Touch, type TreeNode } from "./attribution";
import { isPaid, platformChannel } from "./channels";
import { readSettings, type SiteSettings } from "./settings";

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

// ---------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------
export interface SiteRow {
  id: string;
  name: string;
  company_id: string | null;
  domains: string[];
  public_key: string;
  settings: SiteSettings;
  last_event_at: string | null;
  created_at: string;
}
const SITE_COLS = "id, name, company_id, domains, public_key, settings, last_event_at, created_at";

export async function loadSites(ws: string): Promise<SiteRow[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from("tracking_sites").select(SITE_COLS).eq("workspace_id", ws).order("name");
  return (data ?? []).map((s) => ({ ...s, settings: readSettings(s.settings) }));
}

/** Clé secrète : lue seulement pour les membres qui peuvent écrire (onglet API). */
export async function loadSecret(siteId: string) {
  const sb = await supabaseServer();
  // Privilège par colonne : la clé ne se lit que par cette fonction, refusée aux invités
  const { data } = await sb.rpc("tracking_site_secret", { p_site: siteId });
  return data ?? null;
}

// ---------------------------------------------------------------------
// Tableau de bord d'attribution
// ---------------------------------------------------------------------
export type Goal = "sales" | "leads";
export const GOAL_TYPES: Record<Goal, string[]> = { sales: ["purchase", "deal_won"], leads: ["lead", "booking"] };

export interface AttrRow {
  id: string;
  level: number;
  label: string;
  sub: string | null;
  channel: string;
  spend: number | null;
  conversions: number;
  value: number;
  pconv: number | null;
  pvalue: number | null;
  children: AttrRow[];
}

export interface FlatRow {
  id: string;
  label: string;
  sub: string | null;
  channel: string | null;
  conversions: number;
  value: number;
}

export interface Kpis {
  visitors: number;
  leads: number;
  sales: number;
  revenue: number;
  spend: number;
  paidConv: number;
  paidValue: number;
  platformConv: number;
  platformValue: number;
}

export interface DailyPoint {
  spend: number;
  conv: number;
  value: number;
  paidConv: number;
  paidValue: number;
}

export interface JourneyTouch extends Touch {
  weight: number;
}
export interface Journey {
  id: string;
  ts: string;
  type: string;
  value: number;
  who: string;
  days: number;
  touches: JourneyTouch[];
}

export interface Overview {
  kpis: { cur: Kpis; prev: Kpis };
  days: string[];
  daily: DailyPoint[];
  prevDaily: DailyPoint[];
  tree: AttrRow[];
  flat: { source_medium: FlatRow[]; adset: FlatRow[]; link: FlatRow[] };
  journeys: Journey[];
  links: Record<string, string>;
  accounts: number;
  convCount: number;
}

interface RawConv {
  id: string;
  ts: string;
  type: string;
  value: number;
  person: string;
  email: string | null;
  touches: unknown;
}

interface Campaign {
  id: string;
  name: string;
  platform: string;
  spend: number;
  pconv: number;
  pvalue: number;
}

/** Email partiellement masqué : c***e@exemple.fr */
export function maskEmail(e: string | null) {
  if (!e) return "Visiteur anonyme";
  const [u, dom] = e.split("@");
  if (!dom) return "***";
  const head = u.length <= 2 ? u[0] : `${u[0]}${"*".repeat(Math.min(5, u.length - 2))}${u[u.length - 1]}`;
  return `${head}@${dom}`;
}

const inRange = (ts: string, a: string, b: string) => {
  const d = ts.slice(0, 10);
  return d >= a && d <= b;
};

/** Pour l'objectif « prospects » : une seule conversion par personne (la première de la période). */
function firstPerPerson(cs: Conversion[]) {
  const seen = new Set<string>();
  return cs.filter((c) => (seen.has(c.person) ? false : (seen.add(c.person), true)));
}

async function spendRows(sb: SB, ws: string, companyId: string | null, start: string, end: string) {
  let q = sb.from("ad_accounts").select("id, platform").eq("workspace_id", ws);
  q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
  const { data: accounts } = await q;
  const ids = (accounts ?? []).map((a) => a.id);
  const platform = new Map((accounts ?? []).map((a) => [a.id, a.platform as string]));
  if (!ids.length) return { accounts: 0, rows: [] as { date: string; campaign_id: string; campaign_name: string; platform: string; spend: number; conversions: number; value: number }[] };
  const rows = await paged<{ ad_account_id: string; date: string; campaign_id: string; campaign_name: string; spend: number; conversions: number; conversion_value: number }>((a, b) =>
    sb
      .from("ad_metrics_daily")
      .select("ad_account_id, date, campaign_id, campaign_name, spend, conversions, conversion_value")
      .in("ad_account_id", ids)
      .gte("date", start)
      .lte("date", end)
      .order("date")
      .order("campaign_id")
      .range(a, b),
  );
  return {
    accounts: ids.length,
    rows: rows.map((r) => ({
      date: r.date,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      platform: platform.get(r.ad_account_id) ?? "other",
      spend: Number(r.spend),
      conversions: Number(r.conversions),
      value: Number(r.conversion_value),
    })),
  };
}

export async function loadOverview(
  site: { id: string; company_id: string | null },
  ws: string,
  period: Period,
  opts: { model: ModelId; window: number; goal: Goal },
): Promise<Overview> {
  const sb = await supabaseServer();
  const types = [...GOAL_TYPES.sales, ...GOAL_TYPES.leads];
  const [raw, statsCur, statsPrev, spend] = await Promise.all([
    paged<RawConv>((a, b) =>
      sb.rpc("tracking_conversions", { p_site: site.id, p_start: period.prevStart, p_end: period.end, p_window: opts.window, p_types: types }).range(a, b),
    ),
    sb.rpc("tracking_stats", { p_site: site.id, p_start: period.start, p_end: period.end }),
    sb.rpc("tracking_stats", { p_site: site.id, p_start: period.prevStart, p_end: period.prevEnd }),
    spendRows(sb, ws, site.company_id, period.prevStart, period.end),
  ]);

  // Campagnes publicitaires de la période (dépense et chiffres déclarés par la plateforme)
  const camps = new Map<string, Campaign>();
  for (const r of spend.rows) {
    if (!inRange(r.date, period.start, period.end)) continue;
    const c = camps.get(r.campaign_id) ?? { id: r.campaign_id, name: r.campaign_name, platform: r.platform, spend: 0, pconv: 0, pvalue: 0 };
    c.spend += r.spend;
    c.pconv += r.conversions;
    c.pvalue += r.value;
    camps.set(r.campaign_id, c);
  }
  const allCamps = new Map<string, { id: string; name: string; platform: string }>();
  for (const r of spend.rows) allCamps.set(r.campaign_id, { id: r.campaign_id, name: r.campaign_name, platform: r.platform });

  const convs: Conversion[] = linkCampaigns(
    raw.map((c) => ({ id: c.id, ts: c.ts, type: c.type, value: Number(c.value) || 0, person: c.person, touches: (Array.isArray(c.touches) ? c.touches : []) as Touch[] })),
    [...allCamps.values()],
  );
  const emails = new Map(raw.map((c) => [c.id, c.email]));
  const cur = convs.filter((c) => inRange(c.ts, period.start, period.end));
  const prev = convs.filter((c) => inRange(c.ts, period.prevStart, period.prevEnd));
  const pick = (cs: Conversion[]) => (opts.goal === "leads" ? firstPerPerson(cs.filter((c) => GOAL_TYPES.leads.includes(c.type))) : cs.filter((c) => GOAL_TYPES.sales.includes(c.type)));
  const goalCur = pick(cur);
  const goalPrev = pick(prev);

  // ---------- Indicateurs ----------
  // ROAS et CPA réels : seulement les canaux payants dont la dépense est connue (compte associé)
  const spendChannels = new Set([...allCamps.values()].map((c) => platformChannel(c.platform)));
  const withSpend = (t: Touch | null) => !!t && isPaid(t.channel) && spendChannels.has(t.channel as ReturnType<typeof platformChannel>);
  const paidAgg = (cs: Conversion[]) => {
    let conv = 0;
    let value = 0;
    for (const c of cs)
      for (const { touch, weight } of credits(c, opts.model, opts.window))
        if (withSpend(touch)) {
          conv += weight;
          value += weight * c.value;
        }
    return { conv, value };
  };
  const kpis = (cs: Conversion[], goal: Conversion[], stats: unknown, a: string, b: string): Kpis => {
    const st = (stats ?? {}) as { visitors?: number; leads?: number };
    const sales = cs.filter((c) => GOAL_TYPES.sales.includes(c.type));
    const paid = paidAgg(goal);
    const sp = spend.rows.filter((r) => inRange(r.date, a, b));
    return {
      visitors: Number(st.visitors ?? 0),
      leads: Number(st.leads ?? 0),
      sales: sales.length,
      revenue: sales.reduce((s, c) => s + c.value, 0),
      spend: sp.reduce((s, r) => s + r.spend, 0),
      paidConv: paid.conv,
      paidValue: paid.value,
      platformConv: sp.reduce((s, r) => s + r.conversions, 0),
      platformValue: sp.reduce((s, r) => s + r.value, 0),
    };
  };

  // ---------- Séries quotidiennes ----------
  const series = (goal: Conversion[], a: string, b: string): { days: string[]; points: DailyPoint[] } => {
    const days = dayList(a, b);
    const idx = new Map(days.map((d, i) => [d, i]));
    const points = days.map(() => ({ spend: 0, conv: 0, value: 0, paidConv: 0, paidValue: 0 }));
    for (const r of spend.rows) {
      const i = idx.get(r.date);
      if (i !== undefined) points[i].spend += r.spend;
    }
    for (const c of goal) {
      const i = idx.get(c.ts.slice(0, 10));
      if (i === undefined) continue;
      points[i].conv += 1;
      points[i].value += c.value;
    }
    for (const [d, agg] of attributedByDay(goal, opts.model, opts.window, withSpend)) {
      const i = idx.get(d);
      if (i === undefined) continue;
      points[i].paidConv += agg.conversions;
      points[i].paidValue += agg.value;
    }
    return { days, points };
  };
  const sCur = series(goalCur, period.start, period.end);
  const sPrev = series(goalPrev, period.prevStart, period.prevEnd);

  // ---------- Arbre canal → campagne → annonce ----------
  const tree = attributeTree(goalCur, opts.model, opts.window, [DIMENSIONS.channel, DIMENSIONS.campaign, DIMENSIONS.ad]);
  const campRow = (key: string, channel: string, node: TreeNode | null, parent: string): AttrRow => {
    const camp = camps.get(key);
    const known = allCamps.get(key);
    const paid = isPaid(channel);
    return {
      id: `${parent}|${key}`,
      level: 1,
      label: camp?.name ?? known?.name ?? node?.sample?.campaign ?? (key === NONE ? "(sans campagne)" : key),
      sub: known || !paid || key === NONE ? null : "Campagne sans dépense rattachée",
      channel,
      spend: camp ? camp.spend : known ? 0 : paid ? null : null,
      conversions: node?.conversions ?? 0,
      value: node?.value ?? 0,
      pconv: camp ? camp.pconv : known ? 0 : null,
      pvalue: camp ? camp.pvalue : known ? 0 : null,
      children: (node?.children ?? []).filter((ad, _, all) => !(all.length === 1 && ad.key === NONE)).map((ad) => ({
        id: `${parent}|${key}|${ad.key}`,
        level: 2,
        label: ad.key === NONE ? "(annonce inconnue)" : ad.sample?.content ?? ad.key,
        sub: ad.sample?.term ?? null,
        channel,
        spend: null,
        conversions: ad.conversions,
        value: ad.value,
        pconv: null,
        pvalue: null,
        children: [],
      })),
    };
  };
  const rows: AttrRow[] = tree.map((ch) => {
    // un canal sans campagne (direct, organique) ne se déplie pas
    const children = ch.children.length === 1 && ch.children[0].key === NONE && !isPaid(ch.key) ? [] : ch.children.map((cn) => campRow(cn.key, ch.key, cn, ch.key));
    return { id: ch.key, level: 0, label: ch.key, sub: null, channel: ch.key, spend: null, conversions: ch.conversions, value: ch.value, pconv: null, pvalue: null, children };
  });
  // Campagnes avec dépense mais sans conversion attribuée : visibles sous leur canal
  for (const c of camps.values()) {
    const chKey = platformChannel(c.platform);
    let ch = rows.find((r) => r.channel === chKey);
    if (!ch) {
      ch = { id: chKey, level: 0, label: chKey, sub: null, channel: chKey, spend: null, conversions: 0, value: 0, pconv: null, pvalue: null, children: [] };
      rows.push(ch);
    }
    if (!ch.children.some((x) => x.id === `${chKey}|${c.id}`)) ch.children.push(campRow(c.id, chKey, null, chKey));
  }
  for (const r of rows) {
    const withSpend = r.children.filter((c) => c.spend !== null);
    if (withSpend.length) {
      r.spend = withSpend.reduce((s, c) => s + (c.spend ?? 0), 0);
      r.pconv = withSpend.reduce((s, c) => s + (c.pconv ?? 0), 0);
      r.pvalue = withSpend.reduce((s, c) => s + (c.pvalue ?? 0), 0);
    }
    r.children.sort((a, b) => b.value - a.value || (b.spend ?? 0) - (a.spend ?? 0));
  }
  rows.sort((a, b) => b.value - a.value || b.conversions - a.conversions || (b.spend ?? 0) - (a.spend ?? 0));

  // ---------- Vues à plat ----------
  const flat = (key: (t: Touch | null) => string, label: (n: TreeNode) => string, sub: (n: TreeNode) => string | null, skipNone = true): FlatRow[] =>
    attributeTree(goalCur, opts.model, opts.window, [key])
      .filter((n) => !skipNone || (n.key !== NONE && n.key !== "none"))
      .map((n) => ({ id: n.key, label: label(n), sub: sub(n), channel: n.sample?.channel ?? null, conversions: n.conversions, value: n.value }));

  const linkIds = [...new Set(goalCur.flatMap((c) => c.touches.map((t) => t.link_id).filter((x): x is string => !!x)))];
  const links: Record<string, string> = {};
  if (linkIds.length) {
    const { data } = await sb.from("links").select("id, name, code").in("id", linkIds);
    for (const l of data ?? []) links[l.id] = l.name || (l.code ? `/l/${l.code}` : l.id);
  }

  // ---------- Parcours : dernières conversions ----------
  const journeys: Journey[] = [...goalCur]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 30)
    .map((c) => {
      const w = new Map(credits(c, opts.model, opts.window).map((x) => [x.touch, x.weight]));
      const ts = inWindow(c, opts.window);
      return {
        id: c.id,
        ts: c.ts,
        type: c.type,
        value: c.value,
        who: maskEmail(emails.get(c.id) ?? null),
        days: ts.length ? Math.max(0, Math.round((Date.parse(c.ts) - Date.parse(ts[0].ts)) / 864e5)) : 0,
        touches: ts.map((t) => ({ ...t, weight: w.get(t) ?? 0 })),
      };
    });

  return {
    kpis: {
      cur: kpis(cur, goalCur, statsCur.data, period.start, period.end),
      prev: kpis(prev, goalPrev, statsPrev.data, period.prevStart, period.prevEnd),
    },
    days: sCur.days,
    daily: sCur.points,
    prevDaily: sPrev.points,
    tree: rows,
    flat: {
      source_medium: flat(DIMENSIONS.source_medium, (n) => n.key, () => null),
      adset: flat(DIMENSIONS.adset, (n) => n.sample?.term ?? n.key, (n) => allCamps.get(n.sample?.campaign_key ?? "")?.name ?? n.sample?.campaign ?? null),
      link: flat(DIMENSIONS.link, (n) => links[n.key] ?? n.key, (n) => n.sample?.campaign ?? null),
    },
    journeys,
    links,
    accounts: spend.accounts,
    convCount: goalCur.length,
  };
}

// ---------------------------------------------------------------------
// Personnes identifiées
// ---------------------------------------------------------------------
export interface Person {
  email: string;
  name: string | null;
  phone: string | null;
  visitors: number;
  contact_id: string | null;
  first_seen: string;
  last_seen: string;
  identified_at: string | null;
  purchases: number;
  revenue: number;
  leads: number;
}

export async function loadPeople(siteId: string, q: string): Promise<Person[]> {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("tracking_people", { p_site: siteId, p_q: q.slice(0, 80), p_limit: 100 });
  return (data ?? []).map((p) => ({ ...p, revenue: Number(p.revenue) }));
}
