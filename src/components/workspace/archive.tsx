"use client";

import { useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";

import "@/styles/workspace.css";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon, PageHeader } from "@/components/ui/misc";
import { ConfirmModal } from "@/components/ui/overlay";
import { StatusIcon } from "@/components/ui/status";
import { PROJECT_STATUS, colorOf } from "@/lib/constants";
import { ago } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Priority, Project, TaskStatus } from "@/lib/types";

export interface ArchivedTask {
  id: string;
  title: string;
  number: number;
  status: TaskStatus;
  priority: Priority;
  project_id: string;
  assignee_id: string | null;
  archived_at: string;
}

type Tab = "projects" | "tasks";

export function ArchiveView({ tasks }: { tasks: ArchivedTask[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const projects = ws.projects.filter((p) => p.archived_at).sort((a, b) => b.archived_at!.localeCompare(a.archived_at!));
  const [tab, setTab] = useState<Tab>(projects.length || !tasks.length ? "projects" : "tasks");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: "project"; p: Project } | { kind: "task"; t: ArchivedTask } | null>(null);

  const hide = (id: string) => setGone((s) => new Set(s).add(id));
  const restoreProject = (p: Project) => {
    hide(p.id);
    mutate(async (sb) => must(await sb.from("projects").update({ archived_at: null }).eq("id", p.id).select("id")), { success: `${p.name} est de retour dans les projets` });
  };
  const restoreTask = (t: ArchivedTask) => {
    hide(t.id);
    mutate(async (sb) => must(await sb.from("tasks").update({ archived_at: null }).eq("id", t.id).select("id")), { success: "Tâche restaurée" });
  };

  const shownProjects = projects.filter((p) => !gone.has(p.id));
  const shownTasks = tasks.filter((t) => !gone.has(t.id));

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHeader title="Archives" sub="Les projets et tâches mis de côté. Restaure-les à tout moment, ou supprime-les définitivement." />
      <div className="tabs" role="tablist" aria-label="Type d'éléments archivés">
        <button role="tab" aria-selected={tab === "projects"} className={`tab${tab === "projects" ? " on" : ""}`} onClick={() => setTab("projects")}>
          Projets <span className="count">{shownProjects.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "tasks"} className={`tab${tab === "tasks" ? " on" : ""}`} onClick={() => setTab("tasks")}>
          Tâches <span className="count">{shownTasks.length}</span>
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === "projects" &&
          (shownProjects.length ? (
            <div className="rows">
              {shownProjects.map((p) => (
                <div key={p.id} className="row-item" style={{ cursor: "default", minHeight: 52 }}>
                  <ObjIcon icon={p.icon} color={p.color} size={26} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{p.name}</span>
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {ws.company(p.company_id)?.name ?? "Projet interne"} · archivé {ago(p.archived_at!)}
                    </span>
                  </span>
                  <span className="hide-sm"><Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge></span>
                  {ws.canWrite && (
                    <>
                      <button className="btn btn-sm" onClick={() => restoreProject(p)}>
                        <ArchiveRestore size={13} />
                        Restaurer
                      </button>
                      <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirm({ kind: "project", p })} aria-label={`Supprimer définitivement ${p.name}`} title="Supprimer définitivement">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <EmptyState icon="archive" title="Aucun projet archivé" text="Archive un projet terminé depuis son menu pour alléger la barre latérale sans rien perdre." />
            </div>
          ))}

        {tab === "tasks" &&
          (shownTasks.length ? (
            <div className="rows">
              {shownTasks.map((t) => {
                const p = ws.project(t.project_id);
                const who = ws.member(t.assignee_id);
                return (
                  <div key={t.id} className="row-item" style={{ cursor: "default" }}>
                    <StatusIcon status={t.status} />
                    {p && <span className="mono fainter" style={{ fontSize: "var(--fs-2xs)" }}>{p.key}-{t.number}</span>}
                    <span className="trunc" style={{ flex: 1 }}>{t.title}</span>
                    {p && (
                      <span className="hide-sm faint" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)" }}>
                        <i style={{ width: 7, height: 7, borderRadius: 2, background: colorOf(p.color) }} />
                        {p.name}
                      </span>
                    )}
                    <span className="hide-sm faint" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>{ago(t.archived_at)}</span>
                    <Avatar profile={who?.profile ?? null} size={20} />
                    {ws.canWrite && (
                      <>
                        <button className="btn btn-sm" onClick={() => restoreTask(t)}>
                          <ArchiveRestore size={13} />
                          <span className="hide-sm">Restaurer</span>
                        </button>
                        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirm({ kind: "task", t })} aria-label={`Supprimer définitivement ${t.title}`} title="Supprimer définitivement">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card">
              <EmptyState icon="archive" title="Aucune tâche archivée" text="Les tâches archivées depuis un projet apparaissent ici." />
            </div>
          ))}
      </div>

      {confirm?.kind === "project" && (
        <ConfirmModal
          title={`Supprimer ${confirm.p.name} ?`}
          text="Le projet, toutes ses tâches, commentaires et fichiers seront supprimés définitivement. Cette action est irréversible."
          confirmLabel="Supprimer définitivement"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            hide(confirm.p.id);
            await mutate(async (sb) => must(await sb.from("projects").delete().eq("id", confirm.p.id).select("id")), { success: "Projet supprimé" });
          }}
        />
      )}
      {confirm?.kind === "task" && (
        <ConfirmModal
          title="Supprimer la tâche ?"
          text={<>« {confirm.t.title} » et ses sous-tâches, commentaires et fichiers seront supprimés définitivement.</>}
          confirmLabel="Supprimer définitivement"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            hide(confirm.t.id);
            await mutate(async (sb) => must(await sb.from("tasks").delete().eq("id", confirm.t.id).select("id")), { success: "Tâche supprimée" });
          }}
        />
      )}
    </div>
  );
}
