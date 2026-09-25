"use client";

import { Ellipsis } from "lucide-react";

import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { ObjIcon } from "@/components/ui/misc";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { isOverdue } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { AssigneeAvatar, Labels, TaskCounts, TaskKeyText } from "./bits";
import { useKit } from "./kit";
import { openTask } from "./view-state";

/** Ligne de tâche éditable en place (liste, mes tâches). */
export function TaskRow({ t, showProject }: { t: Task; showProject?: boolean }) {
  const kit = useKit();
  const ws = useWorkspace();
  const p = showProject ? ws.project(t.project_id) : undefined;
  const sel = kit.selected.has(t.id);
  const done = t.status === "done";
  const up = (patch: Parameters<typeof kit.actions.update>[1]) => void kit.actions.update([t], patch);
  return (
    <div
      className={`tk-row${sel ? " sel" : ""}`}
      role="row"
      tabIndex={0}
      data-id={t.id}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) kit.select(t.id, e);
        else openTask(t.id);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") openTask(t.id);
        if (e.key === "x" && kit.canWrite) kit.select(t.id);
      }}
      onContextMenu={(e) => kit.menu(e, t)}
    >
      {kit.canWrite && (
        <input
          type="checkbox"
          className="check tk-row-check"
          checked={sel}
          aria-label={`Sélectionner ${t.title}`}
          onClick={(e) => {
            e.stopPropagation();
            kit.select(t.id, e);
          }}
          onChange={() => {}}
        />
      )}
      {kit.canWrite ? (
        <>
          <span className="tk-row-prio">
            <PriorityPicker compact value={t.priority} onChange={(priority) => up({ priority })} />
          </span>
          <TaskKeyText t={t} />
          <StatusPicker compact value={t.status} onChange={(status) => up({ status })} />
        </>
      ) : (
        <>
          <span className="tk-row-prio pill"><PriorityIcon priority={t.priority} /></span>
          <TaskKeyText t={t} />
          <span className="pill"><StatusIcon status={t.status} /></span>
        </>
      )}
      <span className={`tk-row-title trunc${done ? " tk-done" : ""}`}>{t.title}</span>
      <span className="tk-row-counts">
        <TaskCounts t={t} />
      </span>
      <span className="tk-row-labels">
        <Labels ids={t.label_ids} max={2} />
      </span>
      {p && (
        <span className="tk-row-project trunc">
          <ObjIcon icon={p.icon} color={p.color} size={16} />
          <span className="trunc">{p.name}</span>
        </span>
      )}
      <span className="tk-row-due">
        {kit.canWrite ? (
          <DatePicker value={t.due_date} overdue={isOverdue(t)} onChange={(due_date) => up({ due_date })} placeholder="" />
        ) : null}
      </span>
      {kit.canWrite ? (
        <AssigneePicker compact value={t.assignee_id} onChange={(assignee_id) => up({ assignee_id })} />
      ) : (
        <AssigneeAvatar id={t.assignee_id} />
      )}
      {kit.canWrite && (
        <button type="button" className="btn btn-ghost btn-sm btn-icon tk-row-more" aria-label="Plus d'actions" onClick={(e) => kit.menu(e, t)}>
          <Ellipsis size={14} />
        </button>
      )}
    </div>
  );
}
