"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { DocSpace } from "@/lib/docs/types";
import { useDocs } from "./docs-shell";

const SUGGESTIONS = ["📋", "🏢", "🚀", "📣", "📊", "🧰", "🎓", "💡", "🤝", "🔒"];

/** Créer ou modifier un espace (nom, emoji, description). */
export function SpaceModal({ space, onClose }: { space: DocSpace | null; onClose: () => void }) {
  const ws = useWorkspace();
  const docs = useDocs();
  const mutate = useMutate();
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "📋");
  const [description, setDescription] = useState(space?.description ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const row = { name: name.trim().slice(0, 80), icon: icon.trim() || null, description: description.trim() || null };
    const ok = await mutate(
      async (sb) =>
        space
          ? must(await sb.from("doc_spaces").update(row).eq("id", space.id))
          : must(
              await sb.from("doc_spaces").insert({
                ...row, workspace_id: ws.workspace.id, created_by: ws.me.id,
                position: docs.spaces.reduce((m, s) => Math.max(m, s.position + 1), 0),
              }),
            ),
      { success: space ? "Espace modifié" : "Espace créé" },
    );
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  return (
    <Modal
      title={space ? "Modifier l'espace" : "Nouvel espace"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {space ? "Enregistrer" : "Créer l'espace"}
          </button>
        </>
      }
    >
      <form
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="ds-name">Nom</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ width: 56, textAlign: "center", fontSize: 18 }} value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 8))} aria-label="Emoji" />
            <input id="ds-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Process, Agence, Clients…" />
          </div>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {SUGGESTIONS.map((e) => (
              <button key={e} type="button" className="btn btn-ghost btn-sm btn-icon" style={{ fontSize: 16 }} onClick={() => setIcon(e)} aria-label={`Choisir ${e}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="ds-desc">Description (facultative)</label>
          <textarea id="ds-desc" className="textarea" rows={2} style={{ minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce qu'on y range, en une phrase" />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
