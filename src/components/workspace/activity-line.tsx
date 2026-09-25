"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { PROJECT_STATUS, STATUS } from "@/lib/constants";
import { ago, money } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import type { ProjectStatus, TaskStatus } from "@/lib/types";
import { useOpenTask } from "./hooks";
import type { ActivityRow } from "./lite";

export type ActivityKind = "task" | "project" | "crm" | "proposal" | "other";

export const activityKind = (verb: string): ActivityKind => {
  const k = verb.split(".")[0];
  if (k === "task") return "task";
  if (k === "project") return "project";
  if (k === "deal" || k === "company" || k === "contact") return "crm";
  if (k === "proposal") return "proposal";
  return "other";
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

// Phrase lisible pour une ligne du journal : « Camille a déplacé X vers Validation client dans Maison Lumen »
export function useActivitySentence() {
  const ws = useWorkspace();
  const openTask = useOpenTask();
  const sentence = (a: ActivityRow): ReactNode => {
    const m = a.meta ?? {};
    const project = ws.project(a.project_id ?? a.task?.project_id);
    const actor = ws.member(a.actor_id)?.profile.full_name ?? "Quelqu'un";
    const taskTitle = a.task?.title ?? str(m.title) ?? "une tâche supprimée";
    const tp = ws.project(a.task?.project_id);
    const task = a.task ? (
      <a
        className="al-obj"
        href={tp ? `${ws.base}/projects/${tp.key}/board?task=${a.task.id}` : `?task=${a.task.id}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          openTask(a.task!.id);
        }}
      >
        {taskTitle}
      </a>
    ) : (
      <b className="al-obj">{taskTitle}</b>
    );
    const proj = project ? (
      <Link className="al-obj" href={`${ws.base}/projects/${project.key}/board`}>{project.name}</Link>
    ) : (
      <b className="al-obj">{str(m.project) ?? str(m.name) ?? "un projet"}</b>
    );
    const inProj = project && a.task ? <> dans {proj}</> : null;
    const dealTitle = a.deal?.title ?? str(m.title) ?? "un deal";
    const deal = a.deal ? <Link className="al-obj" href={`${ws.base}/crm/deals/${a.deal.id}`}>{dealTitle}</Link> : <b className="al-obj">{dealTitle}</b>;
    const to = str(m.to) ?? str(m.status) ?? str(m.stage);
    const proposalTitle = str(m.title) ?? "une proposition";
    const proposal = str(m.proposal_id) ? (
      <Link className="al-obj" href={`${ws.base}/proposals/${m.proposal_id}`}>{proposalTitle}</Link>
    ) : (
      <b className="al-obj">{proposalTitle}</b>
    );
    const A = <b>{actor}</b>;

    switch (a.verb) {
      case "task.created":
        return <>{A} a créé {task}{inProj}</>;
      case "task.status":
        return to && to in STATUS ? (
          <>{A} a déplacé {task} vers <b>{STATUS[to as TaskStatus].name}</b>{inProj}</>
        ) : (
          <>{A} a changé le statut de {task}{inProj}</>
        );
      case "task.completed":
        return <>{A} a terminé {task}{inProj}</>;
      case "task.assigned": {
        const who = ws.member(str(m.assignee_id) ?? str(m.to));
        if (!who) return <>{A} a retiré l&apos;assignation de {task}{inProj}</>;
        if (who.user_id === a.actor_id) return <>{A} s&apos;est assigné {task}{inProj}</>;
        return <>{A} a assigné {task} à <b>{who.profile.full_name}</b>{inProj}</>;
      }
      case "task.commented":
        return <>{A} a commenté {task}{inProj}</>;
      case "project.created":
        return <>{A} a créé le projet {proj}</>;
      case "project.status":
        return to && to in PROJECT_STATUS ? (
          <>{A} a passé {proj} en <b>{PROJECT_STATUS[to as ProjectStatus].name}</b></>
        ) : (
          <>{A} a changé le statut de {proj}</>
        );
      case "project.archived":
        return <>{A} a archivé le projet {proj}</>;
      case "deal.created":
        return <>{A} a créé le deal {deal}</>;
      case "deal.stage":
        return to ? <>{A} a déplacé le deal {deal} vers <b>{to}</b></> : <>{A} a fait avancer le deal {deal}</>;
      case "deal.won":
        return <>{A} a gagné le deal {deal}{typeof m.value === "number" ? <> ({money(m.value, ws.workspace.currency)})</> : null}</>;
      case "deal.lost":
        return <>{A} a perdu le deal {deal}</>;
      case "proposal.sent":
        return <>{A} a envoyé la proposition {proposal}</>;
      case "proposal.accepted":
        return <>La proposition {proposal} a été acceptée{str(m.name) ? <> par <b>{str(m.name)}</b></> : null}</>;
      case "proposal.declined":
        return <>La proposition {proposal} a été refusée</>;
      default:
        return <>{A} · {a.verb}</>;
    }
  };
  return sentence;
}

export function ActivityList({ items, empty }: { items: ActivityRow[]; empty?: ReactNode }) {
  const ws = useWorkspace();
  const sentence = useActivitySentence();
  if (!items.length) return <>{empty ?? null}</>;
  return (
    <ul className="al">
      {items.map((a) => {
        const actor = ws.member(a.actor_id);
        return (
          <li key={a.id} className="al-item">
            <span className="al-av">
              <Avatar profile={actor?.profile ?? { full_name: "Système", color: "#8A867E" }} size={20} />
            </span>
            <span className="al-text">{sentence(a)}</span>
            <time className="al-time num" dateTime={a.created_at} title={new Date(a.created_at).toLocaleString("fr-FR")}>
              {ago(a.created_at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
