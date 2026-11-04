"use client";

// Arbre des Docs : les espaces, et dans chacun ses pages. Glisser une page sur une autre en
// fait une sous-page ; sur le haut ou le bas d'une ligne, elle se range avant ou après ; sur
// le nom d'un espace, elle passe à sa racine. Les branches ouvertes sont mémorisées dans le
// navigateur, et celle de la page affichée s'ouvre d'elle-même.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Ellipsis, FileText, FolderPlus, House, Pencil, Plus, Trash2, Upload } from "lucide-react";

import { Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { UNTITLED, type DocNode } from "@/lib/docs/types";
import { useDocs } from "./docs-shell";

const OPEN_KEY = "aos-docs-open";

type Drop = { id: string; zone: "before" | "inside" | "after" } | { spaceId: string } | null;

export function DocsTree() {
  const ws = useWorkspace();
  const docs = useDocs();
  const path = usePathname();
  const router = useRouter();
  const mutate = useMutate();
  const toast = useToast();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const root = `${ws.base}/docs`;
  const current = path.startsWith(root + "/") ? path.slice(root.length + 1).split("/")[0] : null;

  useEffect(() => {
    // Lecture au montage seulement : le serveur rend tout fermé
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null") as string[] | null;
      // Première visite : les espaces ouverts
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(new Set(saved ?? docs.spaces.map((s) => `space:${s.id}`)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La branche de la page affichée s'ouvre, espace compris
  useEffect(() => {
    const p = docs.page(current);
    if (!p) return;
    const need = [`space:${p.space_id}`];
    for (let a = docs.page(p.parent_id); a; a = docs.page(a.parent_id)) need.push(a.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen((o) => (need.every((x) => o.has(x)) ? o : new Set([...o, ...need])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, docs.pages]);

  const toggle = (key: string, force?: boolean) =>
    setOpen((o) => {
      const n = new Set(o);
      if (force ?? !n.has(key)) n.add(key);
      else n.delete(key);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...n]));
      } catch {}
      return n;
    });

  const create = (spaceId: string, parentId: string | null = null) => {
    toggle(parentId ?? `space:${spaceId}`, true);
    return docs.newPage(spaceId, parentId);
  };

  const trash = (p: DocNode) =>
    mutate(
      async (sb) => {
        must(await sb.rpc("doc_trash_page", { p_id: p.id }));
        // La page affichée, ou l'une de ses parentes, vient de partir
        for (let a = docs.page(current); a; a = docs.page(a.parent_id)) if (a.id === p.id) return router.push(root);
      },
      { success: "Page mise à la corbeille", undo: async () => must(await supabaseBrowser().rpc("doc_restore_page", { p_id: p.id })) },
    );

  const removeSpace = (id: string) =>
    mutate(async (sb) => {
      const { error } = await sb.from("doc_spaces").delete().eq("id", id);
      // Clé étrangère : l'espace contient encore des pages, corbeille comprise
      if (error?.code === "23503") throw new Error("L'espace contient encore des pages (corbeille comprise) : déplace-les ou supprime-les d'abord.");
      if (error) throw new Error(error.message);
    }, { success: "Espace supprimé" });

  const isDescendant = (id: string, ancestor: string) => {
    for (let p = docs.page(docs.page(id)?.parent_id); p; p = docs.page(p.parent_id)) if (p.id === ancestor) return true;
    return false;
  };

  const over = (e: DragEvent, p: DocNode) => {
    if (!dragged || dragged === p.id || isDescendant(p.id, dragged)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const zone = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
    if (!drop || !("id" in drop) || drop.id !== p.id || drop.zone !== zone) setDrop({ id: p.id, zone });
  };

  const onDrop = () => {
    const id = dragged;
    const target = drop;
    setDragged(null);
    setDrop(null);
    const page = docs.page(id);
    if (!page || !target) return;
    mutate(async (sb) => {
      if ("spaceId" in target) {
        if (page.space_id === target.spaceId && !page.parent_id) return;
        return must(await sb.rpc("doc_move_page", { p_id: page.id, p_space: target.spaceId }));
      }
      const near = docs.page(target.id)!;
      if (target.zone === "inside") {
        toggle(near.id, true);
        return must(await sb.rpc("doc_move_page", { p_id: page.id, p_parent: near.id }));
      }
      const order = docs.children(near.parent_id ?? `space:${near.space_id}`).map((x) => x.id).filter((x) => x !== page.id);
      order.splice(order.indexOf(near.id) + (target.zone === "after" ? 1 : 0), 0, page.id);
      must(await sb.rpc("doc_move_page", { p_id: page.id, p_space: near.space_id, p_parent: near.parent_id ?? undefined, p_order: order }));
    });
  };

  const branch = (key: string, depth: number): ReactNode =>
    docs.children(key).map((p) => {
      const kids = docs.children(p.id);
      const isOpen = open.has(p.id);
      const zone = drop && "id" in drop && drop.id === p.id ? drop.zone : null;
      return (
        <div key={p.id}>
          <div
            draggable={ws.canWrite}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragged(p.id);
            }}
            onDragEnd={() => {
              setDragged(null);
              setDrop(null);
            }}
            onDragOver={(e) => over(e, p)}
            onDrop={(e) => {
              e.preventDefault();
              onDrop();
            }}
            className={`docs-row${p.id === current ? " on" : ""}${dragged === p.id ? " dragging" : ""}${zone ? ` drop-${zone}` : ""}`}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            <button type="button" className="docs-tw" onClick={() => toggle(p.id)} aria-label={isOpen ? "Replier" : "Déplier"} style={kids.length ? undefined : { visibility: "hidden" }}>
              <ChevronRight size={13} style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
            </button>
            <Link href={`${root}/${p.id}`} className="docs-row-link" draggable={false}>
              {p.icon ? <span className="docs-emoji">{p.icon}</span> : <FileText size={14} className="faint" />}
              <span className="trunc">{p.title || UNTITLED}</span>
            </Link>
            {ws.canWrite && (
              <span className="docs-row-acts">
                <Menu
                  trigger={(o) => (
                    <button type="button" className="docs-tw" onClick={o} aria-label="Actions de la page">
                      <Ellipsis size={13} />
                    </button>
                  )}
                  items={[
                    { label: "Ajouter une sous-page", icon: <Plus size={14} />, onSelect: () => create(p.space_id, p.id) },
                    { label: "Importer ici depuis Notion", icon: <Upload size={14} />, onSelect: () => docs.openImport({ spaceId: p.space_id, parentId: p.id }) },
                    { label: "", separator: true },
                    { label: "Mettre à la corbeille", icon: <Trash2 size={14} />, danger: true, onSelect: () => trash(p) },
                  ]}
                />
                <button type="button" className="docs-tw" onClick={() => create(p.space_id, p.id)} aria-label="Ajouter une sous-page">
                  <Plus size={13} />
                </button>
              </span>
            )}
          </div>
          {isOpen && branch(p.id, depth + 1)}
        </div>
      );
    });

  return (
    <nav className="docs-tree" aria-label="Pages des Docs">
      <Link href={root} className={`docs-row docs-row-top${path === root ? " on" : ""}`}>
        <House size={15} /> Accueil des docs
      </Link>

      {docs.spaces.map((s) => {
        const key = `space:${s.id}`;
        const isOpen = open.has(key);
        const target = !!drop && "spaceId" in drop && drop.spaceId === s.id;
        return (
          <div key={s.id} className="docs-space">
            <div
              className={`docs-row docs-space-h${target ? " drop-inside" : ""}`}
              onDragOver={(e) => {
                if (!dragged) return;
                e.preventDefault();
                if (!target) setDrop({ spaceId: s.id });
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop();
              }}
            >
              <button type="button" className="docs-row-link" onClick={() => toggle(key)} aria-expanded={isOpen}>
                <ChevronRight size={13} style={{ transform: isOpen ? "rotate(90deg)" : undefined, flexShrink: 0 }} />
                {s.icon && <span className="docs-emoji">{s.icon}</span>}
                <span className="trunc">{s.name}</span>
              </button>
              {ws.canWrite && (
                <span className="docs-row-acts">
                  <Menu
                    trigger={(o) => (
                      <button type="button" className="docs-tw" onClick={o} aria-label="Actions de l'espace">
                        <Ellipsis size={13} />
                      </button>
                    )}
                    items={[
                      { label: "Modifier l'espace", icon: <Pencil size={14} />, onSelect: () => docs.editSpace(s) },
                      { label: "Importer depuis Notion", icon: <Upload size={14} />, onSelect: () => docs.openImport({ spaceId: s.id, parentId: null }) },
                      { label: "", separator: true },
                      { label: "Supprimer l'espace vide", icon: <Trash2 size={14} />, danger: true, onSelect: () => removeSpace(s.id) },
                    ]}
                  />
                  <button type="button" className="docs-tw" onClick={() => create(s.id)} aria-label="Nouvelle page">
                    <Plus size={13} />
                  </button>
                </span>
              )}
            </div>
            {isOpen && (
              <div>
                {branch(key, 0)}
                {!docs.children(key).length && ws.canWrite && (
                  <button type="button" className="docs-row faint" style={{ paddingLeft: 22 }} onClick={() => create(s.id)}>
                    <Plus size={13} /> Nouvelle page
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="docs-tree-foot">
        {ws.canWrite && (
          <>
            <button type="button" className="docs-row docs-row-top" onClick={() => docs.editSpace("new")}>
              <FolderPlus size={15} /> Nouvel espace
            </button>
            <button
              type="button"
              className="docs-row docs-row-top"
              onClick={() => (docs.spaces.length ? docs.openImport() : toast("Crée d'abord un espace où importer.", { error: true }))}
            >
              <Upload size={15} /> Importer depuis Notion
            </button>
          </>
        )}
        <Link href={`${root}/trash`} className={`docs-row docs-row-top${path === `${root}/trash` ? " on" : ""}`}>
          <Trash2 size={15} /> Corbeille
        </Link>
      </div>
    </nav>
  );
}
