// Outils Docs & process : parcourir, chercher, lire, créer et modifier les pages du wiki de l'agence.
// Le contenu s'écrit en Markdown (converti en HTML pour l'éditeur) ; chaque écriture laisse une
// version dans l'historique, comme depuis l'interface.
import { z } from "zod";

import { markdownToHtml } from "@/lib/docs/markdown";
import { UNTITLED, excerpt, plainText } from "@/lib/docs/types";
import { isUuid, likeSafe, must, norm, table, truncate, url } from "../helpers";
import { ToolError, defineTool, type McpContext } from "../types";

const docUrl = (ctx: McpContext, id: string) => `${url.base(ctx)}/docs/${id}`;

async function spaces(ctx: McpContext) {
  return must(await ctx.db.from("doc_spaces").select("id, name, icon, description, position").eq("workspace_id", ctx.workspace.id).order("position"), "Lecture des espaces");
}

async function resolveSpace(ctx: McpContext, ref: string) {
  const all = await spaces(ctx);
  const s = all.find((x) => x.id === ref) ?? all.find((x) => norm(x.name) === norm(ref));
  if (!s) throw new ToolError(`Espace introuvable : « ${ref} ». Espaces : ${all.map((x) => x.name).join(", ") || "aucun (crée-le avec create_doc en donnant un nom d'espace)"}.`);
  return s;
}

async function resolvePage(ctx: McpContext, ref: string) {
  let q = ctx.db.from("doc_pages").select("id, space_id, parent_id, title, icon, content, plain, updated_at, updated_by").eq("workspace_id", ctx.workspace.id).is("deleted_at", null);
  q = isUuid(ref) ? q.eq("id", ref.trim()) : q.ilike("title", likeSafe(ref));
  const rows = must(await q.limit(5), "Lecture de la page");
  if (!rows.length) throw new ToolError(`Page introuvable : « ${ref} ». Cherche-la avec search_docs.`);
  if (rows.length > 1) throw new ToolError(`Plusieurs pages s'appellent « ${ref} » : précise son identifiant (${rows.map((r) => r.id).join(", ")}).`);
  return rows[0];
}

/** Version de l'historique : les écritures d'une même personne à moins de 10 minutes se fondent. */
async function saveVersion(ctx: McpContext, pageId: string, title: string, content: string) {
  const { data: last } = await ctx.db.from("doc_versions").select("id, author_id, updated_at").eq("page_id", pageId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last && last.author_id === ctx.user.id && Date.now() - new Date(last.updated_at).getTime() < 10 * 60_000) {
    await ctx.db.from("doc_versions").update({ title, content, updated_at: new Date().toISOString() }).eq("id", last.id);
  } else await ctx.db.from("doc_versions").insert({ workspace_id: ctx.workspace.id, page_id: pageId, title, content, author_id: ctx.user.id });
}

const listDocs = defineTool({
  name: "list_docs",
  title: "Lister les docs",
  description: "Sommaire du wiki de l'agence (Docs & process) : les espaces et l'arbre de leurs pages, avec identifiants. À appeler avant de créer une page pour choisir l'espace et la page parente.",
  input: z.object({ space: z.string().optional().describe("Limiter à un espace (nom ou identifiant)") }),
  idempotent: true,
  run: async (a, ctx) => {
    const all = a.space ? [await resolveSpace(ctx, a.space)] : await spaces(ctx);
    if (!all.length) return { text: "Aucun espace de docs pour l'instant.", data: { spaces: [] } };
    const pages = must(
      await ctx.db.from("doc_pages").select("id, space_id, parent_id, title, icon, position").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).in("space_id", all.map((s) => s.id)).order("position"),
      "Lecture des pages",
    );
    const kids = new Map<string, typeof pages>();
    for (const p of pages) kids.set(p.parent_id ?? `s:${p.space_id}`, [...(kids.get(p.parent_id ?? `s:${p.space_id}`) ?? []), p]);
    const lines: string[] = [];
    const walk = (key: string, depth: number) => {
      for (const p of kids.get(key) ?? []) {
        lines.push(`${"  ".repeat(depth)}- ${p.icon ? p.icon + " " : ""}${p.title || UNTITLED} (${p.id})`);
        if (depth < 8) walk(p.id, depth + 1);
      }
    };
    for (const s of all) {
      lines.push(`\n**${s.icon ? s.icon + " " : ""}${s.name}** (${s.id})${s.description ? ` : ${s.description}` : ""}`);
      walk(`s:${s.id}`, 0);
      if (!kids.get(`s:${s.id}`)?.length) lines.push("- (vide)");
    }
    return { text: lines.join("\n").trim(), data: { spaces: all, pages } };
  },
});

