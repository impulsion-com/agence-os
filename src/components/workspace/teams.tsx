"use client";

import Link from "next/link";
import { useState } from "react";
import { Ellipsis, FolderKanban, Plus, Users } from "lucide-react";

import "@/styles/workspace.css";
import { AvatarStack } from "@/components/ui/avatar";
import { EmptyState, ObjIcon, PageHeader } from "@/components/ui/misc";
import { Menu } from "@/components/ui/overlay";
import { useWorkspace } from "@/lib/workspace/context";
import type { Team } from "@/lib/types";
import { DeleteTeamModal, TeamModal } from "./team-modal";

export function TeamsGrid({ openByTeam }: { openByTeam: Record<string, number> }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);

  return (
    <>
      {ws.teams.length ? (
        <div className="team-grid">
          {ws.teams.map((t) => {
            const members = ws.members.filter((m) => m.team_id === t.id);
            const projects = ws.projects.filter((p) => p.team_id === t.id && !p.archived_at);
            return (
              <article key={t.id} className="team-card">
                <div className="top">
                  <div className="h">
                    <ObjIcon icon={t.icon} color={t.color} size={30} />
                    <Link href={`${ws.base}/teams/${t.id}`} className="trunc">{t.name}</Link>
                    {ws.isAdmin && (
                      <Menu
                        align="end"
                        trigger={(open) => (
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label={`Actions pour ${t.name}`}>
                            <Ellipsis size={15} />
                          </button>
                        )}
                        items={[
                          { label: "Modifier", onSelect: () => setEditing(t) },
                          { label: "", separator: true },
                          { label: "Supprimer l'équipe", danger: true, onSelect: () => setDeleting(t) },
                        ]}
                      />
                    )}
                  </div>
                  <p>{t.description || <span className="fainter">Pas de description</span>}</p>
                </div>
                <div className="bot">
                  <span><Users size={13} />{members.length} membre{members.length > 1 ? "s" : ""}</span>
                  <span><FolderKanban size={13} />{projects.length} projet{projects.length > 1 ? "s" : ""}</span>
                  {!!openByTeam[t.id] && <span>{openByTeam[t.id]} tâche{openByTeam[t.id] > 1 ? "s" : ""} ouverte{openByTeam[t.id] > 1 ? "s" : ""}</span>}
                  {members.length > 0 && <AvatarStack profiles={members.map((m) => m.profile)} size={22} max={4} />}
                </div>
              </article>
            );
          })}
          {ws.isAdmin && (
            <button className="team-card" onClick={() => setEditing("new")} style={{ alignItems: "center", justifyContent: "center", minHeight: 150, color: "var(--text-3)", border: "1px dashed var(--border-strong)", boxShadow: "none", background: "transparent", gap: 6 }}>
              <Plus size={18} />
              Nouvelle équipe
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          <EmptyState icon="layers" title="Aucune équipe" text="Regroupe les personnes par métier (media buying, créa, account management) pour répartir les projets.">
            {ws.isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
                <Plus size={13} />
                Nouvelle équipe
              </button>
            )}
          </EmptyState>
        </div>
      )}
      {editing && <TeamModal team={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteTeamModal team={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

export function TeamsView({ openByTeam }: { openByTeam: Record<string, number> }) {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <PageHeader title="Équipes" sub="Les groupes de personnes qui travaillent ensemble sur les projets clients.">
        {ws.isAdmin && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Nouvelle équipe
          </button>
        )}
      </PageHeader>
      <TeamsGrid openByTeam={openByTeam} />
      {creating && <TeamModal onClose={() => setCreating(false)} />}
    </div>
  );
}
