"use client";

// Import d'un export Notion (Markdown & CSV, .zip ou .md) dans un espace, ou sous une page.
// Voir src/lib/docs/notion-import.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileArchive, LoaderCircle, Upload } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import { importNotion, type ImportResult, type ImportTarget } from "@/lib/docs/notion-import";
import { UNTITLED } from "@/lib/docs/types";
import { useDocs } from "./docs-shell";

export function ImportModal({ target, onClose }: { target: ImportTarget | null; onClose: () => void }) {
  const ws = useWorkspace();
  const docs = useDocs();
  const router = useRouter();
  const [spaceId, setSpaceId] = useState(target?.spaceId ?? docs.spaces[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const parent = docs.page(target?.parentId);

  const run = async () => {
    setError(null);
    setStep("Lecture de l'archive");
    try {
      const r = await importNotion(
        supabaseBrowser(),
        { workspaceId: ws.workspace.id, userId: ws.me.id, docsBase: `${ws.base}/docs` },
        files,
        { spaceId: parent?.space_id ?? spaceId, parentId: target?.parentId ?? null },
        setStep,
      );
      setResult(r);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
    }
  };

  const pick = (list: FileList | null) => {
    const ok = [...(list ?? [])].filter((f) => /\.(zip|md|csv)$/i.test(f.name));
    if (ok.length) setFiles(ok);
    else if (list?.length) setError("Dépose le .zip exporté par Notion (ou des fichiers .md).");
  };

  return (
    <Modal
      title="Importer depuis Notion"
      onClose={step ? () => {} : onClose}
      footer={
        result ? (
          <>
            <button className="btn" onClick={onClose}>Fermer</button>
            {result.first && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  router.push(`${ws.base}/docs/${result.first}`);
                  onClose();
                }}
              >
                Ouvrir la page importée
              </button>
            )}
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={!!step}>Annuler</button>
            <button className="btn btn-primary" disabled={!files.length || !!step || (!parent && !spaceId)} onClick={run}>
              {step ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Importer
            </button>
          </>
        )
      }
    >
      {result ? (
        <p>
          {result.created} page{result.created > 1 ? "s" : ""} importée{result.created > 1 ? "s" : ""}
          {result.images ? `, ${result.images} image${result.images > 1 ? "s" : ""}` : ""}.
          {result.skipped ? ` ${result.skipped} déjà présente${result.skipped > 1 ? "s" : ""}, pas recréée${result.skipped > 1 ? "s" : ""}.` : ""}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ol className="docs-steps">
            <li>Dans Notion, menu <b>···</b> de la page, <b>Exporter</b>.</li>
            <li>Format <b>Markdown &amp; CSV</b>, coche <b>Inclure les sous-pages</b>.</li>
            <li>Dépose ici le .zip tel quel : sous-pages, images, liens entre pages et bases de données suivent.</li>
          </ol>
          {parent ? (
            <p className="faint">Sous la page : <b>{parent.icon} {parent.title || UNTITLED}</b></p>
          ) : (
            <div className="field">
              <label htmlFor="imp-space">Dans l&apos;espace</label>
              <select id="imp-space" className="select" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                {docs.spaces.map((s) => (
                  <option key={s.id} value={s.id}>{s.icon} {s.name}</option>
                ))}
              </select>
            </div>
          )}
          <label
            className={`docs-drop${over ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              pick(e.dataTransfer.files);
            }}
          >
            <FileArchive size={22} className="faint" />
            {files.length ? <b>{files.map((f) => f.name).join(", ")}</b> : <span>Glisse le .zip ici, ou clique pour le choisir</span>}
            <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>150 Mo au plus. Relancer un import complète sans doublonner.</span>
            <input type="file" accept=".zip,.md,.csv" multiple className="sr" onChange={(e) => pick(e.target.files)} />
          </label>
          {step && <p className="faint"><LoaderCircle size={13} className="spin" /> {step}…</p>}
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}
