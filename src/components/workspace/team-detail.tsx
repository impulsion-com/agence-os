"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";

import "@/styles/workspace.css";
import { SetCrumbs } from "@/components/shell/crumbs";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon } from "@/components/ui/misc";
import { Menu } from "@/components/ui/overlay";
import { PROJECT_STATUS, ROLE } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { LiteTask } from "./lite";
import { TaskLine, useTaskToggle } from "./task-line";
import { DeleteTeamModal, TeamModal } from "./team-modal";

export function TeamDetail({ teamId, tasks }: { teamId: string; tasks: LiteTask[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const { statusOf, toggle } = useTaskToggle();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const team = ws.teams.find((t) => t.id === teamId)!;
  const members = ws.members.filter((m) => m.team_id === teamId);
  const others = ws.members.filter((m) => m.team_id !== teamId);
  const projects = ws.projects.filter((p) => p.team_id === teamId && !p.archived_at);
  const freeProjects = ws.projects.filter((p) => p.team_id !== teamId && !p.archived_at);
  const sorted = useMemo(() => [...tasks].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")), [tasks]);

  const setTeam = (userId: string, team_id: string | null, success: string) =>
    mutate(async (sb) => must(await sb.from("workspace_members").update({ team_id }).eq("workspace_id", ws.workspace.id).eq("user_id", userId).select("user_id")), { success });
  const setProjectTeam = (projectId: string, team_id: string | null, success: string) =>
    mutate(async (sb) => must(await sb.from("projects").update({ team_id }).eq("id", projectId).select("id")), { success });

  return (
    <div className="page">
      <SetCrumbs items={[{ label: "Équipes", href: `${ws.base}/teams` }, { label: team.name }]} />
      <div className="ph">
        <div className="profile-head">
          <ObjIcon icon={team.icon} color={team.color} size={48} />
          <div>
            <h1>{team.name}</h1>
            <div className="meta">{team.description || <span className="faint">Pas de description</span>}</div>
          </div>
        </div>
        {ws.isAdmin && (
          <div className="actions">
            <button className="btn" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Modifier
            </button>
            <button className="btn btn-ghost" onClick={() => setDeleting(true)} aria-label="Supprimer l'équipe">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="dash">
        <div className="col-main">
          <section className="card" aria-labelledby="h-team-tasks">
            <div className="card-h">
              <h2 id="h-team-tasks">Tâches ouvertes</h2>
              <span className="sub">{tasks.length}</span>
            </div>
            {sorted.length ? (
              sorted.slice(0, 30).map((t) => <TaskLine key={t.id} task={t} status={statusOf(t)} onToggle={() => toggle(t)} showAssignee canToggle={ws.canWrite} />)
            ) : (
              <EmptyState icon="circle-check" title="Aucune tâche ouverte" text="Les tâches des membres et des projets de l'équipe apparaîtront ici." />
            )}
          </section>

          <section className="card" aria-labelledby="h-team-projects">
            <div className="card-h">
              <h2 id="h-team-projects">Projets</h2>
              {ws.canWrite && freeProjects.length > 0 && (
                <Menu
                  align="end"
                  search="Rattacher un projet…"
                  trigger={(open) => (
                    <button className="btn btn-sm" onClick={open}>
                      <Plus size={13} />
                      Rattacher
                    </button>
                  )}
                  items={freeProjects.map((p) => ({
                    label: p.name,
                    icon: <ObjIcon icon={p.icon} color={p.color} size={16} />,
                    sub: p.team_id ? ws.teams.find((t) => t.id === p.team_id)?.name : undefined,
                    onSelect: () => setProjectTeam(p.id, teamId, `${p.name} rattaché à ${team.name}`),
                  }))}
                />
              )}
            </div>
            {projects.length ? (
              projects.map((p) => {
                const pt = tasks.filter((t) => t.project_id === p.id).length;
                return (
                  <div key={p.id} className="sugg">
                    <ObjIcon icon={p.icon} color={p.color} size={22} />
                    <Link href={`${ws.base}/projects/${p.key}/board`} className="trunc" style={{ flex: 1, fontWeight: 500 }}>{p.name}</Link>
                    <span className="faint hide-sm" style={{ fontSize: "var(--fs-xs)" }}>{pt} ouverte{pt > 1 ? "s" : ""}</span>
                    <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge>
                    {ws.canWrite && (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setProjectTeam(p.id, null, `${p.name} détaché de l'équipe`)} aria-label={`Détacher ${p.name}`} title="Détacher de l'équipe">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <EmptyState icon="folder-kanban" title="Aucun projet rattaché" text="Rattache un projet pour que l'équipe en ait la charge." />
            )}
          </section>
        </div>

        <div className="col-side">
          <section className="card" aria-labelledby="h-team-members">
            <div className="card-h">
              <h2 id="h-team-members">Membres <span className="sub">{members.length}</span></h2>
              {ws.isAdmin && others.length > 0 && (
                <Menu
                  align="end"
                  search="Ajouter un membre…"
                  trigger={(open) => (
                    <button className="btn btn-sm" onClick={open}>
                      <Plus size={13} />
                      Ajouter
                    </button>
                  )}
                  items={others.map((m) => ({
                    label: m.profile.full_name,
                    icon: <Avatar profile={m.profile} size={18} title={false} />,
                    sub: m.team_id ? ws.teams.find((t) => t.id === m.team_id)?.name : undefined,
                    onSelect: () => setTeam(m.user_id, teamId, `${m.profile.full_name} ajouté à ${team.name}`),
                  }))}
                />
              )}
            </div>
            {members.length ? (
              members.map((m) => {
                const open = tasks.filter((t) => t.assignee_id === m.user_id).length;
                return (
                  <div key={m.user_id} className="sugg">
                    <Link href={`${ws.base}/members/${m.user_id}`} className="who" style={{ flex: 1 }}>
                      <Avatar profile={m.profile} size={26} />
                      <span style={{ minWidth: 0 }}>
                        <span className="nm trunc">{m.profile.full_name}</span>
                        <span className="em trunc" style={{ display: "block" }}>{m.profile.title || m.title || ROLE[m.role].name}</span>
                      </span>
                    </Link>
                    <span className="faint num" style={{ fontSize: "var(--fs-xs)" }} title="Tâches ouvertes">{open}</span>
                    {ws.isAdmin && (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setTeam(m.user_id, null, `${m.profile.full_name} retiré de ${team.name}`)} aria-label={`Retirer ${m.profile.full_name} de l'équipe`} title="Retirer de l'équipe">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <EmptyState icon="users" title="Aucun membre" text="Ajoute les personnes qui font partie de cette équipe." />
            )}
          </section>
          {members.length > 0 && (
            <section className="card" style={{ padding: 14 }}>
              <div className="faint" style={{ fontSize: "var(--fs-xs)", marginBottom: 8 }}>Charge moyenne par membre</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <b className="num" style={{ fontSize: 20 }}>{(tasks.filter((t) => t.assignee_id && members.some((m) => m.user_id === t.assignee_id)).length / members.length).toFixed(1).replace(".", ",")}</b>
                <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>tâches ouvertes</span>
              </div>
            </section>
          )}
        </div>
      </div>

      {editing && <TeamModal team={team} onClose={() => setEditing(false)} />}
      {deleting && <DeleteTeamModal team={team} onClose={() => setDeleting(false)} onDone={() => router.push(`${ws.base}/teams`)} />}
    </div>
  );
}
