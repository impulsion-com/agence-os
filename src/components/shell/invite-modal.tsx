"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { ROLES } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Role } from "@/lib/types";

// Invitation par lien : on crée l'invitation et on copie le lien à envoyer.
// (L'envoi d'email est laissé à brancher : Resend, SMTP Supabase…)
export function InviteModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [team, setTeam] = useState<string>("");
  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);

  const submit = async () => {
    const list = emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!list.length) return toast("Aucune adresse email valide", { error: true });
    const rows = await mutate(
      async (sb) =>
        must(
          await sb
            .from("invitations")
            .upsert(list.map((email) => ({ workspace_id: ws.workspace.id, email, role, team_id: team || null, invited_by: ws.me.id })), { onConflict: "workspace_id,email" })
            .select("email, token"),
        ),
      { success: list.length > 1 ? `${list.length} invitations créées` : "Invitation créée" },
    );
    if (rows) setLinks(rows.map((r: { email: string; token: string }) => ({ email: r.email, url: `${location.origin}/invite/${r.token}` })));
  };

  if (!ws.isAdmin)
    return (
      <Modal title="Inviter un membre" onClose={onClose}>
        <p className="muted">Seuls les propriétaires et admins de l&apos;espace peuvent inviter de nouveaux membres.</p>
      </Modal>
    );

  return (
    <Modal
      title="Inviter dans l'espace"
      onClose={onClose}
      footer={
        links.length ? (
          <button className="btn btn-primary" onClick={onClose}>Terminé</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Annuler</button>
            <button className="btn btn-primary" onClick={submit}>Créer les invitations</button>
          </>
        )
      }
    >
      {links.length ? (
        <div className="field">
          <label>Liens d&apos;invitation à envoyer</label>
          {links.map((l) => (
            <div key={l.email} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="trunc" style={{ width: 180 }}>{l.email}</span>
              <input className="input mono" readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(l.url); toast("Lien copié"); }}>Copier</button>
            </div>
          ))}
          <span className="hint">La personne crée son compte avec cette adresse puis rejoint l&apos;espace en ouvrant le lien.</span>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="inv-emails">Adresses email</label>
            <textarea id="inv-emails" className="textarea" autoFocus placeholder="camille@agence.fr, lucas@agence.fr" value={emails} onChange={(e) => setEmails(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label htmlFor="inv-role">Rôle</label>
              <select id="inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.filter((r) => r.id !== "owner").map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="inv-team">Équipe</label>
              <select id="inv-team" className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">Aucune</option>
                {ws.teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="faint" style={{ fontSize: "var(--fs-xs)" }}>{ROLES.find((r) => r.id === role)?.desc}</p>
        </>
      )}
    </Modal>
  );
}
