"use client";

// Corbeille des Docs : une page y part avec ses sous-pages et en revient avec elles.
// La suppression définitive ne se fait qu'ici (la RLS refuse de supprimer une page hors corbeille).

import Link from "next/link";
import { useState } from "react";
import { FileText, RotateCcw, Trash2 } from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { ConfirmModal } from "@/components/ui/overlay";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ago } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { UNTITLED, type DocTrashItem } from "@/lib/docs/types";
import { useDocs } from "./docs-shell";

export function DocsTrash({ items }: { items: DocTrashItem[] }) {
  const ws = useWorkspace();
  const docs = useDocs();
  const mutate = useMutate();
  const [del, setDel] = useState<DocTrashItem | null>(null);

  return (
    <div className="docs-home">
      <SetCrumbs items={[{ label: "Docs", href: `${ws.base}/docs` }, { label: "Corbeille" }]} />
      <PageHeader title="Corbeille" sub="Une page supprimée y part avec ses sous-pages, et en revient avec elles." />
      {!items.length ? (
        <EmptyState icon="trash-2" title="La corbeille est vide" />
      ) : (
        <div className="card docs-recent">
          {items.map((p) => {
            const s = docs.space(p.space_id);
            return (
              <div key={p.id} className="docs-recent-row">
                {p.icon ? <span className="docs-emoji">{p.icon}</span> : <FileText size={14} className="faint" />}
                <Link href={`${ws.base}/docs/${p.id}`} className="trunc" style={{ flex: 1 }}>{p.title || UNTITLED}</Link>
                {s && <span className="faint trunc docs-recent-s">{s.icon} {s.name}</span>}
                <span className="faint docs-recent-w">supprimée {ago(p.deleted_at)}</span>
                {ws.canWrite && (
                  <>
                    <button className="btn btn-sm" onClick={() => mutate(async (sb) => must(await sb.rpc("doc_restore_page", { p_id: p.id })), { success: "Page restaurée" })}>
                      <RotateCcw size={13} /> Restaurer
                    </button>
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Supprimer définitivement" title="Supprimer définitivement" onClick={() => setDel(p)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {del && (
        <ConfirmModal
          title="Supprimer définitivement ?"
          text={<>« {del.title || UNTITLED} » et ses sous-pages disparaissent, historique compris. Impossible à annuler.</>}
          confirmLabel="Supprimer définitivement"
          onConfirm={() => mutate(async (sb) => must(await sb.from("doc_pages").delete().eq("id", del.id)), { success: "Page supprimée" }).then(() => {})}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  );
}
