"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { AssigneePicker, DatePicker, LabelsPicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { ObjIcon } from "@/components/ui/misc";
import { PRIORITY, STATUSES } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { isOverdue, sortTasks } from "@/lib/tasks";
import type { SortKey, Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { TaskCounts, useTaskKey } from "./bits";
import { useKit } from "./kit";
import { useNavIds } from "./nav";
import { openTask } from "./view-state";

type Col = "key" | "title" | "project" | "status" | "priority" | "assignee" | "labels" | "start" | "due" | "created";

const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]));

/** Table triable par colonne, cellules éditables. */
export function TaskTable({ tasks, sort, showProject }: { tasks: Task[]; sort: SortKey; showProject?: boolean }) {
  const kit = useKit();
  const ws = useWorkspace();
  const key = useTaskKey();
  const [by, setBy] = useState<{ col: Col; dir: 1 | -1 } | null>(null);

  const cmp: Record<Col, (a: Task, b: Task) => number> = {
    key: (a, b) => key(a).localeCompare(key(b), "fr", { numeric: true }),
    title: (a, b) => a.title.localeCompare(b.title, "fr"),
    project: (a, b) => (ws.project(a.project_id)?.name ?? "").localeCompare(ws.project(b.project_id)?.name ?? "", "fr"),
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    priority: (a, b) => PRIORITY[b.priority].weight - PRIORITY[a.priority].weight,
    assignee: (a, b) => (ws.member(a.assignee_id)?.profile.full_name ?? "~").localeCompare(ws.member(b.assignee_id)?.profile.full_name ?? "~", "fr"),
    labels: (a, b) => (ws.label(a.label_ids[0] ?? "")?.name ?? "~").localeCompare(ws.label(b.label_ids[0] ?? "")?.name ?? "~", "fr"),
    start: (a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"),
    due: (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    created: (a, b) => a.created_at.localeCompare(b.created_at),
  };
  const rows = by ? [...tasks].sort((a, b) => cmp[by.col](a, b) * by.dir) : sortTasks(tasks, sort);
  useNavIds(rows.map((t) => t.id));

  const allSel = rows.length > 0 && rows.every((t) => kit.selected.has(t.id));
  const cols: [Col, string][] = [
    ["key", "Clé"],
    ["title", "Titre"],
    ...(showProject ? ([["project", "Projet"]] as [Col, string][]) : []),
    ["status", "Statut"],
    ["priority", "Priorité"],
    ["assignee", "Responsable"],
    ["labels", "Étiquettes"],
    ["start", "Début"],
    ["due", "Échéance"],
    ["created", "Créée"],
  ];

  const up = (t: Task, patch: Parameters<typeof kit.actions.update>[1]) => void kit.actions.update([t], patch);
  const ro = !kit.canWrite;

  return (
    <div className="tk-table-wrap">
      <table className="tbl tk-table">
        <thead>
          <tr>
            {kit.canWrite && (
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  className="check"
                  aria-label="Tout sélectionner"
                  checked={allSel}
                  onChange={() => kit.setSelected(allSel ? new Set() : new Set(rows.map((t) => t.id)))}
                />
              </th>
            )}
            {cols.map(([c, name]) => (
              <th key={c} aria-sort={by?.col === c ? (by.dir === 1 ? "ascending" : "descending") : undefined} className={`tk-th-${c}`}>
                <button
                  type="button"
                  className="tk-th-btn"
                  onClick={() => setBy((b) => (b?.col === c ? (b.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
                >
                  {name}
                  {by?.col === c && (by.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const p = ws.project(t.project_id);
            return (
              <tr key={t.id} className={kit.selected.has(t.id) ? "sel" : undefined} onContextMenu={(e) => kit.menu(e, t)}>
                {kit.canWrite && (
                  <td>
                    <input
                      type="checkbox"
                      className="check"
                      aria-label={`Sélectionner ${t.title}`}
                      checked={kit.selected.has(t.id)}
                      onClick={(e) => kit.select(t.id, e)}
                      onChange={() => {}}
                    />
                  </td>
                )}
                <td className="mono faint" style={{ fontSize: "var(--fs-xs)" }}>{key(t)}</td>
                <td className="tk-td-title">
                  <button type="button" className={`tk-title-btn trunc${t.status === "done" ? " tk-done" : ""}`} onClick={() => openTask(t.id)}>
                    {t.title}
                  </button>
                  <span className="tk-row-counts">
                    <TaskCounts t={t} />
                  </span>
                </td>
                {showProject && (
                  <td>
                    {p && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 180 }}>
                        <ObjIcon icon={p.icon} color={p.color} size={16} />
                        <span className="trunc">{p.name}</span>
                      </span>
                    )}
                  </td>
                )}
                <td>{ro ? null : <StatusPicker value={t.status} onChange={(status) => up(t, { status })} />}</td>
                <td>{ro ? null : <PriorityPicker value={t.priority} onChange={(priority) => up(t, { priority })} />}</td>
                <td style={{ maxWidth: 170 }}>{ro ? null : <AssigneePicker value={t.assignee_id} onChange={(assignee_id) => up(t, { assignee_id })} />}</td>
                <td>{ro ? null : <LabelsPicker value={t.label_ids} onChange={(ids) => void kit.actions.setLabels(t, ids)} />}</td>
                <td>{ro ? fmtDate(t.start_date) : <DatePicker value={t.start_date} placeholder="Début" onChange={(start_date) => up(t, { start_date })} />}</td>
                <td>{ro ? fmtDate(t.due_date) : <DatePicker value={t.due_date} overdue={isOverdue(t)} onChange={(due_date) => up(t, { due_date })} />}</td>
                <td className="faint num" style={{ fontSize: "var(--fs-sm)", whiteSpace: "nowrap" }}>{fmtDate(t.created_at.slice(0, 10))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
