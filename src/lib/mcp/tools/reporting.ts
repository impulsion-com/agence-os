// Outils Reporting publicitaire : performance (client ou tous) et classement des campagnes.
import { z } from "zod";

import {
  KPI_LABEL, ZERO, add, delta, fmtDelta, fmtKpi, kpi, platformName, resolvePeriod, scaledTarget, STATE_LABEL, targetState, worst, type Kpi, type Period,
  type Totals,
} from "@/lib/ads/metrics";
import {
  FRICTION_KEYS, FRICTION_META, change, channelName, clarityInsights, claritySplit, deviceName, fmtDuration, fmtInt, fmtMoney, fmtPct, fmtSiteKpi, frictionRate, ga4Split,
  paidTotals, problemPages, rate, siteKpi, type SiteKpi,
} from "@/lib/analytics/calc";
import type { SiteAnalytics } from "@/lib/analytics/types";
import type { KpiMetric } from "@/lib/types";
import { companiesLite, resolveCompany, table, truncate, url } from "../helpers";
import { ToolError, defineTool, type McpContext } from "../types";

export const PERIOD_KEYS = ["7d", "30d", "mtd", "lastmonth", "90d"] as const;

export const periodInput = {
  period: z.enum(PERIOD_KEYS).default("30d").describe("7d, 30d (défaut), mtd (mois en cours), lastmonth (mois dernier), 90d. Les périodes glissantes s'arrêtent hier."),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Début d'une période personnalisée (AAAA-MM-JJ), avec to"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fin d'une période personnalisée (AAAA-MM-JJ)"),
};

export function periodOf(a: { period: string; from?: string; to?: string }): Period {
  if (a.from || a.to) {
    if (!a.from || !a.to || a.from > a.to) throw new ToolError("Période personnalisée : indique from et to (AAAA-MM-JJ), from avant to.");
    return resolvePeriod({ period: "custom", from: a.from, to: a.to });
  }
  return resolvePeriod({ period: a.period });
}