const searchDocs = defineTool({
  name: "search_docs",
  title: "Chercher dans les docs",
  description: "Cherche un texte dans le titre et le contenu des pages des Docs (process, checklists, conventions de l'agence). Renvoie les pages avec un extrait.",
  input: z.object({ query: z.string().min(2).max(80), limit: z.number().int().min(1).max(50).default(10) }),
  idempotent: true,
  run: async (a, ctx) => {
    const s = likeSafe(a.query);
    const rows = must(
      await ctx.db.from("doc_pages").select("id, space_id, title, icon, plain, updated_at").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).or(`title.ilike.%${s}%,plain.ilike.%${s}%`).order("updated_at", { ascending: false }).limit(a.limit),
      "Recherche",
    );
    if (!rows.length) return { text: `Aucune page ne contient « ${a.query} ».`, data: { pages: [] } };
    const names = new Map((await spaces(ctx)).map((x) => [x.id, x.name]));
    const items = rows.map((p) => ({ id: p.id, title: p.title || UNTITLED, space: names.get(p.space_id) ?? "", excerpt: excerpt(p.plain, a.query), url: docUrl(ctx, p.id) }));
    return { text: table(["Page", "Espace", "Extrait", "Id"], items.map((p) => [p.title, p.space, truncate(p.excerpt, 140), p.id])), data: { pages: items } };
  },
});

const readDoc = defineTool({
  name: "read_doc",
  title: "Lire une page des docs",
  description: "Lit une page des Docs (titre exact ou identifiant) : son texte, son espace et ses sous-pages.",
  input: z.object({ page: z.string().min(1).describe("Titre exact ou identifiant de la page") }),
  idempotent: true,
  run: async (a, ctx) => {
    const p = await resolvePage(ctx, a.page);
    const [space, { data: subs }] = await Promise.all([
      ctx.db.from("doc_spaces").select("name").eq("id", p.space_id).maybeSingle(),
      ctx.db.from("doc_pages").select("id, title").eq("parent_id", p.id).is("deleted_at", null).order("position"),
    ]);
    return {
      text: [
        `# ${p.icon ? p.icon + " " : ""}${p.title || UNTITLED}`,
        `Espace : ${space.data?.name ?? "?"} · modifiée le ${p.updated_at.slice(0, 10)} · ${docUrl(ctx, p.id)}`,
        "",
        truncate(p.plain || "(page vide)", 20_000),
        subs?.length ? `\nSous-pages : ${subs.map((s) => `${s.title || UNTITLED} (${s.id})`).join(", ")}` : "",
      ].join("\n"),
      data: { id: p.id, title: p.title, space_id: p.space_id, parent_id: p.parent_id, html: p.content, subpages: subs ?? [], url: docUrl(ctx, p.id) },
    };
  },
});

