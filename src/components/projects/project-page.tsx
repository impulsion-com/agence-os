"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Archive, ArchiveRestore, Calendar, ChartGantt, ChevronDown, Filter, Kanban, LayoutDashboard, Link2, List, Paperclip,
  Pencil, Plus, Settings, Star, Table, Trash2,
} from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { useUI } from "@/components/shell/ui-context";
import { FilesView } from "@/components/projects/files-view";
import { ActivityFeed } from "@/components/tasks/activity-feed";
import { TaskViews, type Layout } from "@/components/tasks/task-views";
import { configToQuery, parseView } from "@/components/tasks/view-state";
import { AvatarStack } from "@/components/ui/avatar";
import { Badge, ObjIcon } from "@/components/ui/misc";
import { ConfirmModal, ContextMenu, Menu, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { PROJECT_STATUS } from "@/lib/constants";
import type { Json } from "@/lib/database.types";
import type { ActivityItem, Project, ProjectStatus, SavedView, Task, ViewConfig } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { ProjectCreateModal } from "./project-create-modal";
import { ProjectOverview } from "./project-overview";
import { useFavorite } from "./use-favorite";

import "@/styles/projects.css";

export type ProjectViewKey = Layout | "overview" | "files" | "activity";

const TABS: { id: ProjectViewKey; name: string; icon: React.ReactNode }[] = [
  { id: "overview", name: "Vue d'ensemble", icon: <LayoutDashboard size={14} /> },
  { id: "board", name: "Tableau", icon: <Kanban size={14} /> },
  { id: "list", name: "Liste", icon: <List size={14} /> },
  { id: "table", name: "Table", icon: <Table size={14} /> },
  { id: "calendar", name: "Calendrier", icon: <Calendar size={14} /> },
  { id: "timeline", name: "Timeline", icon: <ChartGantt size={14} /> },
  { id: "files", name: "Fichiers", icon: <Paperclip size={14} /> },
  { id: "activity", name: "Activité", icon: <Activity size={14} /> },
];

const LAYOUTS: Layout[] = ["board", "list", "table", "calendar", "timeline"];

export function ProjectPage({
  project,
  view,
  tasks,
  views,
  memberIds,
  activity,
}: {
  project: Project;
  view: ProjectViewKey;
  tasks: Task[];
  views: SavedView[];
  memberIds: string[];
  activity: ActivityItem[];
}) {
  const ws = useWorkspace();
  const ui = useUI();
  const sp = useSearchParams();
  const href = `${ws.base}/projects/${project.key}`;
  const sv = sp.get("sv");
  const current = views.find((v) => v.id === sv);
  const isLayout = (LAYOUTS as string[]).includes(view);

  return (
    <div className="pj-page">
      <DeferredCrumbs items={[{ label: "Projets", href: `${ws.base}/projects` }, { label: project.name, href: `${href}/board` }, ...(view !== "board" ? [{ label: current?.name ?? TABS.find((t) => t.id === view)!.name }] : [])]} />
      <ProjectHeader project={project} tasks={tasks} memberIds={memberIds} />
      <SavedTabs project={project} view={view} views={views} current={current} href={href} />
      {isLayout && (
        <TaskViews
          key={view}
          tasks={tasks}
          layout={view as Layout}
          projectId={project.id}
          defaults={{ group: "status", sort: "manual" }}
          toolbarRight={
            <>
              {current && <UpdateViewButton view={current} layout={view as Layout} />}
              {ws.canWrite && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => ui.create({ kind: "task", defaults: { project_id: project.id } })}>
                  <Plus size={14} />
                  <span className="tv-hide-sm">Nouvelle tâche</span>
                </button>
              )}
            </>
          }
        />
      )}
      {view === "overview" && <ProjectOverview project={project} tasks={tasks} memberIds={memberIds} activity={activity} />}
      {view === "files" && <FilesView projectId={project.id} />}
      {view === "activity" && (
        <div className="pj-activity">
          <h2 className="pj-h2">Activité du projet</h2>
          <ActivityFeed items={activity} empty="Rien à signaler pour l'instant. Les créations, changements de statut et commentaires apparaîtront ici." />
        </div>
      )}
    </div>
  );
}

// Le fournisseur du fil d'Ariane se réinitialise après le premier rendu : on pose la surcharge un tour plus tard.
function DeferredCrumbs({ items }: { items: { label: string; href?: string }[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []); // eslint-disable-line react-hooks/set-state-in-effect
  return on ? <SetCrumbs items={items} /> : null;
}

function UpdateViewButton({ view, layout }: { view: SavedView; layout: Layout }) {
  const sp = useSearchParams();
  const mutate = useMutate();
  const cur = parseView(sp, { group: "status" });
  const saved = parseView(new URLSearchParams(configToQuery(view.config, { group: "status" })), { group: "status" });
  const changed = JSON.stringify(cur) !== JSON.stringify(saved) || (view.config.layout ?? "list") !== layout;
  if (!changed) return null;
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() =>
        mutate(
          async (sb) =>
            must(await sb.from("saved_views").update({ config: { layout, filters: cur.filters, sort: cur.sort, group: cur.group } as unknown as Json }).eq("id", view.id)),
          { success: `Vue « ${view.name} » mise à jour` },
        )
      }
    >
      Mettre à jour la vue
    </button>
  );
}

