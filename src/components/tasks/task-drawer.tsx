"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive, ArrowDown, ArrowUp, Calendar, CalendarClock, CircleCheck, CircleDot, Copy, Diamond, Download, Ellipsis, FileText,
  FolderKanban, GitBranch, GripVertical, Link2, Paperclip, Pencil, Plus, Repeat, SignalHigh, Tag, Trash2, Upload, UserRound, X,
} from "lucide-react";

import { AssigneePicker, DatePicker, LabelsPicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { ObjIcon } from "@/components/ui/misc";
import { ConfirmModal, Menu, Popover } from "@/components/ui/overlay";
import { StatusIcon } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { STATUSES } from "@/lib/constants";
import { ago, diffDays, fileSize, fmtDate, parseDay, today } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TASK_SELECT, between, isOverdue, normalizeTask } from "@/lib/tasks";
import type { ActivityItem, Attachment, Comment, Subtask, Task, TaskStatus } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { RECURRENCES, useTaskActions } from "./actions";
import { ActivityFeed } from "./activity-feed";
import { getNavIds } from "./nav";
import { setUrlParams, taskUrl } from "./view-state";

import "@/styles/tasks.css";
import "@/styles/projects.css";

type Lite = Pick<Task, "id" | "number" | "title" | "status" | "project_id">;

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};

/** Monté dans l'AppShell : affiche le tiroir quand l'URL contient ?task=<id>. */
export function TaskDrawerHost() {
  const sp = useSearchParams();
  const id = sp.get("task");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // eslint-disable-line react-hooks/set-state-in-effect
  if (!id || !mounted) return null;
  return <TaskDrawer key={id} id={id} />;
}

const closeDrawer = () => setUrlParams((p) => p.delete("task"));
const goTask = (id: string) => setUrlParams((p) => p.set("task", id));

/**
 * Coque du tiroir. Échap ferme le tiroir, sauf si un menu ou une modale est ouvert,
 * ou si un champ a le focus (Échap le quitte d'abord, ce qui enregistre la saisie).
 */
