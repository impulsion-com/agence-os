"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import "@/styles/workspace.css";
import { Icon } from "@/components/ui/icon";
import { ConfirmModal, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Team } from "@/lib/types";

export const TEAM_ICONS = [
  "users", "target", "palette", "briefcase", "activity", "megaphone", "pen-tool", "chart-column", "code", "globe",
  "rocket", "sparkles", "layers", "zap", "handshake", "clapperboard", "smartphone", "shopping-bag",
];

// Couleur nommée courante (les équipes par défaut sont stockées en hex)
export const colorKey = (c: string) => (COLORS[c] ? c : Object.entries(COLORS).find(([, v]) => v.toLowerCase() === c.toLowerCase())?.[0] ?? "indigo");

export function ColorSwatches({ value, onChange, label = "Couleur" }: { value: string; onChange: (c: string) => void; label?: string }) {
  const cur = colorKey(value);
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {Object.entries(COLORS).map(([k, v]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={cur === k}
          aria-label={k}
          title={k}
          className={`swatch${cur === k ? " on" : ""}`}
          style={{ ["--c" as string]: v }}
          onClick={() => onChange(k)}
        >
          {cur === k && <Check size={13} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function TeamModal({ team, onClose }: { team?: Team; onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [icon, setIcon] = useState(team?.icon ?? "users");
  const [color, setColor] = useState(team ? colorKey(team.color) : "indigo");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast("Donne un nom à l'équipe", { error: true });
    setBusy(true);
    const row = { name: name.trim(), description: description.trim(), icon, color };
    const ok = await mutate(
      async (sb) => {
        if (team) must(await sb.from("teams").update(row).eq("id", team.id).select("id"));
        else must(await sb.from("teams").insert({ ...row, workspace_id: ws.workspace.id }).select("id"));
        return true;
      },
      { success: team ? "Équipe mise à jour" : "Équipe créée" },
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={team ? "Modifier l'équipe" : "Nouvelle équipe"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {team ? "Enregistrer" : "Créer l'équipe"}
          </button>
        </>
      }
    >
      <form
        style={{ display: "contents" }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label htmlFor="team-name">Nom</label>
          <input id="team-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Media buying, Creative strategy…" />
        </div>
        <div className="field">
          <label htmlFor="team-desc">Description</label>
          <textarea id="team-desc" className="textarea" style={{ minHeight: 64 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce que fait cette équipe" />
        </div>
        <div className="field">
          <span className="label">Icône</span>
          <div className="icon-grid" role="radiogroup" aria-label="Icône">
            {TEAM_ICONS.map((i) => (
              <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} className={icon === i ? "on" : ""} onClick={() => setIcon(i)}>
                <Icon name={i} size={16} />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Couleur</span>
          <ColorSwatches value={color} onChange={setColor} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function DeleteTeamModal({ team, onClose, onDone }: { team: Team; onClose: () => void; onDone?: () => void }) {
  const mutate = useMutate();
  const ws = useWorkspace();
  const n = ws.members.filter((m) => m.team_id === team.id).length;
  return (
    <ConfirmModal
      title={`Supprimer l'équipe ${team.name} ?`}
      text={`${n ? `Ses ${n} membre${n > 1 ? "s" : ""} resteront dans l'espace, sans équipe. ` : ""}Les projets rattachés à l'équipe seront conservés.`}
      onClose={onClose}
      onConfirm={async () => {
        const ok = await mutate(async (sb) => must(await sb.from("teams").delete().eq("id", team.id).select("id")), { success: "Équipe supprimée" });
        if (ok) onDone?.();
      }}
    />
  );
}
