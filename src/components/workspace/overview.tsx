"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChartGantt, Diamond, Plus } from "lucide-react";

import "@/styles/workspace.css";
import { useUI } from "@/components/shell/ui-context";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon, PageHeader, Progress } from "@/components/ui/misc";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { PRIORITIES, PROJECT_STATUS, STATUSES, colorOf } from "@/lib/constants";
import { diffDays, fmtDate, parseDay, pct, relDate, today } from "@/lib/format";
import { isOverdue } from "@/lib/tasks";
import { useWorkspace } from "@/lib/workspace/context";
import type { Project, TaskStatus } from "@/lib/types";
import type { LiteTask } from "./lite";
import { TaskLine, useTaskToggle } from "./task-line";

const ST_COLOR: Record<TaskStatus, string> = {
  backlog: "var(--st-backlog)",
  todo: "var(--st-todo)",
  progress: "var(--st-progress)",
  review: "var(--st-review)",
  done: "var(--st-done)",
};
const PR_COLOR = { urgent: "var(--red)", high: "var(--orange)", medium: "var(--amber)", low: "var(--blue)", none: "var(--border-strong)" };

interface Health {
  p: Project;
  total: number;
  open: number;
  overdue: number;
  progress: number;
  next: LiteTask | undefined;
  late: boolean;
}