const createDoc = defineTool({
  name: "create_doc",
  title: "Créer une page des docs",
  description:
    "Crée une page dans les Docs (process, checklist, documentation). Contenu en Markdown : titres, listes, cases à cocher « - [ ] », tableaux, citations, code. L'espace est créé s'il n'existe pas encore.",
  write: true,
  input: z.object({
    title: z.string().min(1).max(300),
    markdown: z.string().max(400_000).default(""),
    space: z.string().optional().describe("Espace (nom ou identifiant). Obligatoire sans page parente"),
    parent: z.string().optional().describe("Page parente (titre exact ou identifiant) : la nouvelle page devient sa sous-page"),
    icon: z.string().max(8).optional().describe("Un emoji"),
  }),
  run: async (a, ctx) => {
    let spaceId: string;
    let parentId: string | null = null;
    let createdSpace = false;
    if (a.parent) {
      const parent = await resolvePage(ctx, a.parent);
      spaceId = parent.space_id;
      parentId = parent.id;
    } else if (a.space) {
      const all = await spaces(ctx);
      const found = all.find((x) => x.id === a.space) ?? all.find((x) => norm(x.name) === norm(a.space!));
      if (found) spaceId = found.id;
      else {
        const s = must(await ctx.db.from("doc_spaces").insert({ workspace_id: ctx.workspace.id, name: a.space.slice(0, 80), position: all.length, created_by: ctx.user.id }).select("id").single(), "Création de l'espace");
        spaceId = s.id;
        createdSpace = true;
      }
    } else throw new ToolError("Indique l'espace (space) ou la page parente (parent). Voir list_docs.");

    let last = ctx.db.from("doc_pages").select("position").eq("space_id", spaceId).order("position", { ascending: false }).limit(1);
    last = parentId ? last.eq("parent_id", parentId) : last.is("parent_id", null);
    const { data: top } = await last.maybeSingle();
    const content = markdownToHtml(a.markdown);
    const title = a.title.trim();
    const page = must(
      await ctx.db
        .from("doc_pages")
        .insert({
          workspace_id: ctx.workspace.id, space_id: spaceId, parent_id: parentId, title, icon: a.icon || null, content, plain: plainText(content),
          position: (top?.position ?? -1) + 1, created_by: ctx.user.id, updated_by: ctx.user.id,
        })
        .select("id")
        .single(),
      "Création de la page",
    );
    if (content) await saveVersion(ctx, page.id, title, content);
    return { text: `Page créée : **${title}**${createdSpace ? ` (nouvel espace « ${a.space} »)` : ""}\n${docUrl(ctx, page.id)}`, data: { id: page.id, url: docUrl(ctx, page.id) } };
  },
});

const updateDoc = defineTool({
  name: "update_doc",
  title: "Modifier une page des docs",
  description:
    "Modifie une page des Docs : titre, icône, et contenu en Markdown, qui remplace la page (mode « replace ») ou s'ajoute à la fin (« append »). L'état précédent reste dans l'historique de la page. Pour remplacer, lis d'abord la page avec read_doc.",
  write: true,
  input: z.object({
    page: z.string().min(1).describe("Titre exact ou identifiant de la page"),
    title: z.string().min(1).max(300).optional(),
    icon: z.string().max(8).optional(),
    markdown: z.string().max(400_000).optional(),
    mode: z.enum(["replace", "append"]).default("append"),
  }),
  run: async (a, ctx) => {
    const p = await resolvePage(ctx, a.page);
    const patch: { title?: string; icon?: string | null; content?: string; plain?: string; updated_by: string; updated_at: string } = { updated_by: ctx.user.id, updated_at: new Date().toISOString() };
    if (a.title) patch.title = a.title.trim();
    if (a.icon !== undefined) patch.icon = a.icon || null;
    if (a.markdown !== undefined) {
      const html = markdownToHtml(a.markdown);
      patch.content = a.mode === "append" ? p.content + html : html;
      if (patch.content.length > 2_000_000) throw new ToolError("Page trop lourde (2 Mo au plus).");
      patch.plain = plainText(patch.content);
    }
    must(await ctx.db.from("doc_pages").update(patch).eq("id", p.id).eq("workspace_id", ctx.workspace.id), "Modification de la page");
    if (patch.title !== undefined || patch.content !== undefined) await saveVersion(ctx, p.id, patch.title ?? p.title, patch.content ?? p.content);
    return { text: `Page modifiée : **${patch.title ?? p.title}**\n${docUrl(ctx, p.id)}`, data: { id: p.id, url: docUrl(ctx, p.id) } };
  },
});

export const docsTools = [listDocs, searchDocs, readDoc, createDoc, updateDoc];
