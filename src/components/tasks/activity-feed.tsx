"use client";

import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { PROJECT_STATUS, STATUS } from "@/lib/constants";
import { ago, fmtDate } from "@/lib/format";
import type { ActivityItem, ProjectStatus, TaskStatus } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { openTask } from "./view-state";

const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Fil d'activité (projet ou tâche). `inTask` : phrases sans rappel de la tâche. */
export function ActivityFeed({ items, inTask, empty = "Aucune activité pour l'instant." }: { items: ActivityItem[]; inTask?: boolean; empty?: string }) {
  const ws = useWorkspace();
  if (!items.length) return <p className="faint" style={{ fontSize: "var(--fs-sm)", padding: "8px 0" }}>{empty}</p>;
  return (
    <ol className="pj-feed">
      {items.map((a) => {
        const m = (a.meta ?? {}) as Record<string, unknown>;
        const who = ws.member(a.actor_id);
        const A = <b>{who?.profile.full_name ?? "Quelqu'un"}</b>;
        const title = s(m.title) ?? "une tâche";
        const T: ReactNode = inTask ? "cette tâche" : a.task_id ? (
          <button type="button" className="pj-feed-obj" onClick={() => openTask(a.task_id!)}>
            {s(m.key) && <span className="mono faint" style={{ marginRight: 4 }}>{s(m.key)}</span>}
            {title}
          </button>
        ) : (
          <b>{title}</b>
        );
        const to = s(m.to);
        let text: ReactNode;
        switch (a.verb) {
          case "task.created":
            text = <>{A} a créé {T}</>;
            break;
          case "task.status":
            text = to && to in STATUS ? <>{A} a passé {T} en <b>{STATUS[to as TaskStatus].name}</b></> : <>{A} a changé le statut de {T}</>;
            break;
          case "task.completed":
            text = <>{A} a terminé {T}</>;
            break;
          case "task.assigned": {
            const m2 = ws.member(to);
            text = m2 ? <>{A} a assigné {T} à <b>{m2.user_id === a.actor_id ? "lui-même" : m2.profile.full_name}</b></> : <>{A} a retiré le responsable de {T}</>;
            break;
          }
          case "task.commented":
            text = <>{A} a commenté {T}</>;
            break;
          case "project.created":
            text = <>{A} a créé le projet</>;
            break;
          case "project.status":
            text = to && to in PROJECT_STATUS ? <>{A} a passé le projet en <b>{PROJECT_STATUS[to as ProjectStatus].name}</b></> : <>{A} a changé le statut du projet</>;
            break;
          default:
            text = <>{A} · {a.verb}</>;
        }
        return (
          <li key={a.id} className="pj-feed-item">
            <Avatar profile={who?.profile ?? null} size={22} title={false} />
            <span className="pj-feed-text">{text}</span>
            <time className="faint" dateTime={a.created_at} title={fmtDate(a.created_at.slice(0, 10), true)}>{ago(a.created_at)}</time>
          </li>
        );
      })}
    </ol>
  );
}
