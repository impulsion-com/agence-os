// Import d'un export Notion « Markdown & CSV » : un ou plusieurs .md, ou le .zip tel que
// Notion le livre, sous-pages et images comprises. Repris de l'import du CRM Impulsion.
//
// Tout se passe dans le navigateur : l'archive est lue sur place, les images partent
// directement dans le stockage et les pages s'écrivent sous la RLS de l'utilisateur.
// Aucune route serveur, donc aucune limite de taille d'envoi de l'hébergeur.
//
// Ce que Notion met dans son export, et ce qu'on en fait :
// - « Titre 1a2b…(32 hex).md » : une page. Ses sous-pages et ses images sont dans le
//   dossier du même nom, sans le .md. L'identifiant hexadécimal est celui de la page
//   Notion : il sert à ne pas importer deux fois la même.
// - « Base 1a2b….csv » : une base de données. Elle devient une page qui en montre le
//   tableau, et ses lignes (le dossier du même nom) ses sous-pages. Le « _all.csv » est un doublon, ignoré.
// - Les liens d'une page à l'autre pointent ensuite vers les pages importées.
// - Les encadrés (<aside>) deviennent des citations, faute d'équivalent dans l'éditeur.

import { unzipSync } from "fflate";
import { marked, type Tokens } from "marked";

import type { DB } from "@/lib/workspace/context";
import { docRenderer } from "./markdown";
import { plainText } from "./types";
import { uploadDocFile } from "./upload";

type Archive = Map<string, Uint8Array>;

interface Node {
  path: string;
  /** Chemin sans extension : le dossier de ses sous-pages porte ce nom. */
  key: string;
  type: "md" | "csv";
  title: string;
  notionId: string | null;
  depth: number;
  id?: string;
}

export interface ImportTarget {
  spaceId: string;
  parentId: string | null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  images: number;
  first: string | null;
}

const NOTION_ID = /\s([0-9a-f]{32})$/i;
const MAX_FILES = 2000;
export const IMPORT_MAX_BYTES = 150 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" };

// Chemins POSIX (pas de node:path dans le navigateur)
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
};
function normalize(p: string) {
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}

/** Un zip qui ne déclare pas ses noms en UTF-8 (celui de macOS, entre autres) est relu en
 *  latin-1 : « d’appel » devenait « dâ€™appel », et le lien vers la page ne la retrouvait plus. */
function utf8Name(name: string) {
  if (!/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(name, (c) => c.charCodeAt(0)));
  } catch {
    return name;
  }
}

/** Décompresse les .zip (et ceux qu'ils contiennent : Notion découpe parfois en parties). */
function unfold(files: { name: string; data: Uint8Array }[]): Archive {
  const out: Archive = new Map();
  const queue = [...files];
  while (queue.length) {
    const f = queue.shift()!;
    if (f.name.toLowerCase().endsWith(".zip")) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(f.data);
      } catch {
        throw new Error(`Archive illisible : ${f.name}`);
      }
      for (const [name, data] of Object.entries(entries)) if (!name.endsWith("/") && !name.startsWith("__MACOSX/")) queue.push({ name: utf8Name(name), data });
    } else out.set(f.name.replace(/\\/g, "/").replace(/^\/+/, ""), f.data);
    if (out.size + queue.length > MAX_FILES) throw new Error("Export trop volumineux : importe-le en plusieurs fois.");
  }
  return out;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** CSV de Notion : virgules, guillemets doublés, retours à la ligne dans les cellules. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function tableHtml(rows: string[][]) {
  if (!rows.length) return "";
  const [head, ...body] = rows;
  const cell = (tag: string, v: string) => `<${tag}><p>${escape(v)}</p></${tag}>`;
  return `<table><tbody><tr>${head.map((v) => cell("th", v)).join("")}</tr>${body.map((r) => `<tr>${head.map((_, i) => cell("td", r[i] ?? "")).join("")}</tr>`).join("")}</tbody></table>`;
}

/** Adresse relative d'un lien ou d'une image, résolue dans l'archive. */
function resolve(from: string, href: string): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return null;
  let raw = href.split("#")[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* adresse déjà décodée */
  }
  return normalize(`${dirname(from)}/${raw}`);
}

/** Markdown d'une page Notion → HTML accepté par l'éditeur. */
async function convert(md: string, path: string, archive: Archive, pages: Map<string, string>, images: Map<string, string>, upload: (p: string) => Promise<string>, docsBase: string) {
  const source = md.replace(/<aside>/gi, "<blockquote>").replace(/<\/aside>/gi, "</blockquote>");
  const tokens = marked.lexer(source, { gfm: true });

  // Les images d'abord, une fois chacune : le rendu de marked est synchrone
  const todo: string[] = [];
  marked.walkTokens(tokens, (t) => {
    if (t.type !== "image") return;
    const target = resolve(path, (t as Tokens.Image).href);
    if (target && archive.has(target) && !images.has(target) && IMAGE_TYPES[extname(target)]) todo.push(target);
  });
  for (const target of new Set(todo)) images.set(target, await upload(target));

  const renderer = docRenderer();
  renderer.image = ({ href, text }: Tokens.Image) => {
    const target = resolve(path, href);
    const src = target ? images.get(target) : /^https?:\/\//i.test(href) ? href : null;
    return src ? `<img src="${escape(src)}" alt="${escape(text)}">` : escape(text);
  };
  const link = renderer.link.bind(renderer);
  renderer.link = (t: Tokens.Link) => {
    const target = resolve(path, t.href);
    const page = target ? pages.get(target.replace(/\.(md|csv)$/i, "")) : undefined;
    return link(page ? { ...t, href: `${docsBase}/${page}` } : t);
  };
  return marked.parser(tokens, { renderer, gfm: true });
}

