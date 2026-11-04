"use client";

// Cadre des Docs : l'arbre des espaces et des pages à gauche, la page à droite.
// L'arbre vient du layout (Server Component) et se recharge après chaque création,
// déplacement ou suppression (router.refresh). Le titre et l'icône d'une page en cours
// de frappe sont retouchés sur place, sans tout recharger.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import "@/styles/docs.css";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { DocNode, DocSpace } from "@/lib/docs/types";
import type { ImportTarget } from "@/lib/docs/notion-import";
import { DocsTree } from "./tree";
import { SpaceModal } from "./space-modal";
import { ImportModal } from "./import-modal";

interface Ctx {
  spaces: DocSpace[];
  pages: DocNode[];
  page: (id: string | null | undefined) => DocNode | undefined;
  space: (id: string | null | undefined) => DocSpace | undefined;
  /** Pages enfants d'une page, ou de la racine d'un espace (`space:<id>`) */
  children: (key: string) => DocNode[];
  /** Met à jour une page dans l'arbre sans recharger (titre, icône en cours de frappe) */
  patch: (id: string, fields: Partial<DocNode>) => void;
  /** Crée une page vide et l'ouvre */
  newPage: (spaceId: string, parentId?: string | null) => Promise<void>;
  editSpace: (space: DocSpace | "new") => void;
  openImport: (target?: ImportTarget) => void;
}

const DocsCtx = createContext<Ctx | null>(null);

export function useDocs() {
  const c = useContext(DocsCtx);
  if (!c) throw new Error("useDocs hors de DocsShell");
  return c;
}

/** Fil d'Ariane d'une page : ses parentes, de la racine à la page exclue. */
export function ancestors(docs: Pick<Ctx, "page">, id: string) {
  const out: DocNode[] = [];
  let p = docs.page(docs.page(id)?.parent_id);
  for (let guard = 0; p && guard < 50; guard++) {
    out.unshift(p);
    p = docs.page(p.parent_id);
  }
  return out;
}

export function DocsShell({ spaces, pages, children }: { spaces: DocSpace[]; pages: DocNode[]; children: ReactNode }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const [patches, setPatches] = useState<Record<string, Partial<DocNode>>>({});
  const [spaceModal, setSpaceModal] = useState<DocSpace | "new" | null>(null);
  const [importTarget, setImportTarget] = useState<ImportTarget | "pick" | null>(null);

  const merged = useMemo(() => pages.map((p) => (patches[p.id] ? { ...p, ...patches[p.id] } : p)), [pages, patches]);
  const byId = useMemo(() => new Map(merged.map((p) => [p.id, p])), [merged]);
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const byParent = useMemo(() => {
    const m = new Map<string, DocNode[]>();
    for (const p of merged) {
      const k = p.parent_id ?? `space:${p.space_id}`;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [merged]);

  const patch = useCallback((id: string, fields: Partial<DocNode>) => setPatches((s) => ({ ...s, [id]: { ...s[id], ...fields } })), []);

  const newPage = useCallback(
    async (spaceId: string, parentId: string | null = null) => {
      const siblings = byParent.get(parentId ?? `space:${spaceId}`) ?? [];
      const created = await mutate(async (sb) =>
        must(
          await sb
            .from("doc_pages")
            .insert({
              workspace_id: ws.workspace.id, space_id: spaceId, parent_id: parentId, created_by: ws.me.id, updated_by: ws.me.id,
              position: siblings.reduce((m, p) => Math.max(m, p.position + 1), 0),
            })
            .select("id")
            .single(),
        ),
      );
      if (created) router.push(`${ws.base}/docs/${created.id}`);
    },
    [byParent, mutate, router, ws],
  );

  const value: Ctx = {
    spaces,
    pages: merged,
    page: (id) => (id ? byId.get(id) : undefined),
    space: (id) => (id ? spaceById.get(id) : undefined),
    children: (key) => byParent.get(key) ?? [],
    patch,
    newPage,
    editSpace: setSpaceModal,
    openImport: (t) => setImportTarget(t ?? "pick"),
  };

  return (
    <DocsCtx.Provider value={value}>
      <div className="docs">
        <DocsTree />
        <div className="docs-main">{children}</div>
      </div>
      {spaceModal && <SpaceModal space={spaceModal === "new" ? null : spaceModal} onClose={() => setSpaceModal(null)} />}
      {importTarget && <ImportModal target={importTarget === "pick" ? null : importTarget} onClose={() => setImportTarget(null)} />}
    </DocsCtx.Provider>
  );
}
