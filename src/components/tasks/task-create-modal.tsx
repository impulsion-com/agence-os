"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import { AssigneePicker, DatePicker, LabelsPicker, PriorityPicker, ProjectPicker, StatusPicker } from "@/components/pickers";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import type { Priority, TaskStatus } from "@/lib/types";
import { useMutate, useWorkspace } from "@/lib/workspace/context";
import { insertTask } from "./actions";
import { openTask } from "./view-state";

import "@/styles/tasks.css";

export interface TaskDefaults {
  project_id?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignee_id?: string | null;
  due_date?: string | null;
  label_ids?: string[];
}

/** Modale de création de tâche (raccourci C, bouton « Nouveau », « + » des vues). */
export function TaskCreateModal({ defaults = {}, onClose }: { defaults?: TaskDefaults; onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const path = usePathname();
  const fromPath = /\/projects\/([A-Z0-9]{2,6})(\/|$)/.exec(path)?.[1];
  const active = ws.projects.filter((p) => !p.archived_at);
  const initialProject = defaults.project_id ?? active.find((p) => p.key === fromPath)?.id ?? ws.favorites.find((id) => active.some((p) => p.id === id)) ?? active[0]?.id ?? null;

  const [project, setProject] = useState<string | null>(initialProject);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaults.status ?? "todo");
  const [priority, setPriority] = useState<Priority>(defaults.priority ?? "none");
  const [assignee, setAssignee] = useState<string | null>(defaults.assignee_id !== undefined ? defaults.assignee_id : path.endsWith("/my-tasks") ? ws.me.id : null);
  const [labels, setLabels] = useState<string[]>(defaults.label_ids ?? []);
  const [due, setDue] = useState<string | null>(defaults.due_date ?? null);
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);

  const submit = async () => {
    const v = title.trim();
    if (!v || !project || busy) return;
    setBusy(true);
    const task = await mutate(async (sb) => {
      const t = await insertTask(sb, ws.workspace.id, {
        project_id: project, title: v, description, status, priority, assignee_id: assignee, due_date: due, label_ids: labels,
      });
      const key = `${ws.project(project)?.key}-${t.number}`;
      await sb.from("activity").insert({ workspace_id: ws.workspace.id, project_id: project, task_id: t.id, verb: "task.created", meta: { title: v, key } });
      return t;
    });
    setBusy(false);
    if (!task) return;
    toast(`Tâche ${ws.project(project)?.key}-${task.number} créée`, { action: { label: "Ouvrir", run: () => openTask(task.id) } });
    if (another) {
      setTitle("");
      setDescription("");
      setN((x) => x + 1);
    } else onClose();
  };

  if (!active.length)
    return (
      <Modal title="Nouvelle tâche" onClose={onClose}>
        <p className="muted">Crée d&apos;abord un projet pour y ranger tes tâches (raccourci P).</p>
      </Modal>
    );

  return (
    <Modal
      title="Nouvelle tâche"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <label className="tk-another">
            <input type="checkbox" className="toggle" checked={another} onChange={(e) => setAnother(e.target.checked)} />
            Créer une autre
          </label>
          <span className="faint tk-cmd-hint">⌘ + Entrée</span>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!title.trim() || !project || busy} onClick={submit}>
            Créer la tâche
          </button>
        </>
      }
    >
      <div
        className="tk-create"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="tk-create-project">
          <ProjectPicker value={project} onChange={setProject} />
        </div>
        <input
          key={n}
          autoFocus
          className="tk-create-title"
          placeholder="Titre de la tâche"
          aria-label="Titre de la tâche"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <textarea
          className="tk-create-desc"
          placeholder="Ajoute une description, un brief, des liens…"
          aria-label="Description"
          value={description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="tk-create-props">
          <StatusPicker value={status} onChange={setStatus} />
          <PriorityPicker value={priority} onChange={setPriority} />
          <AssigneePicker value={assignee} onChange={setAssignee} />
          <LabelsPicker value={labels} onChange={setLabels} />
          <DatePicker value={due} onChange={setDue} />
        </div>
      </div>
    </Modal>
  );
}
