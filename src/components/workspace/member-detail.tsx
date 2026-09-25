"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Mail, Plus } from "lucide-react";

import "@/styles/workspace.css";
import { SetCrumbs } from "@/components/shell/crumbs";
import { useUI } from "@/components/shell/ui-context";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, ObjIcon } from "@/components/ui/misc";
import { PROJECT_STATUS, ROLE, colorOf } from "@/lib/constants";
import { DAY, fmtDate, today } from "@/lib/format";
import { isOverdue } from "@/lib/tasks";
import { useWorkspace } from "@/lib/workspace/context";
import { ActivityList } from "./activity-line";
import type { ActivityRow, LiteTask } from "./lite";
import { TaskLine, useTaskToggle } from "./task-line";

export function MemberDetail({ userId, tasks, activity }: { userId: string; tasks: LiteTask[]; activity: ActivityRow[] }) {
  const ws = useWorkspace();
  const ui = useUI();
  const { statusOf, toggle } = useTaskToggle();
  const m = ws.member(userId)!;
  const team = ws.teams.find((t) => t.id === m.team_id);
  const me = userId === ws.me.id;

  const s = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    const since = today().getTime() - 30 * DAY;
    const projectIds = new Set([...tasks.map((t) => t.project_id), ...ws.projects.filter((p) => p.lead_id === userId).map((p) => p.id)]);
    const projects = ws.projects.filter((p) => projectIds.has(p.id) && !p.archived_at);
    return {
      open,
      overdue: open.filter((t) => isOverdue(t)).length,
      done30: tasks.filter((t) => t.completed_at && new Date(t.completed_at).getTime() >= since).length,
      projects: projects.map((p) => {
        const mine = tasks.filter((t) => t.project_id === p.id);
        return { p, mine: mine.filter((t) => t.status !== "done").length, lead: p.lead_id === userId };
      }),
    };
  }, [tasks, ws.projects, userId]);

  return (
    <div className="page">
      <SetCrumbs items={[{ label: "Membres", href: `${ws.base}/members` }, { label: m.profile.full_name }]} />
      <div className="ph">
        <div className="profile-head">
          <Avatar profile={m.profile} size={64} />
          <div>
            <h1>
              {m.profile.full_name}
              {me && <span className="faint" style={{ fontWeight: 400, fontSize: "var(--fs-lg)" }}> (toi)</span>}
            </h1>
            <div className="meta">
              {(m.profile.title || m.title) && <span>{m.profile.title || m.title}</span>}
              <Badge color="var(--accent)">{ROLE[m.role].name}</Badge>
              {team && (
                <Link href={`${ws.base}/teams/${team.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Icon name={team.icon} size={13} style={{ color: colorOf(team.color) }} />
                  {team.name}
                </Link>
              )}
              <span className="faint">Membre depuis le {fmtDate(m.joined_at.slice(0, 10), true)}</span>
            </div>
          </div>
        </div>
        <div className="actions">
          <a className="btn" href={`mailto:${m.profile.email}`}>
            <Mail size={14} />
            {m.profile.email}
          </a>
          {me && (
            <Link className="btn" href={`${ws.base}/settings/profile`}>
              Modifier mon profil
            </Link>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Tâches ouvertes</div>
          <div className="v">{s.open.length}</div>
        </div>
        <div className="stat">
          <div className="k">En retard</div>
          <div className={`v${s.overdue ? " bad" : ""}`}>{s.overdue}</div>
        </div>
        <div className="stat">
          <div className="k">Terminées sur 30 jours</div>
          <div className="v">{s.done30}</div>
        </div>
        <div className="stat">
          <div className="k">Projets</div>
          <div className="v">{s.projects.length}</div>
        </div>
      </div>

      <div className="dash">
        <div className="col-main">
          <section className="card" aria-labelledby="h-open">
            <div className="card-h">
              <h2 id="h-open">Tâches ouvertes</h2>
              {ws.canWrite && (
                <button className="btn btn-sm" onClick={() => ui.create({ kind: "task", defaults: { assignee_id: userId } })}>
                  <Plus size={13} />
                  Assigner une tâche
                </button>
              )}
            </div>
            {s.open.length ? (
              s.open.map((t) => <TaskLine key={t.id} task={t} status={statusOf(t)} onToggle={() => toggle(t)} canToggle={ws.canWrite} />)
            ) : (
              <EmptyState icon="circle-check" title="Aucune tâche ouverte" text={`${m.profile.full_name.split(" ")[0]} n'a rien en cours pour le moment.`} />
            )}
          </section>
        </div>
        <div className="col-side">
          <section className="card" aria-labelledby="h-projects">
            <div className="card-h"><h2 id="h-projects">Projets</h2></div>
            {s.projects.length ? (
              <div style={{ paddingBottom: 6 }}>
                {s.projects.map(({ p, mine, lead }) => (
                  <Link key={p.id} href={`${ws.base}/projects/${p.key}/board`} className="sugg" style={{ borderTop: "1px solid var(--divider)" }}>
                    <ObjIcon icon={p.icon} color={p.color} size={22} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{p.name}</span>
                      <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                        {lead ? "Responsable · " : ""}
                        {mine} tâche{mine > 1 ? "s" : ""} ouverte{mine > 1 ? "s" : ""}
                      </span>
                    </span>
                    <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon="folder-kanban" title="Aucun projet" />
            )}
          </section>
          <section className="card" aria-labelledby="h-act">
            <div className="card-h"><h2 id="h-act">Activité récente</h2></div>
            <div className="card-b">
              <ActivityList items={activity} empty={<p className="faint" style={{ fontSize: "var(--fs-sm)" }}>Aucune action récente.</p>} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