function ProjectHeader({ project, tasks, memberIds }: { project: Project; tasks: Task[]; memberIds: string[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const router = useRouter();
  const [fav, toggleFav] = useFavorite(project.id);
  const [name, setName] = useState(project.name);
  const [src, setSrc] = useState(project.name);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  if (src !== project.name) {
    setSrc(project.name);
    setName(project.name);
  }
  const company = ws.company(project.company_id);
  const people = [...new Set([project.lead_id, ...memberIds, ...tasks.map((t) => t.assignee_id)].filter(Boolean) as string[])]
    .map((id) => ws.member(id)?.profile)
    .filter(Boolean) as NonNullable<ReturnType<typeof ws.member>>["profile"][];

  const saveName = () => {
    const v = name.trim();
    if (!v) return setName(project.name);
    if (v === project.name) return;
    void mutate(async (sb) => must(await sb.from("projects").update({ name: v }).eq("id", project.id)));
  };
  const setStatus = (status: ProjectStatus) =>
    mutate(
      async (sb) => {
        must(await sb.from("projects").update({ status }).eq("id", project.id));
        await sb.from("activity").insert({ workspace_id: ws.workspace.id, project_id: project.id, verb: "project.status", meta: { name: project.name, from: project.status, to: status } });
      },
      { success: `Projet passé en ${PROJECT_STATUS[status].name}` },
    );
  const archive = () =>
    mutate(async (sb) => must(await sb.from("projects").update({ archived_at: project.archived_at ? null : new Date().toISOString() }).eq("id", project.id)), {
      success: project.archived_at ? "Projet restauré" : "Projet archivé",
    });

  return (
    <header className="pj-head">
      <div className="pj-head-main">
        <ObjIcon icon={project.icon} color={project.color} size={34} />
        {ws.canWrite ? (
          <input
            className="pj-name"
            value={name}
            aria-label="Nom du projet"
            size={Math.max(8, name.length)}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(project.name);
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <h1 className="pj-name">{project.name}</h1>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          aria-pressed={fav}
          aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
          title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
          onClick={toggleFav}
          style={fav ? { color: "var(--amber)" } : undefined}
        >
          <Star size={15} fill={fav ? "currentColor" : "none"} />
        </button>
        {ws.canWrite ? (
          <Menu
            trigger={(open) => (
              <button type="button" className="pj-status-btn" onClick={open}>
                <Badge color={PROJECT_STATUS[project.status].color}>{PROJECT_STATUS[project.status].name}</Badge>
                <ChevronDown size={13} className="faint" />
              </button>
            )}
            items={(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({
              label: PROJECT_STATUS[s].name,
              icon: <span style={{ width: 8, height: 8, borderRadius: "50%", background: PROJECT_STATUS[s].color }} />,
              checked: s === project.status,
              onSelect: () => void setStatus(s),
            }))}
          />
        ) : (
          <Badge color={PROJECT_STATUS[project.status].color}>{PROJECT_STATUS[project.status].name}</Badge>
        )}
        {project.archived_at && <Badge color="var(--gray)">Archivé</Badge>}
      </div>
      <div className="pj-head-side">
        {company && (
          <Link href={`${ws.base}/crm/companies/${company.id}`} className="pj-client" title="Fiche client">
            <span className="av" style={{ ["--s" as string]: "18px", ["--c" as string]: company.color, borderRadius: 4 }}>{company.name[0]}</span>
            <span className="trunc">{company.name}</span>
          </Link>
        )}
        {people.length > 0 && <AvatarStack profiles={people} max={5} size={24} />}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard.writeText(`${location.origin}${ws.base}/projects/${project.key}/board`);
            toast("Lien du projet copié");
          }}
        >
          <Link2 size={14} />
          <span className="tv-hide-sm">Partager</span>
        </button>
        {ws.canWrite && (
          <Menu
            align="end"
            trigger={(open) => (
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label="Réglages du projet" title="Réglages du projet">
                <Settings size={15} />
              </button>
            )}
            items={[
              { label: "Modifier le projet", icon: <Pencil size={14} />, onSelect: () => setEdit(true) },
              { label: project.archived_at ? "Restaurer le projet" : "Archiver le projet", icon: project.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />, onSelect: () => void archive() },
              { label: "", separator: true },
              { label: "Supprimer le projet", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDel(true) },
            ]}
          />
        )}
      </div>
      {edit && <ProjectCreateModal project={project} memberIds={memberIds} onClose={() => setEdit(false)} />}
      {del && (
        <ConfirmModal
          title={`Supprimer « ${project.name} » ?`}
          text={`Les ${tasks.length} tâches du projet, leurs commentaires, fichiers et l'activité seront définitivement supprimés. Pour garder l'historique, archive plutôt le projet.`}
          confirmLabel="Supprimer définitivement"
          onConfirm={async () => {
            const ok = await mutate(async (sb) => {
              must(await sb.from("projects").delete().eq("id", project.id));
              return true;
            }, { success: "Projet supprimé", refresh: false });
            if (ok) {
              router.push(`${ws.base}/projects`);
              router.refresh();
            }
          }}
          onClose={() => setDel(false)}
        />
      )}
    </header>
  );
}

function SavedTabs({ project, view, views, current, href }: { project: Project; view: ProjectViewKey; views: SavedView[]; current?: SavedView; href: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const router = useRouter();
  const sp = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [ctx, setCtx] = useState<{ at: { x: number; y: number }; v: SavedView } | null>(null);
  const [rename, setRename] = useState<SavedView | null>(null);
  const isLayout = (LAYOUTS as string[]).includes(view);

  const viewHref = (v: SavedView) => {
    const layout = v.config.layout ?? "list";
    const q = configToQuery(v.config, { group: "status" });
    return `${href}/${layout}?sv=${v.id}${q ? `&${q}` : ""}`;
  };

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    const cur = parseView(sp, { group: "status" });
    const config: ViewConfig = { layout: (isLayout ? view : "list") as ViewConfig["layout"], filters: cur.filters, sort: cur.sort, group: cur.group };
    const row = await mutate(
      async (sb) =>
        must(await sb.from("saved_views").insert({ workspace_id: ws.workspace.id, project_id: project.id, name: n, config: config as unknown as Json }).select("*").single()),
      { success: `Vue « ${n} » enregistrée` },
    );
    setSaving(false);
    setName("");
    if (row) router.push(viewHref({ ...(row as unknown as SavedView), config }));
  };

  return (
    <nav className="tabs pj-tabs" aria-label="Vues du projet">
      {TABS.map((t) => (
        <Link key={t.id} href={`${href}/${t.id}`} className={`tab${view === t.id && !current ? " on" : ""}`} aria-current={view === t.id && !current ? "page" : undefined}>
          {t.icon}
          {t.name}
        </Link>
      ))}
      {views.map((v) => (
        <Link
          key={v.id}
          href={viewHref(v)}
          className={`tab${current?.id === v.id ? " on" : ""}`}
          onContextMenu={(e) => {
            if (!ws.canWrite) return;
            e.preventDefault();
            setCtx({ at: { x: e.clientX, y: e.clientY }, v });
          }}
          title="Clic droit pour renommer ou supprimer"
        >
          <Filter size={14} />
          {v.name}
        </Link>
      ))}
      {ws.canWrite && (
        <button type="button" className="tab" onClick={() => setSaving(true)} aria-label="Enregistrer la vue courante" title="Enregistrer la vue courante (filtres, tri, groupe, disposition)">
          <Plus size={14} />
        </button>
      )}
      {saving && (
        <Modal
          title="Enregistrer la vue"
          onClose={() => setSaving(false)}
          footer={
            <>
              <button className="btn" onClick={() => setSaving(false)}>Annuler</button>
              <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Enregistrer</button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="sv-name">Nom de la vue</label>
            <input id="sv-name" className="input" autoFocus placeholder="Ex. Créas à valider, Urgences de la semaine" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            <span className="hint">La vue garde la disposition ({isLayout ? TABS.find((t) => t.id === view)?.name : "Liste"}), les filtres, le tri et le regroupement actuels. Elle est visible par toute l&apos;équipe.</span>
          </div>
        </Modal>
      )}
      {ctx && (
        <ContextMenu
          at={ctx.at}
          onClose={() => setCtx(null)}
          items={[
            { label: "Renommer", icon: <Pencil size={14} />, onSelect: () => setRename(ctx.v) },
            {
              label: "Supprimer la vue",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => {
                const v = ctx.v;
                void mutate(async (sb) => must(await sb.from("saved_views").delete().eq("id", v.id)), { success: "Vue supprimée" }).then(() => {
                  if (current?.id === v.id) router.push(`${href}/${v.config.layout ?? "list"}`);
                });
              },
            },
          ]}
        />
      )}
      {rename && <RenameModal view={rename} onClose={() => setRename(null)} />}
    </nav>
  );
}

function RenameModal({ view, onClose }: { view: SavedView; onClose: () => void }) {
  const mutate = useMutate();
  const [name, setName] = useState(view.name);
  const submit = async () => {
    if (!name.trim()) return;
    await mutate(async (sb) => must(await sb.from("saved_views").update({ name: name.trim() }).eq("id", view.id)));
    onClose();
  };
  return (
    <Modal
      title="Renommer la vue"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit}>Renommer</button>
        </>
      }
    >
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="Nom de la vue" />
    </Modal>
  );
}