export function OverviewView({ tasks, pendingInvites }: { tasks: LiteTask[]; pendingInvites: number }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const { statusOf, toggle } = useTaskToggle();

  const d = useMemo(() => {
    const projects = ws.projects.filter((p) => !p.archived_at);
    const live = new Set(projects.map((p) => p.id));
    const ts = tasks.filter((t) => live.has(t.project_id));
    const open = ts.filter((t) => t.status !== "done");
    const t0 = today();
    const health: Health[] = projects.map((p) => {
      const pt = ts.filter((t) => t.project_id === p.id);
      const po = pt.filter((t) => t.status !== "done");
      const upcoming = po.filter((t) => t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
      return {
        p,
        total: pt.length,
        open: po.length,
        overdue: po.filter((t) => isOverdue(t)).length,
        progress: pt.length ? Math.round(((pt.length - po.length) / pt.length) * 100) : 0,
        next: upcoming.find((t) => t.milestone && !isOverdue(t)) ?? upcoming.find((t) => !isOverdue(t)),
        late: !!p.due_date && p.status !== "complete" && diffDays(parseDay(p.due_date)!, t0) < 0,
      };
    });
    const order = { risk: 0, active: 1, planning: 2, hold: 3, complete: 4 };
    health.sort((a, b) => order[a.p.status] - order[b.p.status] || b.overdue - a.overdue);
    const risky = health.filter((h) => h.p.status !== "complete" && (h.p.status === "risk" || h.overdue > 0 || h.late));

    const load = ws.members
      .filter((m) => m.role !== "guest")
      .map((m) => {
        const mine = open.filter((t) => t.assignee_id === m.user_id);
        return { m, total: mine.length, by: STATUSES.filter((s) => s.id !== "done").map((s) => ({ s: s.id, n: mine.filter((t) => t.status === s.id).length })) };
      })
      .sort((a, b) => b.total - a.total);
    const unassigned = open.filter((t) => !t.assignee_id).length;

    return {
      projects,
      ts,
      open,
      health,
      risky,
      load,
      unassigned,
      maxLoad: Math.max(1, ...load.map((l) => l.total), unassigned),
      byStatus: STATUSES.map((s) => ({ s, n: ts.filter((t) => t.status === s.id).length })),
      byPriority: PRIORITIES.map((p) => ({ p, n: open.filter((t) => t.priority === p.id).length })),
      overdue: open.filter((t) => isOverdue(t)).sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
      done: ts.length - open.length,
    };
  }, [ws, tasks]);

  const completion = d.ts.length ? (d.done / d.ts.length) * 100 : 0;

  return (
    <div className="page">
      <PageHeader title="Vue d'ensemble" sub={`La santé de tous les projets de ${ws.workspace.name}.`}>
        <Link href={`${ws.base}/timeline`} className="btn">
          <ChartGantt size={14} />
          Timeline
        </Link>
        {ws.canWrite && (
          <button className="btn btn-primary" onClick={() => ui.create({ kind: "project" })}>
            <Plus size={14} />
            Nouveau projet
          </button>
        )}
      </PageHeader>

      <div className="stats">
        <div className="stat">
          <div className="k">Projets</div>
          <div className="v">{d.projects.length}</div>
          <div className="d">
            {(() => {
              const n = d.projects.filter((p) => p.status === "complete").length;
              return `${n} terminé${n > 1 ? "s" : ""} · ${d.risky.length} à surveiller`;
            })()}
          </div>
        </div>
        <div className="stat">
          <div className="k">Tâches</div>
          <div className="v">{d.ts.length}</div>
          <div className="d">{d.open.length} ouvertes · {d.unassigned} non assignées</div>
        </div>
        <div className="stat">
          <div className="k">Taux d&apos;achèvement</div>
          <div className="v">{pct(completion, 0)}</div>
          <div className="d">tous projets confondus</div>
        </div>
        <Link href={`${ws.base}/members`} className="stat">
          <div className="k">Membres</div>
          <div className="v">{ws.members.length}</div>
          <div className="d">{ws.isAdmin && pendingInvites ? `${pendingInvites} invitation${pendingInvites > 1 ? "s" : ""} en attente` : `${ws.teams.length} équipe${ws.teams.length > 1 ? "s" : ""}`}</div>
        </Link>
      </div>

      <div className="dash">
        <div className="col-main">
          {d.risky.length > 0 && (
            <section className="card" aria-labelledby="h-risk" style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--red) 30%, var(--border))" }}>
              <div className="card-h">
                <h2 id="h-risk" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={15} style={{ color: "var(--red)" }} />
                  Projets à surveiller
                </h2>
                <span className="sub">{d.risky.length} projet{d.risky.length > 1 ? "s" : ""}</span>
              </div>
              {d.risky.map((h) => {
                const why = [
                  h.p.status === "risk" ? "marqué à risque" : "",
                  h.overdue ? `${h.overdue} tâche${h.overdue > 1 ? "s" : ""} en retard` : "",
                  h.late ? `échéance dépassée (${fmtDate(h.p.due_date)})` : "",
                ].filter(Boolean);
                return (
                  <Link key={h.p.id} href={`${ws.base}/projects/${h.p.key}/board`} className="risk-card">
                    <ObjIcon icon={h.p.icon} color={h.p.color} size={28} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }} className="trunc">{h.p.name}</div>
                      <div className="why">{why.join(" · ").replace(/^./, (c) => c.toUpperCase())}</div>
                    </div>
                    <span className="cell-prog" style={{ width: 160, minWidth: 0 }}>
                      <Progress value={h.progress} color={colorOf(h.p.color)} />
                      <span>{h.progress} %</span>
                    </span>
                  </Link>
                );
              })}
            </section>
          )}

          <section className="card" aria-labelledby="h-health">
            <div className="card-h">
              <h2 id="h-health">Santé des projets</h2>
              <Link href={`${ws.base}/projects`} className="link">Tous les projets</Link>
            </div>
            {d.health.length ? (
              <div className="card-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 14 }}>Projet</th>
                      <th>Statut</th>
                      <th>Progression</th>
                      <th className="r">Tâches ouvertes</th>
                      <th className="hide-sm" style={{ paddingRight: 14 }}>Prochain jalon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.health.map((h) => {
                      const lead = ws.member(h.p.lead_id);
                      const company = ws.company(h.p.company_id);
                      return (
                        <tr key={h.p.id} className="clickable" onClick={() => router.push(`${ws.base}/projects/${h.p.key}/board`)}>
                          <td style={{ paddingLeft: 14, maxWidth: 260 }}>
                            <Link href={`${ws.base}/projects/${h.p.key}/board`} className="cell-proj" onClick={(e) => e.stopPropagation()}>
                              <ObjIcon icon={h.p.icon} color={h.p.color} size={24} />
                              <span style={{ minWidth: 0 }}>
                                <span className="trunc" style={{ display: "block" }}>{h.p.name}</span>
                                <span className="faint trunc" style={{ display: "block", fontSize: "var(--fs-xs)", fontWeight: 400 }}>
                                  {company?.name ?? "Projet interne"}
                                  {lead ? ` · ${lead.profile.full_name.split(" ")[0]}` : ""}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td><Badge color={PROJECT_STATUS[h.p.status].color}>{PROJECT_STATUS[h.p.status].name}</Badge></td>
                          <td>
                            <span className="cell-prog">
                              <Progress value={h.progress} color={h.p.status === "complete" ? "var(--green)" : colorOf(h.p.color)} />
                              <span>{h.progress} %</span>
                            </span>
                          </td>
                          <td className="r num" style={{ whiteSpace: "nowrap" }}>
                            {h.open}
                            {h.overdue > 0 && <span className="red" style={{ fontSize: "var(--fs-xs)" }}> · {h.overdue} en retard</span>}
                          </td>
                          <td className="hide-sm" style={{ paddingRight: 14, maxWidth: 200 }}>
                            {h.next ? (
                              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-sm)" }} title={h.next.title}>
                                {h.next.milestone ? <Diamond size={11} fill="currentColor" style={{ color: "var(--violet)", flexShrink: 0 }} /> : <StatusIcon status={h.next.status} size={12} />}
                                <span className="trunc">{h.next.title}</span>
                                <span className="faint num" style={{ flexShrink: 0, fontSize: "var(--fs-xs)" }}>{relDate(h.next.due_date)}</span>
                              </span>
                            ) : (
                              <span className="fainter" style={{ fontSize: "var(--fs-sm)" }}>Aucun</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="folder-kanban" title="Aucun projet" text="Les projets actifs de l'agence apparaîtront ici avec leur santé." />
            )}
          </section>

          <section className="card" aria-labelledby="h-overdue">
            <div className="card-h">
              <h2 id="h-overdue">Tâches en retard</h2>
              <span className="sub">{d.overdue.length}</span>
            </div>
            {d.overdue.length ? (
              d.overdue.slice(0, 12).map((t) => (
                <TaskLine key={t.id} task={t} status={statusOf(t)} onToggle={() => toggle(t)} canToggle={ws.canWrite} showAssignee />
              ))
            ) : (
              <EmptyState icon="circle-check" title="Aucune tâche en retard" text="Toute l'équipe est dans les temps." />
            )}
          </section>
        </div>

        <div className="col-side">
          <section className="card" aria-labelledby="h-status">
            <div className="card-h"><h2 id="h-status">Répartition par statut</h2></div>
            <div style={{ padding: "0 14px 8px" }}>
              <div className="stack lg" aria-hidden>
                {d.byStatus.filter((x) => x.n).map((x) => (
                  <i key={x.s.id} style={{ flex: x.n, background: ST_COLOR[x.s.id] }} />
                ))}
              </div>
            </div>
            <div style={{ paddingBottom: 8 }}>
              {d.byStatus.map((x) => (
                <div key={x.s.id} className="dist-row">
                  <StatusIcon status={x.s.id} />
                  {x.s.name}
                  <span className="n">{x.n}</span>
                  <span className="p">{d.ts.length ? Math.round((x.n / d.ts.length) * 100) : 0} %</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" aria-labelledby="h-prio">
            <div className="card-h">
              <h2 id="h-prio">Priorité des tâches ouvertes</h2>
            </div>
            <div style={{ padding: "0 14px 8px" }}>
              <div className="stack lg" aria-hidden>
                {d.byPriority.filter((x) => x.n).map((x) => (
                  <i key={x.p.id} style={{ flex: x.n, background: PR_COLOR[x.p.id] }} />
                ))}
              </div>
            </div>
            <div style={{ paddingBottom: 8 }}>
              {d.byPriority.map((x) => (
                <div key={x.p.id} className="dist-row">
                  <PriorityIcon priority={x.p.id} />
                  {x.p.name}
                  <span className="n">{x.n}</span>
                  <span className="p">{d.open.length ? Math.round((x.n / d.open.length) * 100) : 0} %</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" aria-labelledby="h-load">
            <div className="card-h">
              <h2 id="h-load">Charge par membre</h2>
              <span className="sub">tâches ouvertes</span>
            </div>
            <div style={{ paddingBottom: 4 }}>
              {d.load.map(({ m, total, by }) => (
                <Link key={m.user_id} href={`${ws.base}/members/${m.user_id}`} className="load-row">
                  <span className="who" style={{ gap: 8 }}>
                    <Avatar profile={m.profile} size={20} />
                    <span className="trunc">{m.profile.full_name}</span>
                  </span>
                  <span className="stack" style={{ width: `${Math.max(4, (total / d.maxLoad) * 100)}%` }} title={by.map((b) => `${STATUSES.find((s) => s.id === b.s)!.name} : ${b.n}`).join(" · ")}>
                    {by.filter((b) => b.n).map((b) => (
                      <i key={b.s} style={{ flex: b.n, background: ST_COLOR[b.s] }} />
                    ))}
                  </span>
                  <span className="n">{total}</span>
                </Link>
              ))}
              {d.unassigned > 0 && (
                <div className="load-row">
                  <span className="who" style={{ gap: 8 }}>
                    <Avatar profile={null} size={20} />
                    <span className="faint">Non assignées</span>
                  </span>
                  <span className="stack" style={{ width: `${(d.unassigned / d.maxLoad) * 100}%` }}>
                    <i style={{ flex: 1, background: "var(--border-strong)" }} />
                  </span>
                  <span className="n">{d.unassigned}</span>
                </div>
              )}
            </div>
            <div className="legend">
              {STATUSES.filter((s) => s.id !== "done").map((s) => (
                <span key={s.id}><i style={{ background: ST_COLOR[s.id] }} />{s.name}</span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
