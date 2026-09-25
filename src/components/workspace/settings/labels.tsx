"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/ui/misc";
import { ConfirmModal, Popover } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { colorOf } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Label } from "@/lib/types";
import { ColorSwatches } from "../team-modal";
import { SetPage, SetSection } from "./shell";

function ColorDot({ color, onChange, disabled }: { color: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <Popover
      width={220}
      trigger={(open) => (
        <button
          type="button"
          className="swatch sm"
          style={{ ["--c" as string]: colorOf(color), flexShrink: 0 }}
          onClick={open}
          disabled={disabled}
          aria-label="Changer la couleur"
          title="Changer la couleur"
        />
      )}
    >
      {(close) => (
        <div style={{ padding: 8 }}>
          <ColorSwatches
            value={color}
            onChange={(c) => {
              onChange(c);
              close();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

export function LabelsSettings({ counts }: { counts: Record<string, number> }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("indigo");
  const [deleting, setDeleting] = useState<Label | null>(null);
  const ro = !ws.canWrite;

  const rename = (l: Label) => {
    const v = (draft[l.id] ?? l.name).trim();
    if (!v || v === l.name) return setDraft((d) => ({ ...d, [l.id]: l.name }));
    mutate(async (sb) => must(await sb.from("labels").update({ name: v }).eq("id", l.id).select("id")), { success: "Étiquette renommée" });
  };

  const add = async () => {
    const v = newName.trim();
    if (!v) return;
    if (ws.labels.some((l) => l.name.toLowerCase() === v.toLowerCase())) return toast("Cette étiquette existe déjà", { error: true });
    const ok = await mutate(async (sb) => must(await sb.from("labels").insert({ workspace_id: ws.workspace.id, name: v, color: newColor }).select("id")), { success: "Étiquette créée" });
    if (ok) setNewName("");
  };

  return (
    <SetPage title="Étiquettes" lead="Pour classer les tâches par type de travail : créa, copy, média, tracking… Partagées par tout l'espace.">
      <SetSection title={`${ws.labels.length} étiquette${ws.labels.length > 1 ? "s" : ""}`}>
        {ws.labels.length ? (
          ws.labels.map((l) => (
            <div key={l.id} className="lbl-row">
              <ColorDot color={l.color} disabled={ro} onChange={(c) => mutate(async (sb) => must(await sb.from("labels").update({ color: c }).eq("id", l.id).select("id")))} />
              <input
                className="input"
                value={draft[l.id] ?? l.name}
                disabled={ro}
                aria-label={`Nom de l'étiquette ${l.name}`}
                onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                onBlur={() => rename(l)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setDraft((d) => ({ ...d, [l.id]: l.name }));
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <span className="n">
                {counts[l.id] ?? 0} tâche{(counts[l.id] ?? 0) > 1 ? "s" : ""}
              </span>
              {!ro && (
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setDeleting(l)} aria-label={`Supprimer ${l.name}`} title="Supprimer">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        ) : (
          <EmptyState icon="filter" title="Aucune étiquette" text="Crée ta première étiquette ci-dessous." />
        )}
        {!ro && (
          <form
            className="lbl-row"
            style={{ borderBottom: 0, paddingTop: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <ColorDot color={newColor} onChange={setNewColor} />
            <input className="input" placeholder="Nouvelle étiquette" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Nom de la nouvelle étiquette" />
            <button type="submit" className="btn btn-sm" disabled={!newName.trim()}>
              <Plus size={13} />
              Ajouter
            </button>
          </form>
        )}
      </SetSection>

      {deleting && (
        <ConfirmModal
          title={`Supprimer « ${deleting.name} » ?`}
          text={(counts[deleting.id] ?? 0) > 0 ? `Elle sera retirée des ${counts[deleting.id]} tâches qui la portent.` : "Aucune tâche ne porte cette étiquette."}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("labels").delete().eq("id", deleting.id).select("id")), { success: "Étiquette supprimée" });
          }}
        />
      )}
    </SetPage>
  );
}
