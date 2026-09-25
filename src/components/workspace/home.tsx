"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CircleCheck, CircleDashed, Clock, Diamond, FolderKanban, Plus, UserPlus } from "lucide-react";

import "@/styles/workspace.css";
import { useUI } from "@/components/shell/ui-context";
import { AvatarStack } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon, Progress } from "@/components/ui/misc";
import { PriorityIcon } from "@/components/ui/status";
import { PROJECT_STATUS, colorOf } from "@/lib/constants";
import { MONTHS, WDL, addDays, diffDays, fmtDate, greeting, parseDay, today } from "@/lib/format";
import { money, pct } from "@/lib/format";
import { isOverdue } from "@/lib/tasks";
import { useWorkspace } from "@/lib/workspace/context";
import type { Profile } from "@/lib/types";
import { ActivityList } from "./activity-line";
import { useOpenTask } from "./hooks";
import type { ActivityRow, LiteTask } from "./lite";
import { Sparkline } from "./sparkline";
import { TaskLine, useTaskToggle } from "./task-line";

export interface HomeData {
  tasks: LiteTask[];
  activity: ActivityRow[];
  commercial: {
    weighted: number;
    openValue: number;
    openCount: number;
    mrr: number;
    retainers: number;
    clients: number;
    followups: {
      id: string;
      body: string;
      due_at: string;
      deal_id: string | null;
      company_id: string | null;
      deal: { title: string } | null;
      company: { name: string } | null;
    }[];
  };
  spend: {
    spend: number;
    prev_spend: number;
    conversions: number;
    value: number;
    prev_value: number;
    series: { date: string; spend: number }[];
    accounts: number;
  } | null;
}

// Début de la semaine selon la préférence (lundi par défaut)
export function weekStartDate(weekStart: number = 1) {
  const t = today();
  return addDays(t, -((t.getDay() - weekStart + 7) % 7));
}

type Tab = "upcoming" | "overdue" | "done";

const nowMs = () => new Date().getTime();

