// Outils Bibliothèque créa : pubs concurrentes (veille Ad Library), concepts, recommandations IA.
import { z } from "zod";

import { AWARE, FORMAT, STATUS, type Awareness, type ConceptFormat, type ConceptStatus } from "@/lib/creatives/constants";
import { adLibraryUrl, firstSentence, hookTypeName, isNew, platformName, scoreAll, type CompetitorAd } from "@/lib/creatives/intel-core";
import type { Recommendation } from "@/lib/creatives/ai-parse";
import { companiesLite, day, likeSafe, must, resolveCompany, table, truncate, url } from "../helpers";
import { ToolError, defineTool } from "../types";

const conceptUrl = (base: string, id: string) => `${base}/creatives/${id}`;

const listCompetitorAds = defineTool({
  name: "list_competitor_ads",
  title: "Pubs concurrentes (veille)",
  description:
    "Pubs des concurrents surveillés dans la bibliothèque publicitaire Meta (API Ad Library, UE) : page, texte, longévité, variantes, score « probablement gagnante » (longévité, variantes, toujours active, portée UE) et tags IA (angle, type de hook, niveau de conscience, format). Pas de dépense ni d'impressions : Meta ne les publie pas pour les pubs commerciales.",
  input: z.object({
    company: z.string().optional().describe("Client (nom ou identifiant) dont on regarde les concurrents"),
    competitor: z.string().max(80).optional().describe("Nom de la page concurrente (recherche partielle)"),
    winners: z.boolean().default(false).describe("Seulement les gagnantes probables"),
    active: z.boolean().optional().describe("true : actives seulement ; false : arrêtées seulement"),
    new_only: z.boolean().default(false).describe("Seulement les pubs vues pour la première fois il y a moins de 7 jours"),
    sort: z.enum(["score", "longevity", "recent"]).default("score"),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  run: async (a, ctx) => {
    let wq = ctx.db.from("competitor_watches").select("id, company_id, page_name, search_terms, kind").eq("workspace_id", ctx.workspace.id);
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    if (company) wq = wq.eq("company_id", company.id);
    const watches = must(await wq, "Lecture des surveillances");
    if (!watches.length) return { text: company ? `Aucune surveillance de concurrent pour ${company.name}.` : "Aucune surveillance de concurrent dans l'espace.", data: { ads: [] } };
    let q = ctx.db
      .from("competitor_ads")
      .select("id, watch_id, archive_id, page_id, page_name, bodies, titles, start_time, stop_time, platforms, eu_reach, is_active, first_seen, snapshot_url, ai_tags, is_demo")
      .eq("workspace_id", ctx.workspace.id)
      .in("watch_id", watches.map((w) => w.id));
    if (a.competitor) q = q.ilike("page_name", `%${likeSafe(a.competitor)}%`);
    const rows = must(await q.limit(3000), "Lecture des pubs") as unknown as CompetitorAd[];
    const scores = scoreAll(rows);
    const cos = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const wOf = new Map(watches.map((w) => [w.id, w]));
    let list = rows.filter((r) => {
      const s = scores.get(r.id)!;
      return (!a.winners || s.winner) && (a.active === undefined || r.is_active === a.active) && (!a.new_only || isNew(r.first_seen));
    });
    list = list.sort((x, y) =>
      a.sort === "recent" ? (y.start_time ?? "").localeCompare(x.start_time ?? "") : a.sort === "longevity" ? (scores.get(y.id)!.longevity ?? 0) - (scores.get(x.id)!.longevity ?? 0) : scores.get(y.id)!.score - scores.get(x.id)!.score,
    );
    const shown = list.slice(0, a.limit);
    if (!shown.length) return { text: "Aucune pub ne correspond.", data: { ads: [] } };
    const items = shown.map((r) => {
      const s = scores.get(r.id)!;
      return {
        archive_id: r.archive_id,
        page: r.page_name,
        client: cos.get(wOf.get(r.watch_id ?? "")?.company_id ?? "") ?? null,
        text: r.bodies[0] ?? "",
        title: r.titles[0] ?? "",
        start: r.start_time?.slice(0, 10) ?? null,
        active: r.is_active,
        longevity_days: s.longevity,
        variants: s.variants,
        score: s.score,
        winner: s.winner,
        score_reasons: s.reasons.map((x) => `${x.label} (+${x.points})`),
        platforms: r.platforms.map(platformName),
        tags: r.ai_tags,
        preview_url: r.is_demo ? null : adLibraryUrl(r.archive_id),
      };
    });
    return {
      text: table(
        ["Page", "Hook", "Lancée", "Longévité", "Variantes", "Score", "Angle / hook", "Aperçu"],
        items.map((i) => [
          i.page,
          truncate(firstSentence(i.text) || i.title, 70),
          `${day(i.start)}${i.active ? "" : " (arrêtée)"}`,
          i.longevity_days !== null ? `${i.longevity_days} j` : "",
          i.variants,
          `${i.score}${i.winner ? " gagnante" : ""}`,
          [i.tags?.angle, i.tags ? hookTypeName(i.tags.hook_type) : ""].filter(Boolean).join(" / "),
          i.preview_url ?? "fictive",
        ]),
      ),
      data: { ads: items, total: list.length },
    };
  },
});

const listConcepts = defineTool({
  name: "list_creative_concepts",
  title: "Concepts créatifs",
  description: "Liste les concepts de la bibliothèque créa : titre, client, statut, angle, hook, format, niveau de conscience, tags IA et origine (inspiration concurrente ou recommandation).",
  input: z.object({
    company: z.string().optional(),
    status: z.enum(["idea", "brief", "production", "ready", "testing", "winner", "loser", "fatigued"]).optional(),
    query: z.string().max(80).optional().describe("Texte dans le titre, le hook ou l'angle"),
    limit: z.number().int().min(1).max(200).default(30),
  }),
  run: async (a, ctx) => {
    let q = ctx.db.from("creative_concepts").select("id, title, company_id, status, angle, hook, format, awareness, persona, ai_tags, source, updated_at").eq("workspace_id", ctx.workspace.id);
    if (a.company) q = q.eq("company_id", (await resolveCompany(ctx, a.company)).id);
    if (a.status) q = q.eq("status", a.status);
    if (a.query) {
      const s = likeSafe(a.query);
      q = q.or(`title.ilike.%${s}%,hook.ilike.%${s}%,angle.ilike.%${s}%`);
    }
    const rows = must(await q.order("updated_at", { ascending: false }).limit(a.limit), "Lecture des concepts");
    if (!rows.length) return { text: "Aucun concept ne correspond.", data: { concepts: [] } };
    const cos = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const base = url.base(ctx);
    const items = rows.map((c) => ({
      id: c.id,
      title: c.title,
      client: cos.get(c.company_id ?? "") ?? null,
      status: STATUS[c.status as ConceptStatus]?.name ?? c.status,
      angle: c.angle,
      hook: c.hook,
      format: FORMAT[c.format as ConceptFormat]?.name ?? c.format,
      awareness: c.awareness ? AWARE[c.awareness as Awareness]?.name : null,
      ai_tags: c.ai_tags,
      source: c.source,
      url: conceptUrl(base, c.id),
    }));
    return {
      text: table(["Concept", "Client", "Statut", "Angle", "Format", "Conscience"], items.map((i) => [i.title, i.client, i.status, i.angle, i.format, i.awareness])),
      data: { concepts: items },
    };
  },
});

const getRecommendations = defineTool({
  name: "get_creative_recommendations",
  title: "Recommandations créatives IA",
  description:
    "Dernière recommandation créative IA d'un client (ou les N dernières) : opportunités argumentées (performances réelles, pubs concurrentes citées) et brief prêt pour chacune (titre, angle, 3 hooks, script, plans, format, niveau de conscience). La génération se lance depuis l'onglet Recommandations de la bibliothèque créa.",
  input: z.object({ company: z.string().describe("Client (nom ou identifiant)"), count: z.number().int().min(1).max(5).default(1) }),
  run: async (a, ctx) => {
    const company = await resolveCompany(ctx, a.company);
    const rows = must(
      await ctx.db.from("creative_recommendations").select("id, model, output, created_at").eq("workspace_id", ctx.workspace.id).eq("company_id", company.id).order("created_at", { ascending: false }).limit(a.count),
      "Lecture des recommandations",
    );
    if (!rows.length) return { text: `Aucune recommandation pour ${company.name}. Génère-la depuis ${url.base(ctx)}/creatives?view=recos.`, data: { recommendations: [] } };
    const text = rows
      .map((r) => {
        const o = r.output as unknown as Recommendation;
        return [
          `# Recommandation du ${day(r.created_at)} (${company.name})`,
          o.summary,
          ...o.opportunities.map((x, i) =>
            [
              `## ${i + 1}. ${x.title}`,
              x.why,
              x.competitor_ads.length ? `Pubs concurrentes : ${x.competitor_ads.join(", ")}` : "",
              `Brief : « ${x.brief.concept_title} » · ${x.brief.angle} · ${FORMAT[x.brief.format as ConceptFormat]?.name ?? x.brief.format} · ${AWARE[x.brief.awareness as Awareness]?.name ?? x.brief.awareness}`,
              `Hooks : ${x.brief.hooks.map((h) => `« ${h} »`).join(" / ")}`,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        ].join("\n\n");
      })
      .join("\n\n---\n\n");
    return { text, data: { recommendations: rows.map((r) => ({ id: r.id, model: r.model, created_at: r.created_at, ...(r.output as object) })) } };
  },
});

const createConcept = defineTool({
  name: "create_creative_concept",
  title: "Créer un concept créatif",
  description: "Crée un concept dans la bibliothèque créa (statut Idée par défaut, ou Brief s'il est complet) avec son angle, son hook, son format, son niveau de conscience, et facultativement 3 hooks en variantes et un brief (script, plans, appel à l'action).",
  write: true,
  input: z.object({
    title: z.string().min(2).max(200),
    company: z.string().optional().describe("Client (nom ou identifiant)"),
    status: z.enum(["idea", "brief"]).default("idea"),
    angle: z.string().max(120).default(""),
    hook: z.string().max(300).default(""),
    persona: z.string().max(200).default(""),
    format: z.enum(["static", "carousel", "short_video", "ugc", "motion", "dpa", "other"]).default("ugc"),
    awareness: z.enum(["unaware", "problem", "solution", "product", "most"]).optional(),
    hooks: z.array(z.string().max(300)).max(5).optional().describe("Variantes de hook"),
    script: z.string().max(4000).optional(),
    shots: z.array(z.string().max(300)).max(20).optional(),
    cta: z.string().max(300).optional(),
    competitor_archive_id: z.string().max(40).optional().describe("Identifiant d'archive d'une pub concurrente qui a inspiré le concept"),
  }),
  run: async (a, ctx) => {
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    let source: Record<string, string> | null = null;
    let adId: string | null = null;
    if (a.competitor_archive_id) {
      const { data: ad } = await ctx.db.from("competitor_ads").select("id, archive_id, page_name, is_demo").eq("workspace_id", ctx.workspace.id).eq("archive_id", a.competitor_archive_id).maybeSingle();
      if (!ad) throw new ToolError(`Pub concurrente introuvable : ${a.competitor_archive_id}`);
      adId = ad.id;
      source = { type: "competitor", ad_id: ad.id, archive_id: ad.archive_id, page_name: ad.page_name, url: ad.is_demo ? "" : adLibraryUrl(ad.archive_id) };
    }
    const brief: Record<string, string> = {};
    if (a.script) brief.script = a.script;
    if (a.shots?.length) brief.shots = a.shots.join("\n");
    if (a.cta) brief.cta = a.cta;
    if (source?.url) brief.references = source.url;
    const hooks = (a.hooks ?? []).map((h) => h.trim()).filter(Boolean);
    const created = must(
      await ctx.db
        .from("creative_concepts")
        .insert({
          workspace_id: ctx.workspace.id,
          company_id: company?.id ?? null,
          title: a.title.trim(),
          status: a.status,
          angle: a.angle.trim(),
          hook: (a.hook || hooks[0] || "").trim(),
          persona: a.persona.trim(),
          format: a.format,
          awareness: a.awareness ?? null,
          platforms: ["meta"],
          brief: brief as never,
          source: source as never,
          owner_id: ctx.user.id,
          created_by: ctx.user.id,
          position: Date.now() / 1000,
        })
        .select("id")
        .single(),
      "Création du concept",
    );
    if (hooks.length)
      await ctx.db.from("creative_variants").insert(hooks.map((h, i) => ({ workspace_id: ctx.workspace.id, concept_id: created.id, name: `Hook ${i + 1}`, hook: h, position: (i + 1) * 1000 })));
    if (adId) await ctx.db.from("competitor_ads").update({ concept_id: created.id }).eq("id", adId).eq("workspace_id", ctx.workspace.id);
    const link = conceptUrl(url.base(ctx), created.id);
    return { text: `Concept créé : **${a.title}**${company ? ` (${company.name})` : ""}, statut ${STATUS[a.status].name}.\n${link}`, data: { id: created.id, url: link } };
  },
});

export const creativeTools = [listCompetitorAds, listConcepts, getRecommendations, createConcept];
