"use client";

import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { DueText } from "@/components/pickers";
import { PRIORITY, STATUS, colorOf } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";
import { logActivity, must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { TaskStatus } from "@/lib/types";
import { rowProps, useOpenTask } from "./hooks";
import type { LiteTask } from "./lite";

// État optimiste des statuts : cocher une tâche la termine immédiatement à l'écran.
export function useTaskToggle() {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [over, setOver] = useState<Record<string, TaskStatus>>({});
  const statusOf = (t: LiteTask) => over[t.id] ?? t.status;
  const toggle = async (t: LiteTask) => {
    const from = statusOf(t);
    const to: TaskStatus = from === "done" ? "todo" : "done";
    setOver((o) => ({ ...o, [t.id]: to }));
    const res = await mutate(
      async (sb) => {
        must(await sb.from("tasks").update({ status: to }).eq("id", t.id).select("id"));
        await logActivity(sb, {
          workspace_id: ws.workspace.id,
          verb: to === "done" ? "task.completed" : "task.status",
          project_id: t.project_id,
          task_id: t.id,
          meta: { from, to },
        });
        return true;
      },
      {
        success: to === "done" ? "Tâche terminée" : "Tâche rouverte",
        undo: async () => {
          setOver((o) => ({ ...o, [t.id]: from }));
          await supabaseBrowser().from("tasks").update({ status: from }).eq("id", t.id);
        },
      },
    );
    if (!res) setOver((o) => ({ ...o, [t.id]: from }));
  };
  return { statusOf, toggle };
}

export function TaskLine({
  task,
  status,
  onToggle,
  showProject = true,
  showAssignee = false,
  canToggle = true,
}: {
  task: LiteTask;
  status?: TaskStatus;
  onToggle?: () => void;
  showProject?: boolean;
  showAssignee?: boolean;
  canToggle?: boolean;
}) {
  const ws = useWorkspace();
  const open = useOpenTask();
  const st = status ?? task.status;
  const p = ws.project(task.project_id);
  const who = ws.member(task.assignee_id);
  return (
    <div className={`tl${st === "done" ? " done" : ""}`} {...rowProps(() => open(task.id))}>
      <button
        type="button"
        className="tl-st"
        disabled={!canToggle || !onToggle}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={st === "done" ? `Rouvrir « ${task.title} »` : `Terminer « ${task.title} »`}
        title={st === "done" ? "Rouvrir" : `${STATUS[st].name} · cliquer pour terminer`}
      >
        <StatusIcon status={st} />
      </button>
      <span className="tl-t trunc">
        {p && <span className="tl-key mono">{p.key}-{task.number}</span>}
        {task.title}
      </span>
      {showProject && p && (
        <span className="tl-p trunc">
          <i style={{ background: colorOf(p.color) }} />
          <span className="trunc">{p.name}</span>
        </span>
      )}
      <span className="tl-pr" title={PRIORITY[task.priority].name}>
        <PriorityIcon priority={task.priority} />
      </span>
      {showAssignee && (
        <span className="tl-av">
          <Avatar profile={who?.profile ?? null} size={20} />
        </span>
      )}
      <span className="tl-due">
        <DueText date={task.due_date} done={st === "done"} />
      </span>
    </div>
  );
}
