// Outils Liens trackés : créer un lien UTM (avec lien court facultatif), lister avec clics et attribution.
import { z } from "zod";

import { hostMatches } from "@/lib/tracking/channels";
import { EMPTY_UTM, UTM_KEYS, applyPreset, buildUrl, codeError, normalizeUtm, parseDestination, randomCode, readUtm, shortUrl, storeUtm, type Preset, type Utm } from "@/lib/links/utm";
import { companiesLite, isUuid, likeSafe, must, norm, parseDateInput, resolveCompany, table, truncate, url, zDate } from "../helpers";
import { ToolError, defineTool } from "../types";

const createTrackedLink = defineTool({
  name: "create_tracked_link",
  title: "Créer un lien tracké",
  description:
    "Crée un lien tracké : URL de destination + paramètres UTM (saisis ou tirés d'un preset de l'espace, voir whoami), avec un lien court facultatif (/l/<code>) qui compte les clics et relie les visites au tracking. Les valeurs UTM sont normalisées (minuscules, sans accents ni espaces). Les UTM déjà présentes dans l'URL collée sont reprises.",
  write: true,
  input: z.object({
    destination: z.string().min(3).max(2000).describe("URL de destination (https://…)"),
    preset: z.string().optional().describe("Nom d'un preset UTM de l'espace"),
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    utm_term: z.string().max(200).optional(),
    utm_id: z.string().max(200).optional(),
    company: z.string().optional().describe("Client associé (nom ou identifiant)"),
    name: z.string().max(200).optional().describe("Nom interne du lien"),
    short: z.boolean().default(true).describe("Créer un lien court"),
    code: z.string().max(64).optional().describe("Code personnalisé du lien court (aléatoire sinon)"),
    tags: z.array(z.string().max(40)).max(10).optional(),
    expires_at: zDate("Expiration du lien court").optional(),
  }),
  run: async (a, ctx) => {
    const parsed = parseDestination(a.destination);
    if (!parsed.ok) throw new ToolError(`Destination invalide : ${parsed.error ?? a.destination}`);
    let utm: Utm = { ...EMPTY_UTM, extra: [], ...Object.fromEntries(Object.entries(parsed.found).map(([k, v]) => [k, v ?? ""])) };
    if (a.preset) {
      const { data } = await ctx.db.from("utm_presets").select("*").eq("workspace_id", ctx.workspace.id);
      const presets = (data ?? []) as Preset[];
      const p = presets.find((x) => norm(x.name) === norm(a.preset!)) ?? (isUuid(a.preset) ? presets.find((x) => x.id === a.preset) : undefined);
      if (!p) throw new ToolError(`Preset introuvable : « ${a.preset} ». Presets : ${presets.map((x) => x.name).join(", ") || "aucun"}.`);
      utm = applyPreset(utm, p);
    }
    for (const k of UTM_KEYS) if (a[k] !== undefined) utm[k] = a[k]!;
    // Normalisation, sauf pour les variables dynamiques des plateformes ({{campaign.name}}, {campaignid}…)
    for (const k of UTM_KEYS) if (utm[k] && !/[{}]|__[A-Z_]+__/.test(utm[k])) utm[k] = normalizeUtm(utm[k]);
    if (!utm.utm_source && !utm.utm_campaign && !utm.utm_medium && !a.short) throw new ToolError("Indique au moins utm_source, utm_medium ou utm_campaign (ou un preset), ou demande un lien court.");

    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    const host = parsed.url!.hostname.replace(/^www\./, "");
    const { data: sites } = await ctx.db.from("tracking_sites").select("id, domains, company_id").eq("workspace_id", ctx.workspace.id);
    const site = (sites ?? []).find((s) => hostMatches(host, s.domains)) ?? null;
    const finalUrl = buildUrl(parsed.clean, utm);
    const expires = parseDateInput(a.expires_at, "expires_at");

    let code: string | null = null;
    if (a.short) {
      if (a.code) {
        const err = codeError(a.code);
        if (err) throw new ToolError(`Code invalide : ${err}.`);
        code = a.code;
      } else code = randomCode();
    }
    const row = {
      workspace_id: ctx.workspace.id,
      company_id: company?.id ?? site?.company_id ?? null,
      site_id: site?.id ?? null,
      name: (a.name?.trim() || [company?.name, utm.utm_campaign || utm.utm_source].filter(Boolean).join(" · ") || host).slice(0, 200),
      destination: parsed.clean,
      utm: storeUtm(utm) as never,
      final_url: finalUrl,
      tags: a.tags ?? [],
      expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      created_by: ctx.user.id,
    };
    let created: { id: string; code: string | null } | null = null;
    for (let i = 0; i < 4 && !created; i++) {
      const res = await ctx.db.from("links").insert({ ...row, code }).select("id, code").single();
      if (!res.error) created = res.data;
      else if (res.error.code === "23505" || /duplicate|unique/i.test(res.error.message)) {
        if (a.code) throw new ToolError(`Le code « ${a.code} » est déjà utilisé : choisis-en un autre.`);
        code = randomCode(8);
      } else throw new ToolError(`Création du lien impossible : ${res.error.message}`);
    }
    if (!created) throw new ToolError("Création du lien impossible : réessaie.");
    const short = created.code ? shortUrl(created.code, ctx.appUrl) : null;
    return {
      text: [
        `Lien créé : **${row.name}**`,
        short ? `Lien court : ${short}` : "",
        `URL finale : ${finalUrl}`,
        site ? "" : "Aucun site suivi ne correspond à ce domaine : les clics sont comptés, mais les conversions ne seront pas reliées au lien.",
        url.link(ctx, created.id),
      ]
        .filter(Boolean)
        .join("\n"),
      data: { id: created.id, short_url: short, final_url: finalUrl, utm: storeUtm(utm), url: url.link(ctx, created.id) },
    };
  },
});

