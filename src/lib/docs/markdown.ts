// Markdown → HTML accepté par l'éditeur des Docs (import Notion, outils MCP).
// L'éditeur relit toujours ce HTML et ne garde que les nœuds de son schéma.
import { marked, type Token, type Tokens } from "marked";

/** Rendu marked dont les listes de cases à cocher prennent la forme que l'éditeur reconnaît. */
export function docRenderer() {
  const renderer = new marked.Renderer();
  const list = renderer.list.bind(renderer);
  renderer.list = function (t: Tokens.List) {
    if (!t.items.length || !t.items.every((i) => i.task)) return list(t);
    const items = t.items
      .map((i) => {
        const inner = i.tokens.filter((x: Token) => x.type !== "checkbox");
        const html = this.parser.parse(inner.map((x) => (x.type === "text" ? { ...x, type: "paragraph" } : x)) as Token[]);
        return `<li data-type="taskItem" data-checked="${i.checked ? "true" : "false"}">${html}</li>`;
      })
      .join("");
    return `<ul data-type="taskList">${items}</ul>`;
  };
  return renderer;
}

export function markdownToHtml(md: string) {
  return marked.parse(md, { renderer: docRenderer(), gfm: true, async: false });
}