export async function importNotion(
  sb: DB,
  ctx: { workspaceId: string; userId: string; docsBase: string },
  files: File[],
  target: ImportTarget,
  onProgress?: (step: string) => void,
): Promise<ImportResult> {
  if (files.reduce((s, f) => s + f.size, 0) > IMPORT_MAX_BYTES) throw new Error("Export trop lourd (150 Mo maximum) : importe-le en plusieurs fois.");
  const archive = unfold(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));

  const nodes: Node[] = [];
  for (const path of archive.keys()) {
    const ext = extname(path);
    if (ext !== ".md" && !(ext === ".csv" && !path.toLowerCase().endsWith("_all.csv"))) continue;
    const key = path.slice(0, -ext.length);
    const base = basename(key);
    nodes.push({
      path, key, type: ext === ".md" ? "md" : "csv",
      title: base.replace(NOTION_ID, "").trim() || "Sans titre",
      notionId: base.match(NOTION_ID)?.[1]?.toLowerCase() ?? null,
      depth: key.split("/").length,
    });
  }
  if (!nodes.length) throw new Error("Aucune page trouvée : il faut l'export Notion au format Markdown & CSV (.zip ou .md).");

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  nodes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title, "fr"));

  // Déjà importées : on ne les recrée pas, mais leurs sous-pages nouvelles s'y rattachent
  const ids = nodes.map((n) => n.notionId).filter((x): x is string => !!x);
  const existing = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("doc_pages").select("id, notion_id").eq("workspace_id", ctx.workspaceId).is("deleted_at", null).in("notion_id", ids.slice(i, i + 200));
    for (const p of data ?? []) existing.set(p.notion_id!, p.id);
  }

  // Positions : à la suite des pages déjà présentes sous la cible, puis 0, 1, 2… sous chaque page créée
  let rootQ = sb.from("doc_pages").select("position").eq("space_id", target.spaceId).order("position", { ascending: false }).limit(1);
  rootQ = target.parentId ? rootQ.eq("parent_id", target.parentId) : rootQ.is("parent_id", null);
  const { data: top } = await rootQ.maybeSingle();
  const next = new Map<string, number>([[target.parentId ?? "", (top?.position ?? -1) + 1]]);

  const created: Node[] = [];
  let skipped = 0;
  for (const n of nodes) {
    const parent = byKey.get(dirname(n.key));
    if (n.notionId && existing.has(n.notionId)) {
      n.id = existing.get(n.notionId);
      skipped++;
      continue;
    }
    const parentId = parent?.id ?? target.parentId;
    const slot = parentId ?? "";
    const position = next.get(slot) ?? 0;
    next.set(slot, position + 1);
    onProgress?.(`Création des pages (${created.length + 1})`);
    const { data, error } = await sb
      .from("doc_pages")
      .insert({ workspace_id: ctx.workspaceId, space_id: target.spaceId, parent_id: parentId, title: n.title.slice(0, 300), notion_id: n.notionId, position, created_by: ctx.userId, updated_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw new Error(`Création de « ${n.title} » impossible : ${error.message}`);
    n.id = data.id;
    created.push(n);
  }

  // Contenu en second : les liens entre pages ont besoin de tous les identifiants
  const pages = new Map(nodes.map((n) => [n.key, n.id!]));
  const images = new Map<string, string>();
  const upload = async (path: string) => {
    onProgress?.(`Envoi des images (${images.size + 1})`);
    const ext = extname(path);
    const data = archive.get(path)!;
    const r = await uploadDocFile(sb, ctx.workspaceId, new Blob([data.slice().buffer], { type: IMAGE_TYPES[ext] }), basename(path), IMAGE_TYPES[ext]);
    return r.url;
  };
  let done = 0;
  for (const n of created) {
    onProgress?.(`Conversion du contenu (${++done}/${created.length})`);
    const raw = new TextDecoder().decode(archive.get(n.path)!);
    let html: string;
    let title = n.title;
    if (n.type === "csv") html = tableHtml(readCsv(raw));
    else {
      // Notion ouvre chaque page par « # Titre » : c'est le vrai titre, accents compris
      const m = raw.match(/^﻿?#\s+(.+)\n?/);
      if (m) title = m[1].trim();
      html = await convert(m ? raw.slice(m[0].length) : raw, n.path, archive, pages, images, upload, ctx.docsBase);
    }
    const { error } = await sb.rpc("doc_save_page", { p_id: n.id!, p_title: title.slice(0, 300), p_content: html, p_plain: plainText(html) });
    if (error) throw new Error(`Contenu de « ${title} » : ${error.message}`);
  }

  const roots = created.filter((n) => !byKey.get(dirname(n.key))).map((n) => n.id!);
  return { created: created.length, skipped, images: images.size, first: roots[0] ?? created[0]?.id ?? null };
}