function Shell({ header, children }: { header: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".pop, .modal, .palette")) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a.closest(".drawer") && ["INPUT", "TEXTAREA"].includes(a.tagName)) {
        a.blur();
        return;
      }
      closeDrawer();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return createPortal(
    <>
      <div className="scrim td-scrim" onClick={closeDrawer} />
      <aside className="drawer td-drawer" role="dialog" aria-modal="false" aria-label="Détail de la tâche">
        <div className="drawer-h">
          {header}
          <button className="btn btn-ghost btn-sm btn-icon" onClick={closeDrawer} aria-label="Fermer (Échap)" title="Fermer (Échap)">
            <X size={15} />
          </button>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// Markdown léger : titres, listes, gras, italique, code, liens.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/[^\s)]+|@[A-ZÀ-Ÿa-zà-ÿ]+(?: [A-ZÀ-Ÿ][a-zà-ÿ]+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("**")) out.push(<b key={k++}>{s.slice(2, -2)}</b>);
    else if (s.startsWith("`")) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (s.startsWith("*")) out.push(<em key={k++}>{s.slice(1, -1)}</em>);
    else if (s.startsWith("@")) out.push(<span key={k++} className="td-mention">{s}</span>);
    else
      out.push(
        <a key={k++} href={s} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
          {s.replace(/^https?:\/\//, "").slice(0, 60)}
        </a>,
      );
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((line, i) => {
    const l = line.trimEnd();
    if (/^\s*[-*] /.test(l)) {
      list.push(<li key={i}>{inline(l.replace(/^\s*[-*] /, ""))}</li>);
      return;
    }
    flush();
    if (/^#{1,3} /.test(l)) blocks.push(<h4 key={i}>{inline(l.replace(/^#{1,3} /, ""))}</h4>);
    else if (l.trim()) blocks.push(<p key={i}>{inline(l)}</p>);
    else blocks.push(<div key={i} style={{ height: 6 }} />);
  });
  flush();
  return <div className="td-md">{blocks}</div>;
}

function Prop({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}

function TaskDrawer({ id }: { id: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [missing, setMissing] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [siblings, setSiblings] = useState<Lite[]>([]);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [del, setDel] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data, error } = await sb.from("tasks").select(TASK_SELECT).eq("id", id).maybeSingle();
    if (error || !data) {
      setMissing(true);
      return;
    }
    const t = normalizeTask(data);
    const [c, a, act, bl, sib] = await Promise.all([
      sb.from("comments").select("*").eq("task_id", id).order("created_at"),
      sb.from("attachments").select("*").eq("task_id", id).order("created_at", { ascending: false }),
      sb.from("activity").select("*").eq("task_id", id).order("created_at", { ascending: false }).limit(60),
      sb.from("task_dependencies").select("task_id").eq("depends_on_id", id),
      sb.from("tasks").select("id, number, title, status, project_id").eq("project_id", t.project_id).is("archived_at", null).order("number"),
    ]);
    setTask(t);
    setComments((c.data ?? []) as Comment[]);
    setFiles((a.data ?? []) as Attachment[]);
    setActs((act.data ?? []) as unknown as ActivityItem[]);
    setBlocks((bl.data ?? []).map((x) => x.task_id));
    setSiblings((sib.data ?? []) as Lite[]);
  }, [id]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  // Historique rechargé après un changement journalisé (statut, responsable, commentaire)
  const stamp = task ? `${task.status}|${task.assignee_id}|${task.comment_count}` : "";
  useEffect(() => {
    if (!stamp) return;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().from("activity").select("*").eq("task_id", id).order("created_at", { ascending: false }).limit(60);
      if (data) setActs(data as unknown as ActivityItem[]);
    }, 600);
    return () => clearTimeout(t);
  }, [stamp, id]);

  const actions = useTaskActions(
    useCallback((fn: (ts: Task[]) => Task[]) => {
      setTask((t) => {
        if (!t) return t;
        const next = fn([t]);
        if (!next.length) setTimeout(closeDrawer, 0);
        return next.find((x) => x.id === t.id) ?? t;
      });
    }, []),
  );

  // Raccourcis : J/K tâche suivante/précédente, 1 à 5 statut
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || document.querySelector(".modal, .palette, .pop")) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        const ids = getNavIds();
        const i = ids.indexOf(id);
        const next = ids[i + (k === "j" ? 1 : -1)];
        if (i >= 0 && next) {
          e.preventDefault();
          goTask(next);
        }
      } else if (/^[1-5]$/.test(k) && task && ws.canWrite) {
        e.preventDefault();
        const s = STATUSES[Number(k) - 1].id;
        if (s !== task.status) void actions.update([task], { status: s }, { toast: `Statut : ${STATUSES[Number(k) - 1].name}` });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [id, task, actions, ws.canWrite]);

  const project = ws.project(task?.project_id);
  const key = task && project ? `${project.key}-${task.number}` : "";
  const nav = getNavIds();
  const pos = nav.indexOf(id);

  const header = (
    <div className="td-head">
      {project ? (
        <Link href={`${ws.base}/projects/${project.key}/board`} className="td-crumb" onClick={closeDrawer}>
          <ObjIcon icon={project.icon} color={project.color} size={18} />
          <span className="trunc">{project.name}</span>
        </Link>
      ) : (
        <span className="sk" style={{ width: 120, height: 14 }} />
      )}
      {key && (
        <>
          <span className="fainter">/</span>
          <span className="mono faint td-key">{key}</span>
        </>
      )}
      <span style={{ flex: 1 }} />
      {pos >= 0 && nav.length > 1 && (
        <span className="td-nav">
          <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={pos <= 0} onClick={() => goTask(nav[pos - 1])} aria-label="Tâche précédente (K)" title="Tâche précédente (K)">
            <ArrowUp size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={pos >= nav.length - 1} onClick={() => goTask(nav[pos + 1])} aria-label="Tâche suivante (J)" title="Tâche suivante (J)">
            <ArrowDown size={14} />
          </button>
        </span>
      )}
      {task && ws.canWrite && (
        <button
          type="button"
          className={`btn btn-sm${task.status === "done" ? " td-done-btn" : " btn-ghost"}`}
          onClick={() => void actions.update([task], { status: task.status === "done" ? "todo" : "done" })}
        >
          <CircleCheck size={14} />
          <span className="tv-hide-sm">{task.status === "done" ? "Terminée" : "Terminer"}</span>
        </button>
      )}
      {task && (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          aria-label="Copier le lien"
          title="Copier le lien"
          onClick={() => {
            navigator.clipboard.writeText(taskUrl(ws.base, project?.key, task.id));
            toast("Lien copié");
          }}
        >
          <Link2 size={14} />
        </button>
      )}
      {task && ws.canWrite && (
        <Menu
          align="end"
          trigger={(open) => (
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label="Plus d'actions">
              <Ellipsis size={15} />
            </button>
          )}
          items={[
            {
              label: "Dupliquer",
              icon: <Copy size={14} />,
              onSelect: () => void actions.duplicate(task).then((c) => c && goTask(c.id)),
            },
            { label: "Archiver", icon: <Archive size={14} />, onSelect: () => void actions.archive([task]).then(closeDrawer) },
            { label: "", separator: true },
            { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDel(true) },
          ]}
        />
      )}
    </div>
  );

  return (
    <Shell header={header}>
      {missing ? (
        <div className="empty">
          <div className="ic"><FileText size={18} /></div>
          <h3>Tâche introuvable</h3>
          <p>Elle a peut-être été supprimée, ou tu n&apos;y as pas accès.</p>
          <button type="button" className="btn" onClick={closeDrawer}>Fermer</button>
        </div>
      ) : !task ? (
        <DrawerSkeleton />
      ) : (
        <TaskBody
          task={task}
          setTask={setTask}
          actions={actions}
          comments={comments}
          setComments={setComments}
          files={files}
          setFiles={setFiles}
          acts={acts}
          blocks={blocks}
          setBlocks={setBlocks}
          siblings={siblings}
          tab={tab}
          setTab={setTab}
          reload={load}
          mutate={mutate}
        />
      )}
      {del && task && (
        <ConfirmModal
          title="Supprimer la tâche ?"
          text={`« ${task.title} » sera définitivement supprimée, avec ses sous-tâches, commentaires et pièces jointes. Pour la garder de côté, archive-la plutôt.`}
          onConfirm={async () => {
            await actions.remove([task]);
            closeDrawer();
          }}
          onClose={() => setDel(false)}
        />
      )}
    </Shell>
  );
}

function DrawerSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-busy="true">
      <span className="sk" style={{ width: "70%", height: 26 }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="sk" style={{ width: `${40 + i * 8}%`, height: 16 }} />
      ))}
      <span className="sk" style={{ width: "100%", height: 90, marginTop: 10 }} />
    </div>
  );
}

interface BodyProps {
  task: Task;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
  actions: ReturnType<typeof useTaskActions>;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  files: Attachment[];
  setFiles: React.Dispatch<React.SetStateAction<Attachment[]>>;
  acts: ActivityItem[];
  blocks: string[];
  setBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  siblings: Lite[];
  tab: "comments" | "activity";
  setTab: (t: "comments" | "activity") => void;
  reload: () => Promise<void>;
  mutate: ReturnType<typeof useMutate>;
}

function TaskBody(props: BodyProps) {
  const { task, actions } = props;
  const ws = useWorkspace();
  const ro = !ws.canWrite;
  const [title, setTitle] = useState(task.title);
  const [srcTitle, setSrcTitle] = useState(task.title);
  if (srcTitle !== task.title) {
    setSrcTitle(task.title);
    setTitle(task.title);
  }
  const up = (patch: Parameters<typeof actions.update>[1]) => void actions.update([task], patch);
  const over = isOverdue(task);
  const late = over ? -diffDays(parseDay(task.due_date)!, today()) : 0;
  const creator = ws.member(task.created_by);

  return (
    <div className="td">
      {task.status === "done" ? (
        <div className="td-alert ok">
          <CircleCheck size={15} />
          <span>
            Terminée {task.completed_at ? ago(task.completed_at) : ""}.
            {!ro && (
              <button type="button" className="td-link" onClick={() => up({ status: "todo" })}>
                Rouvrir la tâche
              </button>
            )}
          </span>
        </div>
      ) : over ? (
        <div className="td-alert danger">
          <CalendarClock size={15} />
          <span>En retard de {late} jour{late > 1 ? "s" : ""}.</span>
        </div>
      ) : null}

      <textarea
        className="td-title"
        rows={1}
        value={title}
        readOnly={ro}
        aria-label="Titre de la tâche"
        ref={autosize}
        onChange={(e) => {
          setTitle(e.target.value);
          autosize(e.currentTarget);
        }}
        onBlur={() => {
          const v = title.trim();
          if (!v) setTitle(task.title);
          else if (v !== task.title) up({ title: v });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />

      <dl className="td-props">
        <Prop icon={<CircleDot size={14} />} label="Statut">
          {ro ? <span className="pill"><StatusIcon status={task.status} /></span> : <StatusPicker value={task.status} onChange={(status) => up({ status })} />}
        </Prop>
        <Prop icon={<SignalHigh size={14} />} label="Priorité">
          {ro ? null : <PriorityPicker value={task.priority} onChange={(priority) => up({ priority })} />}
        </Prop>
        <Prop icon={<UserRound size={14} />} label="Responsable">
          {ro ? <span className="pill">{ws.member(task.assignee_id)?.profile.full_name ?? "Non assigné"}</span> : <AssigneePicker value={task.assignee_id} onChange={(assignee_id) => up({ assignee_id })} />}
        </Prop>
        <Prop icon={<Tag size={14} />} label="Étiquettes">
          {ro ? null : <LabelsPicker value={task.label_ids} onChange={(ids) => void actions.setLabels(task, ids)} />}
        </Prop>
        <Prop icon={<Calendar size={14} />} label="Début">
          {ro ? <span className="pill">{fmtDate(task.start_date) || "Aucun"}</span> : <DatePicker value={task.start_date} placeholder="Date de début" onChange={(start_date) => up({ start_date })} />}
        </Prop>
        <Prop icon={<Calendar size={14} />} label="Échéance">
          {ro ? <span className="pill">{fmtDate(task.due_date) || "Aucune"}</span> : <DatePicker value={task.due_date} overdue={over} onChange={(due_date) => up({ due_date })} />}
        </Prop>
        <Prop icon={<Diamond size={14} />} label="Jalon">
          <label className="td-toggle">
            <input type="checkbox" className="toggle" disabled={ro} checked={task.milestone} onChange={(e) => up({ milestone: e.target.checked })} />
            <span className="faint">{task.milestone ? "Étape clé du projet" : "Non"}</span>
          </label>
        </Prop>
        <Prop icon={<Repeat size={14} />} label="Récurrence">
          {ro ? (
            <span className="pill">{RECURRENCES.find((r) => r.id === task.recurrence)?.name ?? "Aucune"}</span>
          ) : (
            <Menu
              trigger={(open) => (
                <button type="button" className={`pill${task.recurrence ? "" : " empty"}`} onClick={open}>
                  <Repeat size={14} />
                  <span>{RECURRENCES.find((r) => r.id === task.recurrence)?.name ?? "Ne se répète pas"}</span>
                </button>
              )}
              items={[
                { label: "Ne se répète pas", checked: !task.recurrence, onSelect: () => up({ recurrence: null }) },
                ...RECURRENCES.map((r) => ({ label: r.name, checked: task.recurrence === r.id, onSelect: () => up({ recurrence: r.id }) })),
              ]}
            />
          )}
        </Prop>
        <Prop icon={<FolderKanban size={14} />} label="Projet">
          <span className="pill" style={{ cursor: "default" }}>{ws.project(task.project_id)?.name}</span>
        </Prop>
      </dl>
      {task.recurrence && <p className="faint td-note">À la fin de cette tâche, la prochaine occurrence sera créée automatiquement.</p>}

      <Description task={task} ro={ro} onSave={(description) => up({ description })} />
      <Subtasks {...props} ro={ro} />
      <Dependencies {...props} ro={ro} />
      <Files {...props} ro={ro} />

      <section className="td-sec">
        <div className="tabs td-tabs">
          <button type="button" className={`tab${props.tab === "comments" ? " on" : ""}`} onClick={() => props.setTab("comments")}>
            Commentaires <span className="count">{props.comments.length}</span>
          </button>
          <button type="button" className={`tab${props.tab === "activity" ? " on" : ""}`} onClick={() => props.setTab("activity")}>
            Historique <span className="count">{props.acts.length}</span>
          </button>
        </div>
        {props.tab === "comments" ? <Comments {...props} ro={ro} /> : <ActivityFeed items={props.acts} inTask empty="Aucun changement enregistré." />}
      </section>
      <p className="fainter td-created">
        Créée {creator ? `par ${creator.profile.full_name} ` : ""}le {fmtDate(task.created_at.slice(0, 10), true)} · mise à jour {ago(task.updated_at)}
      </p>
    </div>
  );
}

function Description({ task, ro, onSave }: { task: Task; ro: boolean; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(task.description);
  const [src, setSrc] = useState(task.description);
  if (src !== task.description) {
    setSrc(task.description);
    if (!edit) setV(task.description);
  }
  return (
    <section className="td-sec">
      <div className="td-sec-h">
        <h3>Description</h3>
        {!ro && !edit && task.description && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>
            <Pencil size={13} />
            Modifier
          </button>
        )}
      </div>
      {edit || (!task.description && !ro) ? (
        <textarea
          className="td-desc"
          autoFocus={edit}
          value={v}
          readOnly={ro}
          placeholder="Ajoute le brief, le contexte client, les liens utiles… (**gras**, *italique*, listes avec « - »)"
          ref={autosize}
          onChange={(e) => {
            setV(e.target.value);
            autosize(e.currentTarget);
          }}
          onFocus={() => setEdit(true)}
          onBlur={() => {
            setEdit(false);
            if (v !== task.description) onSave(v);
          }}
          aria-label="Description"
        />
      ) : task.description ? (
        <div className="td-desc-view" onDoubleClick={() => !ro && setEdit(true)} title={ro ? undefined : "Double-clique pour modifier"}>
          <Markdown text={task.description} />
        </div>
      ) : (
        <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>Pas de description.</p>
      )}
    </section>
  );
}

function Subtasks({ task, setTask, mutate, ro }: BodyProps & { ro: boolean }) {
  const [title, setTitle] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const subs = task.subtasks;
  const done = subs.filter((s) => s.done).length;
  const setSubs = (fn: (s: Subtask[]) => Subtask[]) => setTask((t) => (t ? { ...t, subtasks: fn(t.subtasks) } : t));

  const add = async () => {
    const v = title.trim();
    if (!v) return;
    setTitle("");
    const position = (subs[subs.length - 1]?.position ?? 0) + 1000;
    const row = await mutate(async (sb) => must(await sb.from("subtasks").insert({ task_id: task.id, title: v, position }).select("*").single()));
    if (row) setSubs((s) => [...s, row as Subtask]);
  };
  const patch = (s: Subtask, p: Partial<Subtask>) => {
    setSubs((l) => l.map((x) => (x.id === s.id ? { ...x, ...p } : x)));
    void mutate(async (sb) => must(await sb.from("subtasks").update(p).eq("id", s.id)));
  };
  const remove = (s: Subtask) => {
    setSubs((l) => l.filter((x) => x.id !== s.id));
    void mutate(async (sb) => must(await sb.from("subtasks").delete().eq("id", s.id)));
  };
  const move = (s: Subtask, to: number) => {
    const rest = subs.filter((x) => x.id !== s.id);
    const idx = Math.max(0, Math.min(rest.length, to));
    const position = between(rest[idx - 1]?.position, rest[idx]?.position);
    const next = [...rest.slice(0, idx), { ...s, position }, ...rest.slice(idx)];
    setSubs(() => next);
    void mutate(async (sb) => must(await sb.from("subtasks").update({ position }).eq("id", s.id)));
  };

  return (
    <section className="td-sec">
      <div className="td-sec-h">
        <h3>Sous-tâches</h3>
        {subs.length > 0 && (
          <>
            <span className="count num">{done}/{subs.length}</span>
            <span className="tk-subbar" style={{ width: 90 }}>
              <i style={{ width: `${(done / subs.length) * 100}%`, background: done === subs.length ? "var(--green)" : undefined }} />
            </span>
          </>
        )}
      </div>
      <ul className="td-subs">
        {subs.map((s, i) => (
          <li
            key={s.id}
            className={`td-sub${s.done ? " done" : ""}${drag === s.id ? " dragging" : ""}`}
            draggable={!ro}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDrag(s.id);
            }}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => drag && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const d = subs.find((x) => x.id === drag);
              if (d && d.id !== s.id) move(d, subs.filter((x) => x.id !== d.id).findIndex((x) => x.id === s.id) + (subs.indexOf(d) < i ? 1 : 0));
              setDrag(null);
            }}
          >
            {!ro && <GripVertical size={13} className="td-grip" aria-hidden />}
            <input type="checkbox" className="check" checked={s.done} disabled={ro} onChange={(e) => patch(s, { done: e.target.checked })} aria-label={`Terminer ${s.title}`} />
            <SubTitle s={s} ro={ro} onSave={(t) => patch(s, { title: t })} onMove={(d) => move(s, i + d)} />
            {!ro && (
              <button type="button" className="btn btn-ghost btn-sm btn-icon td-sub-x" aria-label="Supprimer la sous-tâche" onClick={() => remove(s)}>
                <X size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!ro && (
        <div className="td-sub-add">
          <Plus size={14} />
          <input
            placeholder="Ajouter une sous-tâche"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            aria-label="Ajouter une sous-tâche"
          />
        </div>
      )}
    </section>
  );
}

function SubTitle({ s, ro, onSave, onMove }: { s: Subtask; ro: boolean; onSave: (t: string) => void; onMove: (d: number) => void }) {
  const [v, setV] = useState(s.title);
  return (
    <input
      className="td-sub-t"
      value={v}
      readOnly={ro}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (!t) setV(s.title);
        else if (t !== s.title) onSave(t);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onMove(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      aria-label="Titre de la sous-tâche (Alt + flèches pour déplacer)"
    />
  );
}

function DepChip({ t, onRemove, ro }: { t: Lite; onRemove: () => void; ro: boolean }) {
  const ws = useWorkspace();
  return (
    <span className="td-dep">
      <button type="button" className="td-dep-b" onClick={() => goTask(t.id)}>
        <StatusIcon status={t.status as TaskStatus} size={13} />
        <span className="mono faint">{ws.project(t.project_id)?.key}-{t.number}</span>
        <span className="trunc">{t.title}</span>
      </button>
      {!ro && (
        <button type="button" className="td-dep-x" aria-label="Retirer la dépendance" onClick={onRemove}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}

function DepPicker({ exclude, siblings, onPick, label }: { exclude: string[]; siblings: Lite[]; onPick: (id: string) => void; label: string }) {
  const [q, setQ] = useState("");
  const shown = siblings.filter((s) => !exclude.includes(s.id) && (!q || s.title.toLowerCase().includes(q.toLowerCase()) || String(s.number).includes(q))).slice(0, 30);
  const ws = useWorkspace();
  return (
    <Popover
      width={320}
      trigger={(open) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={open}>
          <Plus size={13} />
          {label}
        </button>
      )}
    >
      {(close) => (
        <div>
          <input autoFocus className="pop-search" placeholder="Rechercher une tâche du projet…" value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.map((s) => (
            <button key={s.id} type="button" className="mi" onClick={() => { onPick(s.id); close(); }}>
              <StatusIcon status={s.status as TaskStatus} />
              <span className="mono faint" style={{ fontSize: 11 }}>{ws.project(s.project_id)?.key}-{s.number}</span>
              <span className="trunc">{s.title}</span>
            </button>
          ))}
          {!shown.length && <div className="mi faint">Aucune tâche</div>}
        </div>
      )}
    </Popover>
  );
}

function Dependencies({ task, setTask, blocks, setBlocks, siblings, mutate, ro }: BodyProps & { ro: boolean }) {
  const byId = new Map(siblings.map((s) => [s.id, s]));
  const blockedBy = task.depends_on.map((d) => byId.get(d)).filter(Boolean) as Lite[];
  const blocking = blocks.map((d) => byId.get(d)).filter(Boolean) as Lite[];
  const open = blockedBy.filter((t) => t.status !== "done").length;
  const exclude = [task.id, ...task.depends_on, ...blocks];

  const addBlockedBy = (other: string) => {
    setTask((t) => (t ? { ...t, depends_on: [...t.depends_on, other] } : t));
    void mutate(async (sb) => must(await sb.from("task_dependencies").insert({ task_id: task.id, depends_on_id: other })));
  };
  const addBlocks = (other: string) => {
    setBlocks((b) => [...b, other]);
    void mutate(async (sb) => must(await sb.from("task_dependencies").insert({ task_id: other, depends_on_id: task.id })));
  };
  const rmBlockedBy = (other: string) => {
    setTask((t) => (t ? { ...t, depends_on: t.depends_on.filter((x) => x !== other) } : t));
    void mutate(async (sb) => must(await sb.from("task_dependencies").delete().eq("task_id", task.id).eq("depends_on_id", other)));
  };
  const rmBlocks = (other: string) => {
    setBlocks((b) => b.filter((x) => x !== other));
    void mutate(async (sb) => must(await sb.from("task_dependencies").delete().eq("task_id", other).eq("depends_on_id", task.id)));
  };

  if (ro && !blockedBy.length && !blocking.length) return null;
  return (
    <section className="td-sec">
      <div className="td-sec-h">
        <h3>Dépendances</h3>
        {open > 0 && task.status !== "done" && <span className="td-blocked"><GitBranch size={12} /> Bloquée par {open} tâche{open > 1 ? "s" : ""}</span>}
      </div>
      <div className="td-deps">
        <div className="td-dep-row">
          <span className="td-dep-l">Bloquée par</span>
          <div className="td-dep-list">
            {blockedBy.map((t) => (
              <DepChip key={t.id} t={t} ro={ro} onRemove={() => rmBlockedBy(t.id)} />
            ))}
            {!ro && <DepPicker label="Ajouter" exclude={exclude} siblings={siblings} onPick={addBlockedBy} />}
            {ro && !blockedBy.length && <span className="faint">Aucune</span>}
          </div>
        </div>
        <div className="td-dep-row">
          <span className="td-dep-l">Bloque</span>
          <div className="td-dep-list">
            {blocking.map((t) => (
              <DepChip key={t.id} t={t} ro={ro} onRemove={() => rmBlocks(t.id)} />
            ))}
            {!ro && <DepPicker label="Ajouter" exclude={exclude} siblings={siblings} onPick={addBlocks} />}
            {ro && !blocking.length && <span className="faint">Aucune</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Files({ task, files, setFiles, setTask, mutate, ro }: BodyProps & { ro: boolean }) {
  const ws = useWorkspace();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  const upload = async (list: FileList | File[]) => {
    const arr = [...list];
    if (!arr.length) return;
    setUploading(arr.map((f) => f.name));
    const sb = supabaseBrowser();
    const added: Attachment[] = [];
    for (const f of arr) {
      if (f.size > 50 * 1048576) {
        toast(`${f.name} dépasse 50 Mo`, { error: true });
        continue;
      }
      const safe = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
      const path = `${ws.workspace.id}/${task.project_id}/${task.id}/${Date.now()}-${safe}`;
      const upRes = await sb.storage.from("attachments").upload(path, f, { contentType: f.type || undefined });
      if (upRes.error) {
        toast(`Envoi impossible : ${upRes.error.message}`, { error: true });
        continue;
      }
      const row = await mutate(
        async (s) =>
          must(
            await s
              .from("attachments")
              .insert({ workspace_id: ws.workspace.id, project_id: task.project_id, task_id: task.id, name: f.name, path, size: f.size, mime: f.type })
              .select("*")
              .single(),
          ),
        { refresh: false },
      );
      if (row) added.push(row as Attachment);
    }
    setUploading([]);
    if (added.length) {
      setFiles((l) => [...added, ...l]);
      setTask((t) => (t ? { ...t, attachment_count: t.attachment_count + added.length } : t));
      await mutate(async () => undefined, { success: added.length > 1 ? `${added.length} fichiers ajoutés` : "Fichier ajouté" });
    }
  };

  const openFile = async (a: Attachment, download = false) => {
    const { data, error } = await supabaseBrowser().storage.from("attachments").createSignedUrl(a.path, 300, download ? { download: a.name } : undefined);
    if (error || !data) return toast("Fichier indisponible", { error: true });
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = (a: Attachment) => {
    setFiles((l) => l.filter((x) => x.id !== a.id));
    setTask((t) => (t ? { ...t, attachment_count: Math.max(0, t.attachment_count - 1) } : t));
    void mutate(
      async (sb) => {
        await sb.storage.from("attachments").remove([a.path]);
        must(await sb.from("attachments").delete().eq("id", a.id));
      },
      { success: "Fichier supprimé" },
    );
  };

  return (
    <section
      className={`td-sec${over ? " td-drop" : ""}`}
      onDragOver={(e) => {
        if (ro || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        if (ro || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="td-sec-h">
        <h3>Pièces jointes</h3>
        {files.length > 0 && <span className="count num">{files.length}</span>}
        {!ro && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => input.current?.click()}>
            <Upload size={13} />
            Ajouter
          </button>
        )}
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />
      </div>
      {uploading.map((n) => (
        <div key={n} className="td-file uploading">
          <Paperclip size={14} />
          <span className="trunc">{n}</span>
          <span className="sk" style={{ width: 60, height: 6, marginLeft: "auto" }} />
        </div>
      ))}
      {files.map((a) => {
        const who = ws.member(a.uploaded_by);
        const img = a.mime.startsWith("image/");
        return (
          <div key={a.id} className="td-file">
            <span className="td-file-ic" data-kind={img ? "img" : a.mime.includes("pdf") ? "pdf" : "doc"}>
              <FileText size={14} />
            </span>
            <button type="button" className="td-file-name trunc" onClick={() => void openFile(a)} title="Ouvrir">
              {a.name}
            </button>
            <span className="faint td-file-meta">
              {fileSize(a.size)}
              {who ? ` · ${who.profile.full_name.split(" ")[0]}` : ""} · {ago(a.created_at)}
            </span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Télécharger" onClick={() => void openFile(a, true)}>
              <Download size={13} />
            </button>
            {!ro && (
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Supprimer le fichier" onClick={() => remove(a)}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}
      {!files.length && !uploading.length && !ro && (
        <button type="button" className="td-dropzone" onClick={() => input.current?.click()}>
          <Upload size={14} />
          Glisse des fichiers ici (créas, briefs, exports) ou clique pour choisir
        </button>
      )}
      {!files.length && ro && <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>Aucune pièce jointe.</p>}
    </section>
  );
}

function Comments({ task, comments, setComments, setTask, mutate, ro }: BodyProps & { ro: boolean }) {
  const ws = useWorkspace();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const post = async () => {
    const v = body.trim();
    if (!v || busy) return;
    setBusy(true);
    const row = await mutate(async (sb) => {
      const c = must(await sb.from("comments").insert({ workspace_id: ws.workspace.id, task_id: task.id, body: v }).select("*").single());
      await sb.from("activity").insert({
        workspace_id: ws.workspace.id, project_id: task.project_id, task_id: task.id, verb: "task.commented",
        meta: { title: task.title, key: `${ws.project(task.project_id)?.key}-${task.number}`, excerpt: v.slice(0, 140) },
      });
      return c;
    });
    setBusy(false);
    if (row) {
      setComments((l) => [...l, row as Comment]);
      setTask((t) => (t ? { ...t, comment_count: t.comment_count + 1 } : t));
      setBody("");
      if (ta.current) ta.current.style.height = "";
    }
  };
  const save = async (c: Comment) => {
    const v = draft.trim();
    if (!v) return;
    const edited_at = new Date().toISOString();
    setComments((l) => l.map((x) => (x.id === c.id ? { ...x, body: v, edited_at } : x)));
    setEditing(null);
    await mutate(async (sb) => must(await sb.from("comments").update({ body: v, edited_at }).eq("id", c.id)));
  };
  const remove = (c: Comment) => {
    setComments((l) => l.filter((x) => x.id !== c.id));
    setTask((t) => (t ? { ...t, comment_count: Math.max(0, t.comment_count - 1) } : t));
    void mutate(async (sb) => must(await sb.from("comments").delete().eq("id", c.id)), { success: "Commentaire supprimé" });
  };

  const candidates = mention !== null ? ws.members.filter((m) => m.profile.full_name.toLowerCase().split(" ").some((w) => w.startsWith(mention.toLowerCase()))).slice(0, 5) : [];
  const insertMention = (name: string) => {
    setBody((b) => b.replace(/@([\wÀ-ÿ]*)$/, `@${name} `));
    setMention(null);
    ta.current?.focus();
  };

  return (
    <div className="td-comments">
      {!comments.length && <p className="faint" style={{ fontSize: "var(--fs-sm)", margin: "8px 0 4px" }}>Aucun commentaire. Lance la discussion avec l&apos;équipe.</p>}
      {comments.map((c) => {
        const who = ws.member(c.author_id);
        const mine = c.author_id === ws.me.id;
        return (
          <div key={c.id} className="td-cmt">
            <Avatar profile={who?.profile ?? null} size={26} />
            <div className="td-cmt-b">
              <div className="td-cmt-h">
                <b>{who?.profile.full_name ?? "Ancien membre"}</b>
                <time className="faint" dateTime={c.created_at}>{ago(c.created_at)}</time>
                {c.edited_at && <span className="fainter">(modifié)</span>}
                {mine && !ro && editing !== c.id && (
                  <span className="td-cmt-acts">
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Modifier le commentaire" onClick={() => { setEditing(c.id); setDraft(c.body); }}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Supprimer le commentaire" onClick={() => remove(c)}>
                      <Trash2 size={12} />
                    </button>
                  </span>
                )}
              </div>
              {editing === c.id ? (
                <div className="td-cbox">
                  <textarea
                    autoFocus
                    value={draft}
                    ref={autosize}
                    onChange={(e) => { setDraft(e.target.value); autosize(e.currentTarget); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(c);
                      if (e.key === "Escape") { e.stopPropagation(); setEditing(null); }
                    }}
                    aria-label="Modifier le commentaire"
                  />
                  <div className="td-cbox-f">
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Annuler</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void save(c)}>Enregistrer</button>
                  </div>
                </div>
              ) : (
                <div className="td-cmt-text">
                  {c.body.split("\n").map((l, i) => (
                    <Fragment key={i}>
                      {i > 0 && <br />}
                      {inline(l)}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!ro && (
        <div className="td-cmt td-compose">
          <Avatar profile={ws.me} size={26} />
          <div className="td-cbox" style={{ position: "relative" }}>
            <textarea
              ref={ta}
              rows={2}
              placeholder="Écris un commentaire… (@ pour mentionner)"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                autosize(e.currentTarget);
                const m = /@([\wÀ-ÿ]*)$/.exec(e.target.value.slice(0, e.target.selectionStart));
                setMention(m ? m[1] : null);
              }}
              onKeyDown={(e) => {
                if (candidates.length && (e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  insertMention(candidates[0].profile.full_name);
                  return;
                }
                if (e.key === "Escape" && mention !== null) {
                  e.stopPropagation();
                  setMention(null);
                  return;
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void post();
                }
              }}
              aria-label="Nouveau commentaire"
            />
            {candidates.length > 0 && (
              <div className="pop td-mentions" role="listbox">
                {candidates.map((m) => (
                  <button key={m.user_id} type="button" className="mi" onMouseDown={(e) => { e.preventDefault(); insertMention(m.profile.full_name); }}>
                    <Avatar profile={m.profile} size={18} title={false} />
                    {m.profile.full_name}
                  </button>
                ))}
              </div>
            )}
            <div className="td-cbox-f">
              <span className="faint" style={{ fontSize: 11 }}>⌘ + Entrée pour envoyer</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={!body.trim() || busy} onClick={() => void post()}>
                Commenter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
