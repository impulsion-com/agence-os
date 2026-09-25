"use client";

import { useRef, useState } from "react";
import { Archive, Calendar, ChevronLeft, ChevronRight, CircleDot, Copy, ExternalLink, Link2, SignalHigh, Tag, Trash2, UserRound } from "lucide-react";

import { MiniCalendar } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { MenuList, PopLayer, type MenuItem } from "@/components/ui/overlay";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { PRIORITIES, STATUSES, colorOf } from "@/lib/constants";
import { addDays, fmtDate, iso, today } from "@/lib/format";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import type { TaskActions } from "./actions";
import { openTask, taskUrl } from "./view-state";

type Mode = "root" | "status" | "priority" | "assignee" | "due" | "labels";

/**
 * Menu contextuel d'une tâche (ou d'une sélection) : clic droit ou bouton « … ».
 * Les entrées Statut, Priorité… ouvrent un second niveau dans le même panneau.
 */
export function TaskContextMenu({
  at,
  tasks,
  actions,
  onClose,
  onDelete,
}: {
  at: DOMRect | { x: number; y: number };
  tasks: Task[];
  actions: TaskActions;
  onClose: () => void;
  onDelete: (list: Task[]) => void;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("root");
  const stay = useRef(false);
  const t = tasks[0];
  const many = tasks.length > 1;
  const close = () => {
    if (stay.current) {
      stay.current = false;
      return;
    }
    onClose();
  };
  const go = (m: Mode) => () => {
    stay.current = true;
    setMode(m);
  };
  const arrow = <ChevronRight size={13} />;

  const back = (
    <button type="button" className="mi faint" onClick={() => setMode("root")}>
      <ChevronLeft size={14} />
      Retour
    </button>
  );

  let body: React.ReactNode;
  if (mode === "root") {
    const items: MenuItem[] = [
      ...(many ? [{ label: `${tasks.length} tâches sélectionnées`, heading: true } as MenuItem] : []),
      { label: "Statut", icon: <CircleDot size={14} />, sub: arrow, onSelect: go("status") },
      { label: "Priorité", icon: <SignalHigh size={14} />, sub: arrow, onSelect: go("priority") },
      { label: "Responsable", icon: <UserRound size={14} />, sub: arrow, onSelect: go("assignee") },
      { label: "Échéance", icon: <Calendar size={14} />, sub: arrow, onSelect: go("due") },
      { label: "Étiquettes", icon: <Tag size={14} />, sub: arrow, onSelect: go("labels") },
      { label: "", separator: true },
      ...(!many
        ? [
            { label: "Ouvrir", icon: <ExternalLink size={14} />, onSelect: () => openTask(t.id) },
            {
              label: "Copier le lien",
              icon: <Link2 size={14} />,
              onSelect: () => {
                navigator.clipboard.writeText(taskUrl(ws.base, ws.project(t.project_id)?.key, t.id));
                toast("Lien copié");
              },
            },
            { label: "Dupliquer", icon: <Copy size={14} />, onSelect: () => void actions.duplicate(t) },
          ]
        : []),
      { label: "Archiver", icon: <Archive size={14} />, onSelect: () => void actions.archive(tasks) },
      { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => onDelete(tasks) },
    ];
    body = <MenuList items={items} onClose={close} />;
  } else if (mode === "status") {
    body = (
      <>
        {back}
        <MenuList
          onClose={onClose}
          search="Statut…"
          items={STATUSES.map((s, i) => ({
            label: s.name, icon: <StatusIcon status={s.id} />, sub: String(i + 1), checked: !many && t.status === s.id,
            onSelect: () => void actions.update(tasks, { status: s.id }, { toast: many ? "Statut mis à jour" : undefined, undo: true }),
          }))}
        />
      </>
    );
  } else if (mode === "priority") {
    body = (
      <>
        {back}
        <MenuList
          onClose={onClose}
          search="Priorité…"
          items={PRIORITIES.map((p) => ({
            label: p.name, icon: <PriorityIcon priority={p.id} />, checked: !many && t.priority === p.id,
            onSelect: () => void actions.update(tasks, { priority: p.id }, { toast: many ? "Priorité mise à jour" : undefined, undo: true }),
          }))}
        />
      </>
    );
  } else if (mode === "assignee") {
    body = (
      <>
        {back}
        <MenuList
          onClose={onClose}
          search="Assigner à…"
          items={[
            { label: "Non assigné", icon: <Avatar profile={null} size={18} />, checked: !many && !t.assignee_id, onSelect: () => void actions.update(tasks, { assignee_id: null }, { undo: true }) },
            ...ws.members
              .filter((m) => m.role !== "guest")
              .map((m) => ({
                label: m.profile.full_name + (m.user_id === ws.me.id ? " (moi)" : ""),
                icon: <Avatar profile={m.profile} size={18} title={false} />,
                checked: !many && t.assignee_id === m.user_id,
                onSelect: () => void actions.update(tasks, { assignee_id: m.user_id }, { toast: many ? "Responsable mis à jour" : undefined, undo: true }),
              })),
          ]}
        />
      </>
    );
  } else if (mode === "due") {
    const set = (d: string | null) => {
      void actions.update(tasks, { due_date: d }, { toast: many ? "Échéance mise à jour" : undefined, undo: true });
      onClose();
    };
    body = (
      <div>
        {back}
        {(
          [
            ["Aujourd'hui", 0],
            ["Demain", 1],
            ["Dans 1 semaine", 7],
          ] as const
        ).map(([l, n]) => (
          <button key={l} type="button" className="mi" onClick={() => set(iso(addDays(today(), n)))}>
            {l}
            <span className="sub">{fmtDate(addDays(today(), n))}</span>
          </button>
        ))}
        <div className="mi-sep" />
        <MiniCalendar value={many ? null : t.due_date} weekStart={ws.me.prefs?.weekStart ?? 1} onPick={set} />
        <div className="mi-sep" />
        <button type="button" className="mi danger" onClick={() => set(null)}>
          Retirer la date
        </button>
      </div>
    );
  } else {
    body = (
      <div>
        {back}
        {ws.labels.map((l) => {
          const on = tasks.every((x) => x.label_ids.includes(l.id));
          return (
            <button key={l.id} type="button" className="mi" onClick={() => void actions.toggleLabel(tasks, l.id)}>
              <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(l.color) }} />
              {l.name}
            </button>
          );
        })}
        {!ws.labels.length && <div className="mi faint">Aucune étiquette</div>}
      </div>
    );
  }

  return (
    <PopLayer anchor={at} onClose={onClose} width={mode === "due" ? 250 : 230}>
      <div key={mode}>{body}</div>
    </PopLayer>
  );
}
