// Docs & process : espaces, pages et sous-pages (migration 0122, voir docs/docs.md).

export interface DocSpace {
  id: string;
  name: string;
  /** Un emoji */
  icon: string | null;
  description: string | null;
  position: number;
}

/** Une page dans l'arbre, sans son contenu : de quoi dessiner la navigation. */
export interface DocNode {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: number;
  updated_at: string;
  updated_by: string | null;
}

export interface DocPage extends DocNode {
  content: string;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  /** Horodatage de la dernière version : renvoyé à chaque enregistrement pour ne pas écraser le travail d'un autre */
  version_at: string | null;
}

export interface DocVersion {
  id: string;
  title: string;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocTrashItem {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  deleted_at: string;
}

export const UNTITLED = "Sans titre";
export const DOCS_BUCKET = "attachments";
export const NODE_COLS = "id, space_id, parent_id, title, icon, position, updated_at, updated_by";
export const PAGE_COLS = `${NODE_COLS}, content, created_by, created_at, deleted_at`;

/** Code d'erreur de doc_save_page quand quelqu'un d'autre a enregistré la page entre-temps */
export const CONFLICT_CODE = "AO409";

/** Adresse stable d'une image des Docs : la route vérifie l'accès puis redirige vers une URL signée. */
export const fileUrl = (path: string) => `/api/docs/file?p=${encodeURIComponent(path)}`;

/** Texte brut d'un contenu HTML, pour la recherche (titres, listes et cellules séparés). */
export function plainText(html: string) {
  return html
    .replace(/<(br|\/p|\/li|\/h\d|\/tr|\/td|\/th|\/blockquote|\/pre)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

/** Extrait autour du terme cherché. */
export function excerpt(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 160).replace(/\s+/g, " ");
  const start = Math.max(0, i - 60);
  return (start ? "…" : "") + text.slice(start, i + q.length + 100).replace(/\s+/g, " ") + "…";
}
