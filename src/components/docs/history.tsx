"use client";

// Historique d'une page : une version par séance d'écriture, l'aperçu de chacune, et sa
// restauration (qui devient elle-même une nouvelle version : on ne perd jamais l'état qu'on quitte).

import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import { UNTITLED, plainText, type DocVersion } from "@/lib/docs/types";
import { DocReader } from "./editor";

const when = (s: string) => new Date(s).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function HistoryModal({
  pageId,
  canRestore,
  onClose,
  onRestore,
}: {
  pageId: string;
  canRestore: boolean;
  onClose: () => void;
  onRestore: (v: { title: string; content: string; plain: string }) => Promise<void>;
}) {
  const ws = useWorkspace();
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [picked, setPicked] = useState<{ id: string; title: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("doc_versions")
      .select("id, title, author_id, created_at, updated_at")
      .eq("page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => (error ? setError(error.message) : setVersions(data ?? [])));
  }, [pageId]);

  const show = async (id: string) => {
    const { data, error } = await supabaseBrowser().from("doc_versions").select("id, title, content").eq("id", id).single();
    if (error) setError(error.message);
    else setPicked(data);
  };

  return (
    <Modal title="Historique des versions" size="lg" onClose={onClose}>
      <p className="faint" style={{ fontSize: "var(--fs-sm)", marginBottom: 12 }}>
        Une version par séance d&apos;écriture. Restaurer garde l&apos;état actuel dans l&apos;historique.
      </p>
      <div className="docs-history">
        <ul className="docs-history-list">
          {!versions && !error && <LoaderCircle size={16} className="spin faint" style={{ margin: 12 }} />}
          {versions?.length === 0 && <li className="faint" style={{ padding: 8 }}>Pas encore de version.</li>}
          {versions?.map((v, i) => (
            <li key={v.id}>
              <button type="button" className={`docs-history-item${picked?.id === v.id ? " on" : ""}`} onClick={() => show(v.id)}>
                <b>
                  {when(v.updated_at)}
                  {i === 0 && <span className="faint" style={{ fontWeight: 400 }}> (actuelle)</span>}
                </b>
                <span className="faint trunc">{ws.member(v.author_id)?.profile.full_name ?? "Import ou automate"}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="docs-history-preview">
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
          {picked ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <h3 className="trunc" style={{ flex: 1, fontSize: "var(--fs-xl)" }}>{picked.title || UNTITLED}</h3>
                {canRestore && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await onRestore({ title: picked.title, content: picked.content, plain: plainText(picked.content) });
                      setBusy(false);
                    }}
                  >
                    <RotateCcw size={13} /> Restaurer cette version
                  </button>
                )}
              </div>
              <DocReader key={picked.id} content={picked.content} />
            </>
          ) : (
            !error && <p className="faint">Choisis une version à gauche pour la relire.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
