"use client";

import Link from "next/link";
import { useState } from "react";
import { Diamond } from "lucide-react";

import { DueText } from "@/components/pickers";
import { ActivityFeed } from "@/components/tasks/activity-feed";
import { useTaskKey } from "@/components/tasks/bits";
import { openTask } from "@/components/tasks/view-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Progress } from "@/components/ui/misc";
import { StatusIcon } from "@/components/ui/status";
import { PLATFORMS, PROJECT_STATUS, STATUSES } from "@/lib/constants";
import { diffDays, fmtDate, money, parseDay, today } from "@/lib/format";
import { isOverdue, projectProgress } from "@/lib/tasks";
import type { ActivityItem, Project, Task } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

function TaskLine({ t }: { t: Task }) {
  const key = useTaskKey();
  return (
    <button type="button" className="pj-tline" onClick={() => openTask(t.id)}>
      {t.milestone ? <Diamond size={13} style={{ color: "var(--violet)", flexShrink: 0 }} /> : <StatusIcon status={t.status} />}
      <span className="mono faint" style={{ fontSize: 11.5 }}>{key(t)}</span>
      <span className="trunc" style={{ flex: 1 }}>{t.title}</span>
      <DueText date={t.due_date} done={t.status === "done"} />
    </button>
  );
}