const listLinks = defineTool({
  name: "list_links",
  title: "Lister les liens trackés",
  description: "Liste les liens trackés : nom, lien court, UTM, clics, et résultats attribués par le tracking (visiteurs, prospects, ventes, chiffre d'affaires).",
  input: z.object({
    company: z.string().optional(),
    query: z.string().max(80).optional().describe("Texte dans le nom, la destination ou le code"),
    active: z.boolean().optional(),
    sort: z.enum(["recent", "clicks", "revenue"]).default("recent"),
    limit: z.number().int().min(1).max(200).default(25),
  }),
  run: async (a, ctx) => {
    let q = ctx.db.from("links").select("id, name, destination, utm, final_url, code, tags, active, expires_at, clicks, company_id, created_at").eq("workspace_id", ctx.workspace.id);
    if (a.company) q = q.eq("company_id", (await resolveCompany(ctx, a.company)).id);
    if (a.active !== undefined) q = q.eq("active", a.active);
    if (a.query) {
      const s = likeSafe(a.query);
      q = q.or(`name.ilike.%${s}%,destination.ilike.%${s}%,code.ilike.%${s}%`);
    }
    const rows = must(await q.order("created_at", { ascending: false }).limit(a.sort === "recent" ? a.limit : 1000), "Lecture des liens");
    const { data: attr } = await ctx.db.rpc("link_attribution", { p_ws: ctx.workspace.id });
    const at = new Map((attr ?? []).map((r) => [r.link_id, { visitors: Number(r.visitors), leads: Number(r.leads), sales: Number(r.sales), revenue: Number(r.revenue) }]));
    const cos = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const items = rows.map((l) => {
      const u = readUtm(l.utm);
      return {
        id: l.id, name: l.name, short_url: l.code ? shortUrl(l.code, ctx.appUrl) : null, destination: l.destination, company: cos.get(l.company_id ?? "") ?? null,
        utm_source: u.utm_source, utm_medium: u.utm_medium, utm_campaign: u.utm_campaign, clicks: l.code ? l.clicks : null, active: l.active,
        ...(at.get(l.id) ?? { visitors: 0, leads: 0, sales: 0, revenue: 0 }),
      };
    });
    const sorted = a.sort === "clicks" ? items.sort((x, y) => (y.clicks ?? 0) - (x.clicks ?? 0)) : a.sort === "revenue" ? items.sort((x, y) => y.revenue - x.revenue) : items;
    const list = sorted.slice(0, a.limit);
    if (!list.length) return { text: "Aucun lien ne correspond.", data: { links: [] } };
    const cur = ctx.workspace.currency;
    return {
      text: table(
        ["Nom", "Lien court", "Source / support / campagne", "Clics", "Visiteurs", "Prospects", "Ventes", "CA", "Actif"],
        list.map((l) => [truncate(l.name || l.destination, 50), l.short_url?.replace(/^https?:\/\//, "") ?? "UTM seul", [l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(" / "), l.clicks ?? "", l.visitors || "", l.leads || "", l.sales || "", l.revenue ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(l.revenue) : "", l.active ? "oui" : "non"]),
      ),
      data: { links: list },
    };
  },
});

export const linkTools = [createTrackedLink, listLinks];