const PAGE = 1000;
interface MetricRow {
  ad_account_id: string;
  date: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

/** Lignes quotidiennes par campagne de l'espace (ou d'une liste de comptes), toutes pages lues. */
export async function metricRows(ctx: McpContext, start: string, end: string, accountIds?: string[]) {
  if (accountIds && !accountIds.length) return [] as MetricRow[];
  const out: MetricRow[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    let q = ctx.db
      .from("ad_metrics_daily")
      .select("ad_account_id, date, campaign_id, campaign_name, spend, impressions, clicks, conversions, conversion_value")
      .eq("workspace_id", ctx.workspace.id)
      .gte("date", start)
      .lte("date", end);
    if (accountIds) q = q.in("ad_account_id", accountIds);
    const { data, error } = await q.order("date").order("ad_account_id").order("campaign_id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as MetricRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function adAccounts(ctx: McpContext, companyId?: string | null) {
  let q = ctx.db.from("ad_accounts").select("id, company_id, platform, name, currency, last_synced_at, sync_error").eq("workspace_id", ctx.workspace.id);
  if (companyId) q = q.eq("company_id", companyId);
  return (await q).data ?? [];
}

const KPIS: Kpi[] = ["spend", "conversions", "value", "cpa", "roas", "ctr", "cpc"];
const inP = (d: string, a: string, b: string) => d >= a && d <= b;

function kpiLine(cur: Totals, prev: Totals, currency: string) {
  return KPIS.map((k) => {
    const v = kpi(cur, k);
    const d = delta(v, kpi(prev, k));
    return `${KPI_LABEL[k]} ${fmtKpi(k, v, currency)}${d !== null ? ` (${fmtDelta(d)})` : ""}`;
  }).join(" · ");
}
const kpiData = (t: Totals) => Object.fromEntries(KPIS.map((k) => [k, kpi(t, k)]));

const getPerformance = defineTool({
  name: "get_performance",
  title: "Performance publicitaire",
  description:
    "Performance Meta Ads et Google Ads (et autres régies importées) d'un client ou de tous les clients sur une période : dépense, conversions, valeur, CPA, ROAS, CTR, CPC, variations par rapport à la période précédente de même durée, répartition par plateforme et écart aux objectifs du client. Sans client : tableau par client avec l'état des objectifs.",
  input: z.object({
    company: z.string().optional().describe("Client (nom ou identifiant) ; tous les clients sinon"),
    ...periodInput,
  }),
  run: async (a, ctx) => {
    const p = periodOf(a);
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    const accounts = await adAccounts(ctx, company?.id);
    if (!accounts.length) return { text: company ? `Aucun compte publicitaire rattaché à ${company.name}. Rattache-le dans Reporting.` : "Aucun compte publicitaire connecté dans l'espace.", data: { accounts: 0 } };
    const rows = await metricRows(ctx, p.prevStart, p.end, accounts.map((x) => x.id));
    const acc = new Map(accounts.map((x) => [x.id, x]));
    const currency = accounts[0]?.currency || ctx.workspace.currency;
    const { data: tg } = await ctx.db.from("kpi_targets").select("company_id, metric, target").eq("workspace_id", ctx.workspace.id);
    const targets = (tg ?? []).map((t) => ({ ...t, target: Number(t.target) }));

    const split = (filter: (r: MetricRow) => boolean) => {
      let cur = ZERO;
      let prev = ZERO;
      for (const r of rows) {
        if (!filter(r)) continue;
        if (inP(r.date, p.start, p.end)) cur = add(cur, r);
        else if (inP(r.date, p.prevStart, p.prevEnd)) prev = add(prev, r);
      }
      return { cur, prev };
    };
    const all = split(() => true);
    const platforms = [...new Set(accounts.map((x) => x.platform))].map((pl) => ({ platform: pl, ...split((r) => acc.get(r.ad_account_id)?.platform === pl) }));
    const lines = [
      `# Performance ${company ? company.name : "tous clients"} · ${p.label} (${p.start} au ${p.end})`,
      `Comparaison : ${p.prevStart} au ${p.prevEnd}`,
      "",
      kpiLine(all.cur, all.prev, currency),
    ];
    if (platforms.length > 1)
      lines.push("", "## Par plateforme", table(["Plateforme", "Dépense", "Conversions", "CPA", "ROAS", "CTR"], platforms.map((x) => [platformName(x.platform), fmtKpi("spend", x.cur.spend, currency), fmtKpi("conversions", x.cur.conversions, currency), fmtKpi("cpa", kpi(x.cur, "cpa"), currency), fmtKpi("roas", kpi(x.cur, "roas"), currency), fmtKpi("ctr", kpi(x.cur, "ctr"), currency)])));

    const stateOf = (companyId: string, t: Totals) =>
      targets
        .filter((x) => x.company_id === companyId)
        .map((x) => {
          const v = kpi(t, x.metric as Kpi);
          const s = targetState(x.metric as KpiMetric, v, x.target, p.days);
          return { metric: x.metric, target: scaledTarget(x.metric as KpiMetric, x.target, p.days), value: v, state: s };
        });

    let byCompany: unknown[] = [];
    if (company) {
      const st = stateOf(company.id, all.cur);
      if (st.length)
        lines.push("", "## Objectifs (dépense et conversions ramenées à la période)", table(["Indicateur", "Objectif", "Réel", "État"], st.map((x) => [KPI_LABEL[x.metric as Kpi], fmtKpi(x.metric as Kpi, x.target, currency), fmtKpi(x.metric as Kpi, x.value, currency), x.state ? STATE_LABEL[x.state] : "-"])));
      lines.push("", url.reporting(ctx, company.id));
      byCompany = [{ company: company.name, targets: st }];
    } else {
      const names = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
      const ids = [...new Set(accounts.map((x) => x.company_id))];
      const per = ids
        .map((cid) => {
          const s = split((r) => acc.get(r.ad_account_id)?.company_id === cid);
          const st = cid ? stateOf(cid, s.cur) : [];
          return { id: cid, name: cid ? names.get(cid) ?? "?" : "(sans client)", ...s, state: worst(st.map((x) => x.state)), targets: st };
        })
        .sort((x, y) => y.cur.spend - x.cur.spend);
      lines.push(
        "",
        "## Par client",
        table(
          ["Client", "Dépense", "Évol.", "Conversions", "CPA", "ROAS", "Objectifs"],
          per.map((c) => [c.name, fmtKpi("spend", c.cur.spend, currency), fmtDelta(delta(c.cur.spend, c.prev.spend)), fmtKpi("conversions", c.cur.conversions, currency), fmtKpi("cpa", kpi(c.cur, "cpa"), currency), fmtKpi("roas", kpi(c.cur, "roas"), currency), c.state ? STATE_LABEL[c.state] : "sans objectif"]),
        ),
        "",
        url.reporting(ctx),
      );
      byCompany = per.map((c) => ({ company: c.name, id: c.id, current: kpiData(c.cur), previous: kpiData(c.prev), target_state: c.state, targets: c.targets }));
    }
    const errors = accounts.filter((x) => x.sync_error);
    if (errors.length) lines.push("", `Attention : ${errors.length} compte(s) en erreur de synchronisation (${errors.map((x) => x.name).join(", ")}).`);
    return {
      text: lines.join("\n"),
      data: {
        period: { start: p.start, end: p.end, previous_start: p.prevStart, previous_end: p.prevEnd },
        currency,
        current: kpiData(all.cur),
        previous: kpiData(all.prev),
        platforms: platforms.map((x) => ({ platform: x.platform, current: kpiData(x.cur), previous: kpiData(x.prev) })),
        companies: byCompany,
      },
    };
  },
});

const SORTS = ["spend", "conversions", "value", "cpa", "roas", "ctr", "cpc"] as const;

const getCampaigns = defineTool({
  name: "get_campaigns",
  title: "Classement des campagnes",
  description: "Classe les campagnes publicitaires d'un client (ou de tous) sur une période selon un indicateur : dépense, conversions, valeur, CPA, ROAS, CTR, CPC, avec la variation de dépense et de conversions vs période précédente.",
  input: z.object({
    company: z.string().optional().describe("Client (nom ou identifiant) ; tous sinon"),
    platform: z.string().optional().describe("meta, google, tiktok…"),
    sort_by: z.enum(SORTS).default("spend"),
    order: z.enum(["desc", "asc"]).optional().describe("Par défaut : meilleur en premier (CPA et CPC croissants)"),
    min_spend: z.number().min(0).default(0).describe("Ignore les campagnes sous cette dépense"),
    limit: z.number().int().min(1).max(100).default(15),
    ...periodInput,
  }),
  run: async (a, ctx) => {
    const p = periodOf(a);
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    const accounts = (await adAccounts(ctx, company?.id)).filter((x) => !a.platform || x.platform === a.platform.toLowerCase());
    if (!accounts.length) return { text: "Aucun compte publicitaire ne correspond.", data: { campaigns: [] } };
    const acc = new Map(accounts.map((x) => [x.id, x]));
    const names = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const rows = await metricRows(ctx, p.prevStart, p.end, accounts.map((x) => x.id));
    const map = new Map<string, { id: string; name: string; account: string; cur: Totals; prev: Totals }>();
    for (const r of rows) {
      const k = `${r.ad_account_id}|${r.campaign_id}`;
      const c = map.get(k) ?? { id: r.campaign_id, name: r.campaign_name, account: r.ad_account_id, cur: ZERO, prev: ZERO };
      if (inP(r.date, p.start, p.end)) {
        c.cur = add(c.cur, r);
        if (r.campaign_name) c.name = r.campaign_name;
      } else c.prev = add(c.prev, r);
      map.set(k, c);
    }
    const currency = accounts[0]?.currency || ctx.workspace.currency;
    const lowerBetter = a.sort_by === "cpa" || a.sort_by === "cpc";
    const dir = a.order ? (a.order === "asc" ? 1 : -1) : lowerBetter ? 1 : -1;
    const list = [...map.values()]
      .filter((c) => c.cur.spend > 0 && c.cur.spend >= a.min_spend)
      .sort((x, y) => {
        const vx = kpi(x.cur, a.sort_by);
        const vy = kpi(y.cur, a.sort_by);
        if (vx === null) return 1;
        if (vy === null) return -1;
        return (vx - vy) * dir;
      })
      .slice(0, a.limit);
    if (!list.length) return { text: `Aucune campagne avec de la dépense sur ${p.label}.`, data: { campaigns: [] } };
    return {
      text:
        `# Campagnes ${company ? company.name : "tous clients"} · ${p.label} · triées par ${KPI_LABEL[a.sort_by]}\n` +
        table(
          ["Campagne", "Plateforme", ...(company ? [] : ["Client"]), "Dépense", "Évol.", "Conv.", "Évol. conv.", "CPA", "ROAS", "CTR", "CPC"],
          list.map((c) => {
            const ac = acc.get(c.account)!;
            return [
              truncate(c.name || c.id, 60), platformName(ac.platform), ...(company ? [] : [names.get(ac.company_id ?? "") ?? "-"]),
              fmtKpi("spend", c.cur.spend, currency), fmtDelta(delta(c.cur.spend, c.prev.spend)), fmtKpi("conversions", c.cur.conversions, currency),
              fmtDelta(delta(c.cur.conversions, c.prev.conversions)), fmtKpi("cpa", kpi(c.cur, "cpa"), currency), fmtKpi("roas", kpi(c.cur, "roas"), currency),
              fmtKpi("ctr", kpi(c.cur, "ctr"), currency), fmtKpi("cpc", kpi(c.cur, "cpc"), currency),
            ];
          }),
        ),
      data: {
        period: { start: p.start, end: p.end },
        currency,
        campaigns: list.map((c) => ({ campaign_id: c.id, name: c.name, platform: acc.get(c.account)?.platform, company: names.get(acc.get(c.account)?.company_id ?? "") ?? null, current: kpiData(c.cur), previous: kpiData(c.prev) })),
      },
    };
  },
});

const SITE_KPIS: SiteKpi[] = ["sessions", "users", "engagement_rate", "key_events", "conversion_rate", "revenue"];
const SITE_LABEL: Record<string, string> = { sessions: "Sessions", users: "Utilisateurs", engagement_rate: "Taux d'engagement", key_events: "Évènements clés", conversion_rate: "Taux de conversion", revenue: "Revenu" };

const getSiteAnalytics = defineTool({
  name: "get_site_analytics",
  title: "Analytics du site",
  description:
    "Trafic et comportement sur le site d'un client sur une période. Google Analytics 4 : sessions, utilisateurs, taux d'engagement, évènements clés, taux de conversion et revenu, avec variation vs période précédente, répartition par canal, sources / medium, pages de destination et appareils. Microsoft Clarity : part des sessions avec clics de rage, clics morts, retours rapides, défilement excessif et erreurs de script, profondeur de défilement, pages à problèmes classées et constats en clair. Indique aussi l'écart entre les conversions GA4 des canaux payants et celles déclarées par les plateformes via get_performance.",
  input: z.object({
    company: z.string().describe("Client (nom ou identifiant)"),
    limit: z.number().int().min(3).max(30).default(10).describe("Nombre de lignes par tableau (canaux, sources, pages)"),
    ...periodInput,
  }),
  run: async (a, ctx) => {
    const p = periodOf(a);
    const company = await resolveCompany(ctx, a.company);
    // Fonction interne sans contrôle d'accès : le client vient d'être résolu dans l'espace du jeton
    const { data: raw, error } = await ctx.db.rpc("_site_analytics", { p_company: company.id, p_start: p.start, p_end: p.end, p_prev_start: p.prevStart, p_prev_end: p.prevEnd });
    if (error) throw new Error(error.message);
    const sa = raw as unknown as SiteAnalytics;
    const link = `${url.reporting(ctx, company.id)}?tab=site`;
    if (!sa?.ga4 && !sa?.clarity)
      return {
        text: `Aucune source d'analytics reliée à ${company.name}. Associe une propriété Google Analytics 4 ou un projet Microsoft Clarity dans Réglages > Connexions (${url.base(ctx)}/settings/integrations).`,
        data: { ga4: null, clarity: null },
      };

    const lines = [`# Site de ${company.name} · ${p.label} (${p.start} au ${p.end})`, `Comparaison : ${p.prevStart} au ${p.prevEnd}`];
    const out: Record<string, unknown> = { period: { start: p.start, end: p.end, previous_start: p.prevStart, previous_end: p.prevEnd } };

    if (sa.ga4) {
      const g = sa.ga4;
      const currency = g.currency || ctx.workspace.currency;
      const { cur, prev } = ga4Split(g.daily, p);
      const hasPrev = prev.sessions > 0;
      const paid = paidTotals(g.channels);
      lines.push(
        "",
        `## Trafic (Google Analytics 4 : ${g.sources.map((s) => s.name).join(", ")})`,
        SITE_KPIS.map((k) => {
          const v = siteKpi(cur, k);
          const d = hasPrev ? change(v, siteKpi(prev, k)) : null;
          return `${SITE_LABEL[k]} ${fmtSiteKpi(k, v, currency)}${d !== null ? ` (${fmtDelta(d)})` : ""}`;
        }).join(" · "),
        `Canaux payants : ${fmtInt(paid.sessions)} sessions, ${fmtSiteKpi("key_events", paid.key_events)} évènements clés${paid.revenue ? `, ${fmtMoney(paid.revenue, currency)}` : ""}.`,
      );
      const events = [...new Set(g.sources.map((s) => s.key_event).filter(Boolean))];
      if (events.length) lines.push(`Évènement clé retenu : ${events.join(", ")}.`);
      if (!cur.sessions) lines.push("Aucune session sur la période.");
      else {
        lines.push(
          "",
          "### Par canal",
          table(
            ["Canal", "Sessions", "Évol.", "Évèn. clés", "Taux de conv.", "Revenu"],
            g.channels.slice(0, a.limit).map((c) => [channelName(c.channel), fmtInt(c.sessions), fmtDelta(change(c.sessions, c.prev_sessions || null)), fmtSiteKpi("key_events", c.key_events), fmtPct(rate(c.key_events, c.sessions), 2), fmtMoney(c.revenue, currency)]),
          ),
          "",
          "### Sources / medium",
          table(
            ["Source / medium", "Sessions", "Engagement", "Évèn. clés", "Taux de conv."],
            g.sources_medium.slice(0, a.limit).map((r) => [truncate(`${r.source} / ${r.medium}`, 50), fmtInt(r.sessions), fmtPct(rate(r.engaged, r.sessions), 0), fmtSiteKpi("key_events", r.key_events), fmtPct(rate(r.key_events, r.sessions), 2)]),
          ),
          "",
          "### Pages de destination",
          table(
            ["Page", "Sessions", "Engagement", "Évèn. clés", "Taux de conv."],
            g.pages.slice(0, a.limit).map((r) => [truncate(r.page, 60), fmtInt(r.sessions), fmtPct(rate(r.engaged, r.sessions), 0), fmtSiteKpi("key_events", r.key_events), fmtPct(rate(r.key_events, r.sessions), 2)]),
          ),
          "",
          `Appareils : ${g.devices.map((d) => `${deviceName(d.device)} ${fmtInt(d.sessions)} sessions (conv. ${fmtPct(rate(d.key_events, d.sessions), 2)})`).join(" · ")}`,
        );
      }
      out.ga4 = {
        currency,
        current: Object.fromEntries(SITE_KPIS.map((k) => [k, siteKpi(cur, k)])),
        previous: hasPrev ? Object.fromEntries(SITE_KPIS.map((k) => [k, siteKpi(prev, k)])) : null,
        paid_channels: paid,
        channels: g.channels.slice(0, a.limit),
        sources_medium: g.sources_medium.slice(0, a.limit),
        landing_pages: g.pages.slice(0, a.limit),
        devices: g.devices,
        synced_at: g.synced_at,
      };
    } else lines.push("", "Google Analytics 4 n'est pas relié à ce client.");

    if (sa.clarity) {
      const c = sa.clarity;
      const { cur, prev } = claritySplit(c.daily, p);
      const hasPrev = prev.days > 0 && prev.sessions > 0;
      const pages = problemPages(c.pages, a.limit);
      const insights = clarityInsights(c, p, 6);
      lines.push("", `## Comportement (Microsoft Clarity : ${c.sources.map((s) => s.name).join(", ")})`);
      if (!cur.sessions) lines.push(`Aucun instantané sur la période. ${c.first_day ? `Les données commencent le ${c.first_day} (Clarity ne donne pas d'historique).` : "Le premier instantané sera pris à la prochaine synchro."}`);
      else {
        lines.push(
          `${fmtInt(cur.sessions)} sessions observées sur ${cur.days} jour(s)${c.first_day && c.first_day > p.start ? `, données depuis le ${c.first_day}` : ""}. Part des sessions concernées :`,
          FRICTION_KEYS.map((k) => {
            const v = frictionRate(cur, k);
            const d = hasPrev ? change(v, frictionRate(prev, k)) : null;
            return `${FRICTION_META[k].label} ${fmtPct(v, 2)}${d !== null ? ` (${fmtDelta(d)})` : ""}`;
          }).join(" · "),
          `Profondeur de défilement ${fmtPct(cur.scroll_depth, 0)} · temps actif ${fmtDuration(cur.active_time)}.`,
        );
        if (pages.length)
          lines.push(
            "",
            "### Pages à problèmes (clics de rage ou clics morts)",
            table(
              ["Page", "Sessions", "Clics de rage", "Clics morts", "Retours rapides", "Défilement", "Appareil le plus touché"],
              pages.map((x) => {
                const worst = [...x.devices].sort((m, n) => n.rage_sessions + n.dead_sessions - (m.rage_sessions + m.dead_sessions))[0];
                return [truncate(x.path, 60), fmtInt(x.sessions), fmtPct(x.rage_rate, 1), fmtPct(x.dead_rate, 1), fmtPct(x.quickback_rate, 1), fmtPct(x.scroll_depth, 0), worst ? deviceName(worst.device) : "-"];
              }),
            ),
          );
        lines.push("", `Appareils : ${c.devices.map((d) => `${deviceName(d.device)} ${fmtInt(d.sessions)} sessions (rage ${fmtPct(frictionRate(d, "rage"), 1)}, morts ${fmtPct(frictionRate(d, "dead"), 1)})`).join(" · ")}`);
        if (insights.length) lines.push("", "### Constats", ...insights.map((i) => `- ${i.text}`));
      }
      out.clarity = {
        first_day: c.first_day,
        sessions: cur.sessions,
        days: cur.days,
        friction_rates: Object.fromEntries(FRICTION_KEYS.map((k) => [k, frictionRate(cur, k)])),
        previous_friction_rates: hasPrev ? Object.fromEntries(FRICTION_KEYS.map((k) => [k, frictionRate(prev, k)])) : null,
        scroll_depth: cur.scroll_depth,
        active_time_seconds: cur.active_time,
        problem_pages: pages.map((x) => ({ url: x.url, sessions: x.sessions, rage_rate: x.rage_rate, dead_rate: x.dead_rate, quickback_rate: x.quickback_rate, scroll_depth: x.scroll_depth, rage_share: x.rage_share })),
        devices: c.devices.map((d) => ({ device: d.device, sessions: d.sessions, rage_rate: frictionRate(d, "rage"), dead_rate: frictionRate(d, "dead") })),
        insights: insights.map((i) => i.text),
      };
    } else lines.push("", "Microsoft Clarity n'est pas relié à ce client.");

    if (sa.first_party) {
      lines.push("", `Tracking first-party : ${fmtInt(sa.first_party.purchases)} ventes (${fmtMoney(sa.first_party.revenue, ctx.workspace.currency)}), ${fmtInt(sa.first_party.leads)} prospects.`);
      out.first_party = sa.first_party;
    }
    lines.push("", link);
    return { text: lines.join("\n"), data: out };
  },
});

export const reportingTools = [getPerformance, getCampaigns, getSiteAnalytics];
