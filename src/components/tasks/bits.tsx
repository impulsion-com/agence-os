"use client";

import { useState, type ReactNode } from "react";
import { Diamond, ListChecks, MessageSquare, Paperclip, Plus, Repeat, Tag } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { LabelChip, ObjIcon } from "@/components/ui/misc";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { PRIORITY, STATUS, colorOf } from "@/lib/constants";
import type { GroupKey, Priority, Task, TaskStatus } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import type { NewTask } from "./actions";
import { useKit } from "./kit";

export function useTaskKey() {
  const ws = useWorkspace();
  return (t: Pick<Task, "number" | "project_id">) => `${ws.project(t.project_id)?.key ?? "?"}-${t.number}`;
}

export function TaskKeyText({ t }: { t: Pick<Task, "number" | "project_id"> }) {
  const key = useTaskKey();
  return <span className="tk-key mono">{key(t)}</span>;
}

export function Labels({ ids, max = 3 }: { ids: string[]; max?: number }) {
  const ws = useWorkspace();
  const ls = ids.map((id) => ws.label(id)).filter(Boolean) as { id: string; name: string; color: string }[];
  if (!ls.length) return null;
  return (
    <span className="tk-labels">
      {ls.slice(0, max).map((l) => (
        <LabelChip key={l.id} name={l.name} color={l.color} />
      ))}
      {ls.length > max && <span className="chip">+{ls.length - max}</span>}
    </span>
  );
}

/** Petits compteurs : sous-tâches, commentaires, pièces jointes, récurrence, jalon. */
export function TaskCounts({ t, bar }: { t: Task; bar?: boolean }) {
  const done = t.subtasks.filter((s) => s.done).length;
  return (
    <>
      {t.milestone && (
        <span className="tk-meta" title="Jalon">
          <Diamond size={12} style={{ color: "var(--violet)" }} />
        </span>
      )}
      {t.subtasks.length > 0 && (
        <span className="tk-meta num" title="Sous-tâches">
          <ListChecks size={12} />
          {done}/{t.subtasks.length}
          {bar && (
            <span className="tk-subbar">
              <i style={{ width: `${(done / t.subtasks.length) * 100}%`, background: done === t.subtasks.length ? "var(--green)" : undefined }} />
            </span>
          )}
        </span>
      )}
      {t.comment_count > 0 && (
        <span className="tk-meta num" title="Commentaires">
          <MessageSquare size={12} />
          {t.comment_count}
        </span>
      )}
      {t.attachment_count > 0 && (
        <span className="tk-meta num" title="Pièces jointes">
          <Paperclip size={12} />
          {t.attachment_count}
        </span>
      )}
      {t.recurrence && (
        <span className="tk-meta" title="Tâche récurrente">
          <Repeat size={12} />
        </span>
      )}
    </>
  );
}

export interface GroupMeta {
  label: string;
  icon: ReactNode;
  defaults: Partial<NewTask>;
}

export function useGroupMeta() {
  const ws = useWorkspace();
  return (g: GroupKey, key: string): GroupMeta => {
    switch (g) {
      case "status":
        return { label: STATUS[key as TaskStatus]?.name ?? key, icon: <StatusIcon status={key as TaskStatus} />, defaults: { status: key as TaskStatus } };
      case "priority":
        return { label: PRIORITY[key as Priority]?.name ?? key, icon: <PriorityIcon priority={key as Priority} />, defaults: { priority: key as Priority } };
      case "assignee": {
        const m = ws.member(key === "none" ? null : key);
        return { label: m?.profile.full_name ?? "Non assigné", icon: <Avatar profile={m?.profile ?? null} size={18} title={false} />, defaults: { assignee_id: m ? key : null } };
      }
      case "project": {
        const p = ws.project(key);
        return { label: p?.name ?? "Projet inconnu", icon: p ? <ObjIcon icon={p.icon} color={p.color} size={18} /> : null, defaults: { project_id: key } };
      }
      case "label": {
        const l = ws.label(key);
        return {
          label: l?.name ?? "Sans étiquette",
          icon: l ? <span style={{ width: 9, height: 9, borderRadius: 3, background: colorOf(l.color) }} /> : <Tag size={14} className="faint" />,
          defaults: l ? { label_ids: [key] } : {},
        };
      }
      default:
        return { label: "Toutes les tâches", icon: null, defaults: {} };
    }
  };
}

/** Ajout rapide d'une tâche (bas de colonne, bas de groupe). */
export function QuickAdd({ defaults, className = "add-row", label = "Ajouter une tâche", position, startOpen = false }: { defaults: Partial<NewTask>; className?: string; label?: string; position?: () => number; startOpen?: boolean }) {
  const ws = useWorkspace();
  const kit = useKit();
  const [open, setOpen] = useState(startOpen);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!kit.canWrite) return null;
  const projectId = defaults.project_id ?? kit.projectId ?? ws.projects.find((p) => !p.archived_at)?.id;
  const submit = async () => {
    const v = title.trim();
    if (!v || !projectId || busy) return;
    setBusy(true);
    const res = await kit.actions.create({ ...defaults, project_id: projectId, title: v, position: position?.() });
    setBusy(false);
    if (res) setTitle("");
  };
  if (!open)
    return (
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus size={14} />
        {label}
      </button>
    );
  return (
    <div className="tk-quick">
      <input
        autoFocus
        className="input"
        placeholder={projectId ? "Titre de la tâche, puis Entrée" : "Crée d'abord un projet"}
        value={title}
        disabled={!projectId}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setTitle("");
            setOpen(false);
          }
        }}
      />
    </div>
  );
}

export function AssigneeAvatar({ id, size = 20 }: { id: string | null; size?: number }) {
  const ws = useWorkspace();
  return <Avatar profile={ws.member(id)?.profile ?? null} size={size} />;
}