export function ProjectOverview({ project, tasks, memberIds, activity }: { project: Project; tasks: Task[]; memberIds: string[]; activity: ActivityItem[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [desc, setDesc] = useState(project.description);
  const [src, setSrc] = useState(project.description);
  if (src !== project.description) {
    setSrc(project.description);
    setDesc(project.description);
  }
  const pct = projectProgress(tasks);
  const done = tasks.filter((t) => t.status === "done").length;
  const overdue = tasks.filter(isOverdue);
  const open = tasks.filter((t) => t.status !== "done");
  const byDue = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  const milestones = open.filter((t) => t.milestone).sort(byDue).slice(0, 5);
  const soon = open
    .filter((t) => t.due_date && diffDays(parseDay(t.due_date)!, today()) <= 10)
    .sort(byDue)
    .slice(0, 6);
  const company = ws.company(project.company_id);
  const lead = ws.member(project.lead_id);
  const people = [...new Set([project.lead_id, ...memberIds, ...tasks.map((t) => t.assignee_id)].filter(Boolean) as string[])]
    .map((id) => ws.member(id))
    .filter(Boolean) as NonNullable<ReturnType<typeof ws.member>>[];
  const left = project.due_date ? diffDays(parseDay(project.due_date)!, today()) : null;

  const saveDesc = () => {
    if (desc === project.description) return;
    void mutate(async (sb) => must(await sb.from("projects").update({ description: desc }).eq("id", project.id)), { success: "Description enregistrée" });
  };

  return (
    <div className="pj-ov">
      <div className="pj-ov-main">
        <section className="card pj-ov-card">
          <h2 className="pj-h2">Description</h2>
          {ws.canWrite ? (
            <textarea
              className="pj-desc"
              value={desc}
              placeholder="Objectifs, contexte client, KPI visés, liens utiles…"
              onChange={(e) => {
                setDesc(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }
              }}
              onBlur={saveDesc}
              aria-label="Description du projet"
            />
          ) : (
            <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{project.description || "Pas de description."}</p>
          )}
        </section>

        <section className="card pj-ov-card">
          <div className="pj-ov-prog">
            <div>
              <h2 className="pj-h2">Progression</h2>
              <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                {done} sur {tasks.length} tâche{tasks.length > 1 ? "s" : ""} terminée{done > 1 ? "s" : ""}
                {overdue.length > 0 && <span style={{ color: "var(--red)" }}> · {overdue.length} en retard</span>}
              </p>
            </div>
            <span className="pj-big num">{pct} %</span>
          </div>
          <Progress value={pct} color={pct === 100 ? "var(--green)" : undefined} />
          {tasks.length > 0 && (
            <>
              <div className="pj-dist" aria-label="Répartition par statut">
                {STATUSES.map((s) => {
                  const n = tasks.filter((t) => t.status === s.id).length;
                  return n ? <i key={s.id} style={{ flex: n, background: `var(--st-${s.id})` }} title={`${s.name} : ${n}`} /> : null;
                })}
              </div>
              <div className="pj-legend">
                {STATUSES.map((s) => (
                  <Link key={s.id} href={`${ws.base}/projects/${project.key}/list?st=${s.id}`} className="pj-legend-i">
                    <StatusIcon status={s.id} size={13} />
                    {s.name}
                    <b className="num">{tasks.filter((t) => t.status === s.id).length}</b>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>

        <div className="pj-ov-2">
          <section className="card pj-ov-card">
            <h2 className="pj-h2">Prochains jalons</h2>
            {milestones.length ? milestones.map((t) => <TaskLine key={t.id} t={t} />) : <p className="faint pj-none">Aucun jalon à venir. Marque une tâche comme jalon depuis son tiroir.</p>}
          </section>
          <section className="card pj-ov-card">
            <h2 className="pj-h2">Échéances proches</h2>
            {soon.length ? soon.map((t) => <TaskLine key={t.id} t={t} />) : <p className="faint pj-none">Rien d&apos;urgent dans les 10 prochains jours.</p>}
          </section>
        </div>

        <section className="card pj-ov-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="pj-h2">Activité récente</h2>
            <Link href={`${ws.base}/projects/${project.key}/activity`} className="faint" style={{ fontSize: "var(--fs-sm)" }}>Tout voir</Link>
          </div>
          <ActivityFeed items={activity.slice(0, 8)} />
        </section>
      </div>

      <aside className="pj-ov-side">
        <section className="card pj-ov-card">
          <h2 className="pj-h2">Détails</h2>
          <dl className="pj-kv">
            <dt>Statut</dt>
            <dd><Badge color={PROJECT_STATUS[project.status].color}>{PROJECT_STATUS[project.status].name}</Badge></dd>
            <dt>Client</dt>
            <dd>
              {company ? (
                <Link href={`${ws.base}/crm/companies/${company.id}`} className="pj-client">
                  <span className="av" style={{ ["--s" as string]: "18px", ["--c" as string]: company.color, borderRadius: 4 }}>{company.name[0]}</span>
                  {company.name}
                </Link>
              ) : (
                <span className="faint">Projet interne</span>
              )}
            </dd>
            <dt>Responsable</dt>
            <dd>
              {lead ? (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <Avatar profile={lead.profile} size={18} />
                  {lead.profile.full_name}
                </span>
              ) : (
                <span className="faint">Aucun</span>
              )}
            </dd>
            <dt>Dates</dt>
            <dd className="num">
              {project.start_date || project.due_date ? (
                <>
                  {fmtDate(project.start_date) || "?"} → {fmtDate(project.due_date) || "?"}
                  {left !== null && project.status !== "complete" && (
                    <div className="faint" style={{ fontSize: "var(--fs-xs)", color: left < 0 ? "var(--red)" : undefined }}>
                      {left < 0 ? `Échéance dépassée de ${-left} j` : left === 0 ? "Échéance aujourd'hui" : `${left} j restants`}
                    </div>
                  )}
                </>
              ) : (
                <span className="faint">Non planifié</span>
              )}
            </dd>
            <dt>Budget média</dt>
            <dd className="num">{project.monthly_budget ? `${money(project.monthly_budget, ws.workspace.currency)} / mois` : <span className="faint">Non défini</span>}</dd>
            <dt>Plateformes</dt>
            <dd style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {project.platforms.length ? (
                project.platforms.map((id) => {
                  const p = PLATFORMS.find((x) => x.id === id);
                  return (
                    <span key={id} className="chip" style={{ ["--c" as string]: p?.color }}>
                      <i />
                      {p?.name ?? id}
                    </span>
                  );
                })
              ) : (
                <span className="faint">Aucune</span>
              )}
            </dd>
          </dl>
        </section>

        <section className="card pj-ov-card">
          <h2 className="pj-h2">Équipe</h2>
          {people.length ? (
            <ul className="pj-people">
              {people.map((m) => {
                const n = open.filter((t) => t.assignee_id === m.user_id).length;
                return (
                  <li key={m.user_id}>
                    <Avatar profile={m.profile} size={24} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="trunc" style={{ display: "block" }}>{m.profile.full_name}</span>
                      <span className="faint trunc" style={{ display: "block", fontSize: "var(--fs-xs)" }}>
                        {m.user_id === project.lead_id ? "Responsable du projet" : m.title || m.profile.title || "Membre"}
                      </span>
                    </span>
                    <span className="faint num" style={{ fontSize: "var(--fs-xs)" }}>{n} en cours</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="faint pj-none">Personne n&apos;est encore rattaché à ce projet.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
