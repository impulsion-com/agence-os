"use client";

import { useState } from "react";
import { Check, Ellipsis, Plus } from "lucide-react";

import { DueText } from "@/components/pickers";
import { useUI } from "@/components/shell/ui-context";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { STATUSES } from "@/lib/constants";
import { between, sortTasks } from "@/lib/tasks";
import type { SortKey, Task, TaskStatus } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { AssigneeAvatar, Labels, QuickAdd, TaskCounts, TaskKeyText } from "./bits";
import { useKit } from "./kit";
import { useNavIds } from "./nav";
import { openTask } from "./view-state";

function Card({ t, dragging, onDragStart, onDragEnd, showProject }: { t: Task; dragging: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void; showProject?: boolean }) {
  const kit = useKit();
  const ws = useWorkspace();
  const done = t.status === "done";
  const p = showProject ? ws.project(t.project_id) : undefined;
  return (
    <div
      className={`kcard tk-card${dragging ? " dragging" : ""}${kit.selected.has(t.id) ? " sel" : ""}`}
      draggable={kit.canWrite}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-id={t.id}
      tabIndex={0}
      role="button"
      aria-label={t.title}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) kit.select(t.id, e);
        else openTask(t.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") openTask(t.id);
      }}
      onContextMenu={(e) => kit.menu(e, t)}
    >
      {kit.canWrite && (
        <span className="tk-card-acts" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            title={done ? "Rouvrir" : "Terminer"}
            aria-label={done ? "Rouvrir la tâche" : "Terminer la tâche"}
            onClick={() => void kit.actions.update([t], { status: done ? "todo" : "done" })}
          >
            <Check size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Plus d'actions" onClick={(e) => kit.menu(e, t)}>
            <Ellipsis size={14} />
          </button>
        </span>
      )}
      {(t.label_ids.length > 0 || p) && (
        <div className="tk-card-top">
          {p && <span className="faint trunc" style={{ fontSize: "var(--fs-2xs)" }}>{p.name}</span>}
          <Labels ids={t.label_ids} max={3} />
        </div>
      )}
      <div className={`t${done ? " tk-done" : ""}`}>{t.title}</div>
      {t.subtasks.length > 0 && (
        <div className="meta">
          <TaskCounts t={{ ...t, comment_count: 0, attachment_count: 0, recurrence: null, milestone: false }} bar />
        </div>
      )}
      <div className="meta">
        <TaskKeyText t={t} />
        {t.priority !== "none" && <PriorityIcon priority={t.priority} size={13} />}
        {t.due_date && <DueText date={t.due_date} done={done} />}
        <TaskCounts t={{ ...t, subtasks: [] }} />
        <span style={{ marginLeft: "auto" }}>
          <AssigneeAvatar id={t.assignee_id} size={20} />
        </span>
      </div>
    </div>
  );
}

/** Kanban par statut : glisser-déposer entre colonnes et réordonnancement (positions optimistes). */
export function TaskBoard({ tasks, sort, defaults, showProject }: { tasks: Task[]; sort: SortKey; defaults?: { project_id?: string }; showProject?: boolean }) {
  const kit = useKit();
  const ui = useUI();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; index: number } | null>(null);

  const cols = STATUSES.map((s) => ({ ...s, tasks: sortTasks(tasks.filter((t) => t.status === s.id), sort) }));
  useNavIds(cols.flatMap((c) => c.tasks.map((t) => t.id)));

  const computeIndex = (e: React.DragEvent, status: TaskStatus) => {
    const col = e.currentTarget as HTMLElement;
    const cards = [...col.querySelectorAll<HTMLElement>(".tk-card")].filter((c) => c.dataset.id !== drag);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return { status, index };
  };

  const drop = (status: TaskStatus) => {
    const t = tasks.find((x) => x.id === drag);
    const target = over;
    setDrag(null);
    setOver(null);
    if (!t || !target) return;
    const list = cols.find((c) => c.id === status)!.tasks.filter((x) => x.id !== t.id);
    const manual = sort === "manual";
    const position = manual
      ? between(list[target.index - 1]?.position, list[target.index]?.position)
      : t.status === status
        ? t.position
        : between(list.reduce((m, x) => Math.max(m, x.position), 0), undefined);
    if (t.status === status && position === t.position) return;
    void kit.actions.update([t], { status, position });
  };

  return (
    <div className="tv-board-wrap">
      <div className="board tk-board">
        {cols.map((c) => {
          const lastPos = () => c.tasks.reduce((m, x) => Math.max(m, x.position), 0) + 1000;
          return (
            <section
              key={c.id}
              className={`col${over?.status === c.id && drag ? " drop" : ""}`}
              aria-label={c.name}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const n = computeIndex(e, c.id);
                if (n.status !== over?.status || n.index !== over?.index) setOver(n);
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o?.status === c.id ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(c.id);
              }}
            >
              <header className="col-h">
                <StatusIcon status={c.id} />
                <span>{c.name}</span>
                <span className="count">{c.tasks.length}</span>
                {kit.canWrite && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{ marginLeft: "auto", ["--h" as string]: "22px" }}
                    aria-label={`Nouvelle tâche dans ${c.name}`}
                    onClick={() => ui.create({ kind: "task", defaults: { status: c.id, project_id: defaults?.project_id ?? kit.projectId } })}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </header>
              <div className="col-b">
                {(() => {
                  const visible = c.tasks.filter((t) => t.id !== drag);
                  const out: React.ReactNode[] = [];
                  c.tasks.forEach((t) => {
                    const vi = visible.indexOf(t);
                    if (drag && over?.status === c.id && vi === over.index) out.push(<div key="ind" className="tk-drop-ind" />);
                    out.push(
                      <Card
                        key={t.id}
                        t={t}
                        showProject={showProject}
                        dragging={drag === t.id}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", t.id);
                          setDrag(t.id);
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setOver(null);
                        }}
                      />,
                    );
                  });
                  if (drag && over?.status === c.id && over.index >= visible.length) out.push(<div key="ind" className="tk-drop-ind" />);
                  return out;
                })()}
                {!c.tasks.length && !drag && <div className="tk-col-empty">Aucune tâche</div>}
                <QuickAdd defaults={{ status: c.id, project_id: defaults?.project_id }} position={lastPos} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