export function HomeView({ data }: { data: HomeData }) {
  const ws = useWorkspace();
  const ui = useUI();
  const openTask = useOpenTask();
  const { statusOf, toggle } = useTaskToggle();
  const [tab, setTab] = useState<Tab>("upcoming");
  const me = ws.me.id;
  const cur = ws.workspace.currency;

  const s = useMemo(() => {
    const t0 = today();
    const weekStart = weekStartDate(ws.me.prefs?.weekStart ?? 1);
    const open = data.tasks.filter((t) => t.status !== "done");
    const mine = data.tasks.filter((t) => t.assignee_id === me);
    const byDue = (a: LiteTask, b: LiteTask) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
    const mineOpen = mine.filter((t) => t.status !== "done");
    const activeProjects = ws.projects.filter((p) => !p.archived_at && p.status !== "complete");
    const due = open.filter((t) => t.due_date && !isOverdue(t)).map((t) => ({ t, n: diffDays(parseDay(t.due_date)!, t0) }));
    return {
      activeProjects,
      atRisk: activeProjects.filter((p) => p.status === "risk").length,
      open: open.length,
      mineOpen: mineOpen.length,
      doneWeek: data.tasks.filter((t) => t.completed_at && new Date(t.completed_at) >= weekStart).length,
      overdue: open.filter((t) => isOverdue(t)).length,
      myOverdue: mineOpen.filter((t) => isOverdue(t)).sort(byDue),
      myUpcoming: mineOpen.filter((t) => !isOverdue(t)).sort(byDue),
      myDone: mine
        .filter((t) => t.status === "done")
        .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at))
        .slice(0, 8),
      dueToday: due.filter((x) => x.n === 0).map((x) => x.t),
      dueTomorrow: due.filter((x) => x.n === 1).map((x) => x.t),
      dueWeek: due.filter((x) => x.n > 1 && x.n <= 7).sort((a, b) => a.n - b.n).map((x) => x.t),
    };
  }, [data.tasks, ws.projects, ws.me.prefs, me]);

  const d = today();
  const dateLabel = `${WDL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`.replace(/^./, (c) => c.toUpperCase());
  const myOverdueN = s.myOverdue.length;
  const myTodayN = s.myUpcoming.filter((t) => t.due_date && diffDays(parseDay(t.due_date)!, d) === 0).length;
  const context =
    myOverdueN || myTodayN
      ? [
          myTodayN ? `${myTodayN} tâche${myTodayN > 1 ? "s" : ""} à rendre aujourd'hui` : "",
          myOverdueN ? `${myOverdueN} en retard` : "",
        ]
          .filter(Boolean)
          .join(" et ")
          .replace(/^./, (c) => "Tu as " + c) + "."
      : s.mineOpen
        ? `Tu as ${s.mineOpen} tâche${s.mineOpen > 1 ? "s" : ""} ouverte${s.mineOpen > 1 ? "s" : ""}, rien d'urgent pour l'instant.`
        : "Rien d'assigné pour l'instant, voici ce qui bouge dans l'espace.";

  const list = tab === "upcoming" ? s.myUpcoming : tab === "overdue" ? s.myOverdue : s.myDone;

  return (
    <div className="page">
      <div className="ph" style={{ marginBottom: 20 }}>
        <div>
          <h1 suppressHydrationWarning>
            {greeting()}, {ws.me.full_name.split(/\s+/)[0] || "toi"}
          </h1>
          <p suppressHydrationWarning>
            {dateLabel} · {context}
          </p>
        </div>
        {ws.canWrite && (
          <div className="actions">
            {ws.isAdmin && (
              <button className="btn" onClick={() => ui.create({ kind: "invite" })}>
                <UserPlus size={14} />
                Inviter
              </button>
            )}
            <button className="btn" onClick={() => ui.create({ kind: "project" })}>
              <FolderKanban size={14} />
              Nouveau projet
            </button>
            <button className="btn btn-primary" onClick={() => ui.create({ kind: "task" })}>
              <Plus size={14} />
              Nouvelle tâche
            </button>
          </div>
        )}
      </div>

      <div className="stats">
        <Link href={`${ws.base}/projects`} className="stat">
          <div className="k"><FolderKanban size={14} />Projets actifs</div>
          <div className="v">{s.activeProjects.length}</div>
          <div className={`d${s.atRisk ? " bad" : ""}`}>{s.atRisk ? `dont ${s.atRisk} à risque` : "aucun à risque"}</div>
        </Link>
        <Link href={`${ws.base}/my-tasks`} className="stat">
          <div className="k"><CircleDashed size={14} />Tâches ouvertes</div>
          <div className="v">{s.open}</div>
          <div className="d">dont {s.mineOpen} assignée{s.mineOpen > 1 ? "s" : ""} à moi</div>
        </Link>
        <div className="stat">
          <div className="k"><CircleCheck size={14} />Terminées</div>
          <div className="v">{s.doneWeek}</div>
          <div className="d ok">cette semaine</div>
        </div>
        <Link href={`${ws.base}/overview`} className="stat">
          <div className="k"><Clock size={14} />En retard</div>
          <div className={`v${s.overdue ? " bad" : ""}`}>{s.overdue}</div>
          <div className={`d${s.overdue ? " bad" : ""}`}>{s.overdue ? "à traiter" : "tout est dans les temps"}</div>
        </Link>
      </div>

      <div className="dash">
        <div className="col-main">
          <section className="card" aria-labelledby="h-mytasks">
            <div className="card-h">
              <h2 id="h-mytasks">Mes tâches</h2>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="seg" role="tablist" aria-label="Filtrer mes tâches">
                  {([
                    ["upcoming", "À venir", s.myUpcoming.length],
                    ["overdue", "En retard", s.myOverdue.length],
                    ["done", "Terminées", s.myDone.length],
                  ] as const).map(([k, l, n]) => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                      {l} <span className="n">{n}</span>
                    </button>
                  ))}
                </span>
                <Link href={`${ws.base}/my-tasks`} className="btn btn-ghost btn-sm btn-icon" aria-label="Voir toutes mes tâches" title="Toutes mes tâches">
                  <ArrowUpRight size={14} />
                </Link>
              </span>
            </div>
            {list.length ? (
              <div>
                {list.slice(0, 8).map((t) => (
                  <TaskLine key={t.id} task={t} status={statusOf(t)} onToggle={() => toggle(t)} canToggle={ws.canWrite} />
                ))}
                {list.length > 8 && (
                  <Link href={`${ws.base}/my-tasks`} className="tl faint" style={{ fontSize: "var(--fs-sm)" }}>
                    Voir les {list.length - 8} autres
                    <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            ) : (
              <EmptyState
                icon={tab === "overdue" ? "circle-check" : "list-checks"}
                title={tab === "overdue" ? "Rien en retard" : tab === "done" ? "Aucune tâche terminée" : "Aucune tâche à venir"}
                text={tab === "overdue" ? "Bravo, tout est dans les temps." : tab === "done" ? "Tes tâches terminées apparaîtront ici." : "Crée une tâche ou demande qu'on t'en assigne une."}
              >
                {tab === "upcoming" && ws.canWrite && (
                  <button className="btn btn-sm" onClick={() => ui.create({ kind: "task", defaults: { assignee_id: me } })}>
                    <Plus size={13} />
                    Nouvelle tâche
                  </button>
                )}
              </EmptyState>
            )}
          </section>

          <ProjectsProgress tasks={data.tasks} />

          <div className="dash-2">
            <CommercialCard c={data.commercial} currency={cur} />
            <PerformanceCard sp={data.spend} currency={cur} />
          </div>
        </div>

        <div className="col-side">
          <section className="card" aria-labelledby="h-deadlines">
            <div className="card-h">
              <h2 id="h-deadlines">Échéances à venir</h2>
              <Link href={`${ws.base}/calendar`} className="link">Calendrier</Link>
            </div>
            {s.dueToday.length + s.dueTomorrow.length + s.dueWeek.length === 0 ? (
              <EmptyState icon="calendar" title="Aucune échéance cette semaine" text="Les tâches datées des 7 prochains jours s'afficheront ici." />
            ) : (
              <div style={{ paddingBottom: 6 }}>
                {([
                  ["Aujourd'hui", s.dueToday],
                  ["Demain", s.dueTomorrow],
                  ["Cette semaine", s.dueWeek],
                ] as const).map(([label, ts]) =>
                  ts.length ? (
                    <div key={label} className="dl-group">
                      <div className="dl-h">
                        {label} <span className="count">{ts.length}</span>
                      </div>
                      {ts.slice(0, 5).map((t) => {
                        const p = ws.project(t.project_id);
                        const who = ws.member(t.assignee_id);
                        return (
                          <button key={t.id} type="button" className="dl-item" onClick={() => openTask(t.id)} title={p?.name}>
                            {t.milestone ? <Diamond size={11} className="ms" fill="currentColor" /> : <span className="dot" style={{ background: colorOf(p?.color) }} />}
                            <span className="trunc" style={{ flex: 1 }}>{t.title}</span>
                            <PriorityIcon priority={t.priority} />
                            {label === "Cette semaine" && <span className="faint num" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>{fmtDate(t.due_date)}</span>}
                            <AvatarStack profiles={who ? [who.profile] : []} size={18} />
                          </button>
                        );
                      })}
                      {ts.length > 5 && <div className="faint" style={{ fontSize: "var(--fs-xs)", padding: "2px 0 0 15px" }}>+{ts.length - 5} autres</div>}
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="h-activity">
            <div className="card-h">
              <h2 id="h-activity">Activité récente</h2>
              <Link href={`${ws.base}/activity`} className="link">Tout voir</Link>
            </div>
            <div className="card-b">
              <ActivityList
                items={data.activity}
                empty={<p className="faint" style={{ fontSize: "var(--fs-sm)", padding: "4px 0 6px" }}>Les actions de l&apos;équipe (tâches, projets, deals) apparaîtront ici.</p>}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProjectsProgress({ tasks }: { tasks: LiteTask[] }) {
  const ws = useWorkspace();
  const ui = useUI();
  const rows = useMemo(() => {
    const order = { risk: 0, active: 1, planning: 2, hold: 3, complete: 4 };
    return ws.projects
      .filter((p) => !p.archived_at)
      .map((p) => {
        const ts = tasks.filter((t) => t.project_id === p.id);
        const done = ts.filter((t) => t.status === "done").length;
        const people = [...new Set([p.lead_id, ...ts.map((t) => t.assignee_id)].filter(Boolean) as string[])]
          .map((id) => ws.member(id)?.profile)
          .filter(Boolean) as Profile[];
        return { p, progress: ts.length ? Math.round((done / ts.length) * 100) : 0, people, company: ws.company(p.company_id) };
      })
      .sort((a, b) => order[a.p.status] - order[b.p.status] || (a.p.due_date ?? "9999").localeCompare(b.p.due_date ?? "9999"))
      .slice(0, 8);
  }, [ws, tasks]);

  return (
    <section className="card" aria-labelledby="h-progress">
      <div className="card-h">
        <h2 id="h-progress">Avancement des projets</h2>
        <Link href={`${ws.base}/projects`} className="link">Tous les projets</Link>
      </div>
      {rows.length ? (
        <div className="card-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 14 }}>Projet</th>
                <th>Statut</th>
                <th>Progression</th>
                <th className="hide-sm">Échéance</th>
                <th className="r" style={{ paddingRight: 14 }}>Équipe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, progress, people, company }) => (
                <tr key={p.id}>
                  <td style={{ paddingLeft: 14, maxWidth: 280 }}>
                    <Link href={`${ws.base}/projects/${p.key}/board`} className="cell-proj">
                      <ObjIcon icon={p.icon} color={p.color} size={24} />
                      <span style={{ minWidth: 0 }}>
                        <span className="trunc" style={{ display: "block" }}>{p.name}</span>
                        {company && <span className="faint trunc" style={{ display: "block", fontSize: "var(--fs-xs)", fontWeight: 400 }}>{company.name}</span>}
                      </span>
                    </Link>
                  </td>
                  <td><Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge></td>
                  <td>
                    <span className="cell-prog">
                      <Progress value={progress} color={p.status === "complete" ? "var(--green)" : colorOf(p.color)} />
                      <span>{progress} %</span>
                    </span>
                  </td>
                  <td className="hide-sm muted-cell num">{p.due_date ? fmtDate(p.due_date) : "Non datée"}</td>
                  <td className="r" style={{ paddingRight: 14 }}>
                    {people.length ? <AvatarStack profiles={people} size={22} /> : <span className="fainter">·</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="folder-kanban" title="Aucun projet" text="Crée ton premier projet client pour suivre son avancement ici.">
          {ws.canWrite && (
            <button className="btn btn-sm btn-primary" onClick={() => ui.create({ kind: "project" })}>
              <Plus size={13} />
              Nouveau projet
            </button>
          )}
        </EmptyState>
      )}
    </section>
  );
}

function CommercialCard({ c, currency }: { c: HomeData["commercial"]; currency: string }) {
  const ws = useWorkspace();
  const now = nowMs();
  const late = c.followups.filter((f) => new Date(f.due_at).getTime() < now);
  const shown = (late.length ? late : c.followups).slice(0, 3);
  return (
    <section className="card" aria-labelledby="h-commercial">
      <div className="card-h">
        <h2 id="h-commercial">Commercial</h2>
        <Link href={`${ws.base}/crm`} className="link">Pipeline</Link>
      </div>
      <div className="kpi-big">
        <div className="v">{money(c.mrr, currency)}<span className="faint" style={{ fontSize: "var(--fs)", fontWeight: 500 }}> / mois</span></div>
        <div className="d">MRR signé · {c.clients} client{c.clients > 1 ? "s" : ""} en retainer</div>
      </div>
      <div className="kpi-list">
        <div className="kpi-row">
          <span className="k">
            Pipeline pondéré
            <small>{c.openCount} deal{c.openCount > 1 ? "s" : ""} ouvert{c.openCount > 1 ? "s" : ""} · {money(c.openValue, currency)} au total</small>
          </span>
          <span className="v">{money(c.weighted, currency)}</span>
        </div>
        <div className="kpi-row">
          <span className="k">
            À relancer
            <small>{late.length ? "Relances CRM en retard" : c.followups.length ? "Aucune en retard, prochaines relances :" : "Aucune relance planifiée"}</small>
          </span>
          <span className="v" style={late.length ? { color: "var(--red)" } : undefined}>{late.length}</span>
        </div>
      </div>
      {shown.length > 0 && (
        <div className="followups">
          {shown.map((f) => {
            const href = f.deal_id ? `${ws.base}/crm/deals/${f.deal_id}` : f.company_id ? `${ws.base}/crm/companies/${f.company_id}` : `${ws.base}/crm`;
            const n = diffDays(new Date(f.due_at), today());
            return (
              <Link key={f.id} href={href}>
                {n < 0 ? <AlertTriangle size={13} style={{ color: "var(--red)", flexShrink: 0 }} /> : <Clock size={13} className="faint" style={{ flexShrink: 0 }} />}
                <span className="trunc">{f.body || f.deal?.title || f.company?.name}</span>
                <span className="late" style={n < 0 ? undefined : { color: "var(--text-3)" }}>
                  {n < 0 ? `${-n} j de retard` : n === 0 ? "aujourd'hui" : n === 1 ? "demain" : fmtDate(new Date(f.due_at))}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PerformanceCard({ sp, currency }: { sp: HomeData["spend"]; currency: string }) {
  const ws = useWorkspace();
  const has = sp && (sp.accounts > 0 || sp.spend > 0);
  const delta = sp && sp.prev_spend > 0 ? ((sp.spend - sp.prev_spend) / sp.prev_spend) * 100 : null;
  const roas = sp && sp.spend > 0 && sp.value > 0 ? sp.value / sp.spend : null;
  const prevRoas = sp && sp.prev_spend > 0 && sp.prev_value > 0 ? sp.prev_value / sp.prev_spend : null;
  return (
    <section className="card" aria-labelledby="h-perf">
      <div className="card-h">
        <h2 id="h-perf">Performance</h2>
        <Link href={`${ws.base}/reporting`} className="link">Reporting</Link>
      </div>
      {has ? (
        <>
          <div className="kpi-big">
            <div className="v">{money(sp!.spend, currency)}</div>
            <div className="d">
              Dépense pub des 7 derniers jours
              {delta !== null && (
                <span className="trend flat" title="Par rapport aux 7 jours précédents">
                  {delta > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {pct(Math.abs(delta), 0)}
                </span>
              )}
            </div>
          </div>
          <div style={{ padding: "0 14px 8px" }}>
            <Sparkline values={sp!.series.map((x) => Number(x.spend))} label="Dépense quotidienne sur 7 jours" />
          </div>
          <div className="kpi-list">
            <div className="kpi-row">
              <span className="k">ROAS global<small>tous clients confondus</small></span>
              <span className="v">
                {roas ? roas.toFixed(2).replace(".", ",") : "n/d"}
                {roas && prevRoas && (
                  <span className={`trend ${roas >= prevRoas ? "up" : "down"}`} style={{ marginLeft: 6 }}>
                    {roas >= prevRoas ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                    {pct(Math.abs(((roas - prevRoas) / prevRoas) * 100), 0)}
                  </span>
                )}
              </span>
            </div>
            <div className="kpi-row">
              <span className="k">Conversions<small>{sp!.accounts} compte{sp!.accounts > 1 ? "s" : ""} publicitaire{sp!.accounts > 1 ? "s" : ""}</small></span>
              <span className="v">{Math.round(Number(sp!.conversions)).toLocaleString("fr-FR")}</span>
            </div>
          </div>
        </>
      ) : (
        <EmptyState icon="chart-column" title="Aucune donnée publicitaire" text="Connecte un compte Meta Ads ou Google Ads pour suivre la dépense de tes clients.">
          {ws.isAdmin && (
            <Link href={`${ws.base}/settings/integrations`} className="btn btn-sm">
              Connecter un compte
            </Link>
          )}
        </EmptyState>
      )}
    </section>
  );
}
