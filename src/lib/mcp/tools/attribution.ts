// Outil Attribution : conversions du site suivi, créditées par canal et campagne selon un
// modèle multi-touch, rapprochées de la dépense publicitaire (ROAS réel vs ROAS plateforme).
import { z } from "zod";

import { DIMENSIONS, MODELS, MODEL_IDS, NONE, attributeTree, credits, linkCampaigns, modelName, type Conversion, type ModelId, type Touch } from "@/lib/tracking/attribution";
import { channelName, isPaid, platformChannel } from "@/lib/tracking/channels";
import { readSettings } from "@/lib/tracking/settings";
import { isUuid, money, norm, plural, table, truncate, url } from "../helpers";
import { ToolError, defineTool, type McpContext } from "../types";
import { metricRows, periodInput, periodOf } from "./reporting";

const GOAL_TYPES = { sales: ["purchase", "deal_won"], leads: ["lead", "booking"] } as const;

async function resolveSite(ctx: McpContext, site?: string, company?: string) {
  const { data } = await ctx.db.from("tracking_sites").select("id, name, company_id, domains, settings, last_event_at").eq("workspace_id", ctx.workspace.id).order("name");
  const sites = data ?? [];
  if (!sites.length) throw new ToolError("Aucun site suivi dans cet espace : installe le script de tracking (menu Tracking).");
  const list = () => sites.map((s) => `${s.name} (${s.domains.join(", ") || "sans domaine"})`).join(" ; ");
  if (site) {
    const q = norm(site);
    const found = isUuid(site) ? sites.find((s) => s.id === site.trim()) : sites.find((s) => norm(s.name) === q || s.domains.some((d) => norm(d) === q.replace(/^https?:\/\//, "").replace(/^www\./, "")));
    const partial = found ?? (sites.filter((s) => norm(s.name).includes(q)).length === 1 ? sites.find((s) => norm(s.name).includes(q)) : undefined);
    if (!partial) throw new ToolError(`Site introuvable : « ${site} ». Sites : ${list()}.`);
    return partial;
  }
  if (company) {
    const { data: c } = await ctx.db.from("companies").select("id, name").eq("workspace_id", ctx.workspace.id);
    const co = (c ?? []).find((x) => x.id === company.trim() || norm(x.name) === norm(company));
    const s = co && sites.filter((x) => x.company_id === co.id);
    if (!s?.length) throw new ToolError(`Aucun site suivi pour ce client. Sites : ${list()}.`);
    if (s.length > 1) throw new ToolError(`Plusieurs sites pour ce client : ${s.map((x) => x.name).join(", ")}. Précise site.`);
    return s[0];
  }
  if (sites.length === 1) return sites[0];
  throw new ToolError(`Plusieurs sites suivis : précise site (nom ou domaine). Sites : ${list()}.`);
}

const getAttribution = defineTool({
  name: "get_attribution",
  title: "Attribution des conversions",
  description: `Attribution des ventes (goal = sales : achats et deals gagnés) ou des prospects (goal = leads : formulaires et rendez-vous, un par personne) d'un site suivi, par canal puis par campagne, selon un modèle multi-touch. Compare la dépense publicitaire, les conversions attribuées par le tracking (ROAS réel) et celles déclarées par les plateformes (ROAS plateforme). Modèles : ${MODELS.map((m) => `${m.id} (${m.name})`).join(", ")}.`,
  input: z.object({
    site: z.string().optional().describe("Site suivi : nom, domaine ou identifiant (facultatif s'il n'y en a qu'un)"),
    company: z.string().optional().describe("Ou le client du site"),
    goal: z.enum(["sales", "leads"]).default("sales"),
    model: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]).optional().describe("Modèle d'attribution (celui du site par défaut)"),
    window: z.number().int().min(1).max(365).optional().describe("Fenêtre d'attribution en jours (celle du site par défaut)"),
    campaigns: z.number().int().min(0).max(50).default(10).describe("Nombre de campagnes à détailler"),
    ...periodInput,
  }),
  run: async (a, ctx) => {
    const site = await resolveSite(ctx, a.site, a.company);
    const settings = readSettings(site.settings);
    const model = a.model ?? settings.model;
    const window = a.window ?? settings.window_days;
    const p = periodOf(a);
    const types = [...GOAL_TYPES.sales, ...GOAL_TYPES.leads];

    // Comptes publicitaires du client du site (dépense et chiffres déclarés)
    let aq = ctx.db.from("ad_accounts").select("id, platform").eq("workspace_id", ctx.workspace.id);
    aq = site.company_id ? aq.eq("company_id", site.company_id) : aq.is("company_id", null);
    const accounts = (await aq).data ?? [];
    const platformOf = new Map(accounts.map((x) => [x.id, x.platform as string]));

    const [raw, stats, spendRows] = await Promise.all([
      ctx.db.rpc("mcp_tracking_conversions", { p_user: ctx.user.id, p_ws: ctx.workspace.id, p_site: site.id, p_start: p.start, p_end: p.end, p_window: window, p_types: types }),
      ctx.db.rpc("mcp_tracking_stats", { p_user: ctx.user.id, p_ws: ctx.workspace.id, p_site: site.id, p_start: p.start, p_end: p.end }),
      metricRows(ctx, p.start, p.end, accounts.map((x) => x.id)),
    ]);
    if (raw.error) throw new ToolError(`Lecture des conversions impossible : ${raw.error.message}`);

    const camps = new Map<string, { id: string; name: string; platform: string; spend: number; pconv: number; pvalue: number }>();
    for (const r of spendRows) {
      const c = camps.get(r.campaign_id) ?? { id: r.campaign_id, name: r.campaign_name, platform: platformOf.get(r.ad_account_id) ?? "other", spend: 0, pconv: 0, pvalue: 0 };
      c.spend += Number(r.spend);
      c.pconv += Number(r.conversions);
      c.pvalue += Number(r.conversion_value);
      camps.set(r.campaign_id, c);
    }
    const rawList = (Array.isArray(raw.data) ? raw.data : []) as { id: string; ts: string; type: string; value: number; person: string; touches: unknown }[];
    const convs: Conversion[] = linkCampaigns(
      rawList.map((c) => ({ id: c.id, ts: c.ts, type: c.type, value: Number(c.value) || 0, person: c.person, touches: (Array.isArray(c.touches) ? c.touches : []) as Touch[] })),
      [...camps.values()],
    );
    const seen = new Set<string>();
    const goal =
      a.goal === "leads"
        ? convs.filter((c) => (GOAL_TYPES.leads as readonly string[]).includes(c.type)).sort((x, y) => x.ts.localeCompare(y.ts)).filter((c) => (seen.has(c.person) ? false : (seen.add(c.person), true)))
        : convs.filter((c) => (GOAL_TYPES.sales as readonly string[]).includes(c.type));

    const tree = attributeTree(goal, model, window, [DIMENSIONS.channel, DIMENSIONS.campaign]);
    const spendByChannel = new Map<string, { spend: number; pconv: number; pvalue: number }>();
    for (const c of camps.values()) {
      const ch = platformChannel(c.platform);
      const x = spendByChannel.get(ch) ?? { spend: 0, pconv: 0, pvalue: 0 };
      x.spend += c.spend;
      x.pconv += c.pconv;
      x.pvalue += c.pvalue;
      spendByChannel.set(ch, x);
    }
    const channels = [...new Set([...tree.map((n) => n.key), ...spendByChannel.keys()])].map((ch) => {
      const node = tree.find((n) => n.key === ch);
      const s = spendByChannel.get(ch);
      return {
        channel: ch,
        name: ch === "none" ? "Sans point de contact" : channelName(ch),
        conversions: node?.conversions ?? 0,
        value: node?.value ?? 0,
        spend: s?.spend ?? null,
        platform_conversions: s?.pconv ?? null,
        platform_value: s?.pvalue ?? null,
      };
    }).sort((x, y) => y.value - x.value || y.conversions - x.conversions || (y.spend ?? 0) - (x.spend ?? 0));

    const campaigns = tree
      .flatMap((ch) => ch.children.filter((c) => c.key !== NONE).map((c) => ({ channel: ch.key, key: c.key, label: camps.get(c.key)?.name ?? c.sample?.campaign ?? c.key, conversions: c.conversions, value: c.value, spend: camps.get(c.key)?.spend ?? null, pvalue: camps.get(c.key)?.pvalue ?? null })))
      .concat([...camps.values()].filter((c) => !tree.some((ch) => ch.children.some((x) => x.key === c.id))).map((c) => ({ channel: platformChannel(c.platform), key: c.id, label: c.name, conversions: 0, value: 0, spend: c.spend, pvalue: c.pvalue })))
      .sort((x, y) => (y.spend ?? 0) - (x.spend ?? 0) || y.value - x.value)
      .slice(0, a.campaigns);

    // Indicateurs : ROAS réel sur les canaux payants dont la dépense est connue
    const paidKnown = new Set([...camps.values()].map((c) => platformChannel(c.platform)));
    let paidValue = 0;
    let paidConv = 0;
    for (const c of goal)
      for (const { touch, weight } of credits(c, model, window))
        if (touch && isPaid(touch.channel) && paidKnown.has(touch.channel as ReturnType<typeof platformChannel>)) {
          paidConv += weight;
          paidValue += weight * c.value;
        }
    const spend = [...camps.values()].reduce((s, c) => s + c.spend, 0);
    const pvalue = [...camps.values()].reduce((s, c) => s + c.pvalue, 0);
    const pconv = [...camps.values()].reduce((s, c) => s + c.pconv, 0);
    const st = (stats.data ?? {}) as { visitors?: number; leads?: number };
    const cur = ctx.workspace.currency;
    const roas = (v: number | null, s: number | null) => (s && v !== null && s > 0 ? (v / s).toFixed(2).replace(".", ",") : "-");
    const cpa = (n: number | null, s: number | null) => (s && n ? money(s / n, cur) : "-");
    const f1 = (n: number | null) => (n === null ? "-" : n % 1 === 0 ? String(n) : n.toFixed(1).replace(".", ","));

    const text = [
      `# Attribution ${site.name} · ${p.label} (${p.start} au ${p.end})`,
      `Objectif : ${a.goal === "sales" ? "ventes" : "prospects"} · Modèle : ${modelName(model)} · Fenêtre : ${window} jours`,
      `Visiteurs ${Number(st.visitors ?? 0)} · ${plural(goal.length, a.goal === "sales" ? "vente" : "prospect")}${a.goal === "sales" ? ` · CA ${money(goal.reduce((s, c) => s + c.value, 0), cur)}` : ""}`,
      spend > 0
        ? `Publicité : dépense ${money(spend, cur)} · attribué par le tracking ${f1(paidConv)} conv. / ${money(paidValue, cur)} (ROAS réel ${roas(paidValue, spend)}, CPA réel ${cpa(paidConv, spend)}) · déclaré par les plateformes ${f1(pconv)} conv. / ${money(pvalue, cur)} (ROAS plateforme ${roas(pvalue, spend)})`
        : "Aucune dépense publicitaire rattachée au client de ce site sur la période.",
      "",
      "## Par canal",
      table(
        ["Canal", "Conv. attribuées", "Valeur attribuée", "Dépense", "ROAS réel", "ROAS plateforme", "CPA réel"],
        channels.map((c) => [c.name, f1(c.conversions), money(c.value, cur), c.spend !== null ? money(c.spend, cur) : "", roas(c.value, c.spend), roas(c.platform_value, c.spend), c.spend !== null ? cpa(c.conversions, c.spend) : ""]),
      ) || "Aucune conversion sur la période.",
      campaigns.length ? "\n## Campagnes" : "",
      campaigns.length
        ? table(
            ["Campagne", "Canal", "Conv. attribuées", "Valeur attribuée", "Dépense", "ROAS réel", "ROAS plateforme"],
            campaigns.map((c) => [truncate(c.label, 60), channelName(c.channel), f1(c.conversions), money(c.value, cur), c.spend !== null ? money(c.spend, cur) : isPaid(c.channel) ? "sans dépense rattachée" : "", roas(c.value, c.spend), roas(c.pvalue, c.spend)]),
          )
        : "",
      `\n${url.base(ctx)}/tracking`,
    ]
      .filter((x) => x !== "")
      .join("\n");
    return {
      text,
      data: {
        site: { id: site.id, name: site.name },
        period: { start: p.start, end: p.end },
        goal: a.goal,
        model,
        window,
        totals: { visitors: Number(st.visitors ?? 0), conversions: goal.length, value: goal.reduce((s, c) => s + c.value, 0), spend, paid_conversions: paidConv, paid_value: paidValue, platform_conversions: pconv, platform_value: pvalue },
        channels,
        campaigns,
      },
    };
  },
});

export const attributionTools = [getAttribution];
