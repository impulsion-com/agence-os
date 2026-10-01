"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, CircleCheck, CircleHelp, Download, Flag, ListChecks, MessageSquare, Paperclip, PenLine, Send, UserRound } from "lucide-react";

import { KINDS, kindOf } from "@/components/projects/files-types";
import { Avatar } from "@/components/ui/avatar";
import { LabelChip } from "@/components/ui/misc";
import { Drawer } from "@/components/ui/overlay";
import { StatusIcon } from "@/components/ui/status";
import { STATUS } from "@/lib/constants";
import { ago, fileSize } from "@/lib/format";
import type { PortalTaskDetail, PortalTaskItem, PortalTasks } from "@/lib/portal/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TaskStatus } from "@/lib/types";
import { usePortal, usePortalAction, useUrlParam } from "./context";
import { Due, Empty, PortalText, PreviewLock, useIsClient } from "./bits";

// « Validation client » en tête : c'est ce qui attend une action du client
const ORDER: TaskStatus[] = ["review", "progress", "todo", "backlog", "done"];
const HINT: Partial<Record<TaskStatus, string>> = {
  review: "en attente de votre retour",
  backlog: "à planifier",
};

/** Avancement du projet : tâches partagées par l'agence, groupées par statut. */
export function TasksView({ data }: { data: PortalTasks }) {
  const { ctx } = usePortal();
  const [open, setOpen] = useUrlParam("task");
  const client = useIsClient(); // le tiroir se rend dans <body> : jamais côté serveur
  const [project, setProject] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const tasks = project ? data.tasks.filter((t) => t.project_id === project) : data.tasks;
  const done = data.tasks.filter((t) => t.status === "done").length;
  const pct = data.tasks.length ? Math.round((done / data.tasks.length) * 100) : 0;

  return (
    <>
      <div className="ptl-ph">
        <div>
          <h1>Projet</h1>
          <p>
            {data.tasks.length
              ? `L'avancement des travaux menés par ${ctx.workspace.name} : ${done} tâche${done > 1 ? "s" : ""} terminée${done > 1 ? "s" : ""} sur ${data.tasks.length} (${pct} %).`
              : `L'avancement des travaux menés par ${ctx.workspace.name}.`}
          </p>
        </div>
      </div>

      {data.projects.length > 1 && (
        <div className="ptl-chips" role="group" aria-label="Filtrer par projet">
          <button type="button" className={`ptl-chipbtn${project === null ? " on" : ""}`} onClick={() => setProject(null)}>
            Tous les projets
          </button>
          {data.projects.map((p) => (
            <button key={p.id} type="button" className={`ptl-chipbtn${project === p.id ? " on" : ""}`} onClick={() => setProject(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="card">
          <Empty icon={<ListChecks size={18} />} title="Aucune tâche partagée pour le moment">
            Dès que {ctx.workspace.name} partage une tâche avec vous, elle apparaît ici avec son avancement.
          </Empty>
        </div>
      ) : (
        ORDER.map((s) => {
          const list = tasks.filter((t) => t.status === s);
          if (!list.length) return null;
          const shut = s === "done" && !showDone;
          return (
            <section key={s} className={`ptl-group ${s}${shut ? " shut" : ""}`}>
              {s === "done" ? (
                <button type="button" className="h" onClick={() => setShowDone((v) => !v)} aria-expanded={!shut}>
                  <StatusIcon status={s} size={15} />
                  {STATUS[s].name}
                  <span className="count">{list.length}</span>
                  <ChevronDown size={15} className="chev" />
                </button>
              ) : (
                <div className="h">
                  <StatusIcon status={s} size={15} />
                  {STATUS[s].name}
                  <span className="count">{list.length}</span>
                  {HINT[s] && <span className="hint">{HINT[s]}</span>}
                </div>
              )}
              {!shut && (
                <div className="ptl-rows">
                  {list.map((t) => (
                    <TaskRow key={t.id} t={t} onOpen={() => setOpen(t.id)} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {open && client && <TaskPanel key={open} id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function TaskRow({ t, onOpen }: { t: PortalTaskItem; onOpen: () => void }) {
  return (
    <button type="button" className={`ptl-row ptl-task ${t.status}`} onClick={onOpen}>
      <StatusIcon status={t.status} size={17} />
      <span className="tx">
        <span className="t">
          {t.milestone && <Flag size={13} style={{ display: "inline", verticalAlign: "-1px", marginRight: 5, color: "var(--accent)" }} aria-label="Jalon" />}
          {t.title}
        </span>
        <span className="s">
          <Due date={t.due_date} done={t.status === "done"} />
          {t.labels.map((l) => (
            <LabelChip key={l.name} name={l.name} color={l.color} />
          ))}
          {t.subtasks > 0 && (
            <span title="Étapes terminées">
              <Check size={12} />
              {t.subtasks_done}/{t.subtasks}
            </span>
          )}
          {t.comments > 0 && (
            <span title="Messages">
              <MessageSquare size={12} />
              {t.comments}
            </span>
          )}
          {t.files > 0 && (
            <span title="Fichiers">
              <Paperclip size={12} />
              {t.files}
            </span>
          )}
        </span>
      </span>
      {t.assignee && (
        <span className="who" title={`Suivi par ${t.assignee}`}>
          <UserRound size={13} />
          <span>{t.assignee}</span>
        </span>
      )}
    </button>
  );
}

/** Fiche d'une tâche : description, étapes, fichiers partagés, fil de discussion et validation. */
function TaskPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { companyId, preview, file } = usePortal();
  const act = usePortalAction();
  const [task, setTask] = useState<PortalTaskDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [reply, setReply] = useState("");
  const [asking, setAsking] = useState(false);
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("portal_task", { p_company: companyId, p_task: id });
    if (error || !data) setMissing(true);
    else setTask(data as unknown as PortalTaskDetail);
  }, [companyId, id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement de la fiche à l'ouverture du tiroir
    void load();
  }, [load]);

  const review = async (approve: boolean) => {
    if (!approve && !changes.trim()) return;
    setBusy(true);
    const ok = await act(
      (sb) => sb.rpc("portal_task_review", { p_company: companyId, p_task: id, p_approve: approve, p_comment: approve ? "" : changes }),
      approve ? "Tâche validée, merci !" : "Votre demande a été transmise à l'agence",
    );
    setBusy(false);
    if (ok) {
      setAsking(false);
      setChanges("");
      await load();
    }
  };

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    const ok = await act((sb) => sb.rpc("portal_task_comment", { p_company: companyId, p_task: id, p_body: reply }), "Message envoyé");
    setBusy(false);
    if (ok) {
      setReply("");
      await load();
    }
  };

  return (
    <Drawer
      onClose={onClose}
      header={
        <span className="ptl-d-head">
          {task ? (
            <>
              <StatusIcon status={task.status} size={15} />
              <span style={{ fontWeight: 500, color: "var(--text)" }}>{STATUS[task.status].name}</span>
              <span className="mono faint">{task.ref}</span>
            </>
          ) : (
            "Tâche"
          )}
        </span>
      }
    >
      {missing ? (
        <Empty icon={<CircleHelp size={18} />} title="Tâche introuvable">
          Cette tâche n&apos;est plus partagée avec vous, ou elle a été supprimée.
        </Empty>
      ) : !task ? (
        <div className="ptl-skel" aria-busy>
          <span className="sk" style={{ width: "70%", height: 24 }} />
          <span className="sk" style={{ width: "40%" }} />
          <span className="sk" style={{ width: "100%", height: 80 }} />
          <span className="sk" style={{ width: "90%" }} />
        </div>
      ) : (
        <div className="ptl-d">
          <h2>{task.title}</h2>
          <div className="sub">
            <span>{task.project.name}</span>
            <Due date={task.due_date} done={task.status === "done"} />
            {task.assignee && (
              <span>
                <UserRound size={12} /> Suivi par {task.assignee}
              </span>
            )}
            {task.labels.map((l) => (
              <LabelChip key={l.name} name={l.name} color={l.color} />
            ))}
          </div>

          {task.status === "review" && (
            <div className="ptl-callout">
              <div className="q">
                <PenLine size={16} /> Cette tâche attend votre validation
              </div>
              <div className="hint">Validez si tout vous convient, ou précisez ce que vous souhaitez voir modifié.</div>
              {asking && (
                <textarea
                  className="textarea"
                  autoFocus
                  rows={4}
                  placeholder="Décrivez les modifications souhaitées…"
                  value={changes}
                  maxLength={4000}
                  onChange={(e) => setChanges(e.target.value)}
                  aria-label="Modifications souhaitées"
                />
              )}
              <div className="acts">
                {asking ? (
                  <>
                    <button className="btn btn-primary" disabled={busy || preview || !changes.trim()} onClick={() => void review(false)}>
                      <Send size={14} /> Envoyer la demande
                    </button>
                    <button className="btn" disabled={busy} onClick={() => setAsking(false)}>
                      Annuler
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn ptl-btn-ok" disabled={busy || preview} onClick={() => void review(true)} title={preview ? "Désactivé en aperçu" : undefined}>
                      <CircleCheck size={15} /> Valider
                    </button>
                    <button className="btn" disabled={busy || preview} onClick={() => setAsking(true)} title={preview ? "Désactivé en aperçu" : undefined}>
                      <PenLine size={14} /> Demander des modifications
                    </button>
                  </>
                )}
              </div>
              {preview && (
                <div style={{ marginTop: 10 }}>
                  <PreviewLock>Aperçu : seul le client peut valider ou demander des modifications.</PreviewLock>
                </div>
              )}
            </div>
          )}
          {task.status === "done" && (
            <div className="ptl-callout ok">
              <div className="q">
                <CircleCheck size={16} /> Tâche terminée{task.completed_at ? <span suppressHydrationWarning> {ago(task.completed_at)}</span> : null}
              </div>
            </div>
          )}

          {task.description.trim() && (
            <>
              <h3>Description</h3>
              <PortalText text={task.description} />
            </>
          )}

          {task.subtasks.length > 0 && (
            <>
              <h3>
                Étapes
                <span className="count" style={{ background: "var(--surface-3)" }}>
                  {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
                </span>
              </h3>
              <ul className="ptl-subs">
                {task.subtasks.map((s, i) => (
                  <li key={i} className={s.done ? "on" : ""}>
                    <span className="bx" aria-hidden>{s.done && <Check size={11} strokeWidth={3} />}</span>
                    <span>
                      {s.title}
                      <span className="sr">{s.done ? " (terminée)" : " (à faire)"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {task.files.length > 0 && (
            <>
              <h3>Fichiers</h3>
              <div className="ptl-flist">
                {task.files.map((f) => {
                  const k = KINDS[kindOf(f.name, f.mime)];
                  return (
                    <a key={f.id} className="ptl-fline" href={file("task", f.id, { task: task.id })} target="_blank" rel="noopener">
                      <span className="ptl-fic" style={{ ["--c" as string]: k.color }}>
                        <k.icon size={15} />
                      </span>
                      <span className="nm">{f.name}</span>
                      <span className="sz">{fileSize(f.size)}</span>
                      <Download size={14} className="faint" />
                    </a>
                  );
                })}
              </div>
            </>
          )}

          <h3>
            Échanges avec l&apos;agence
            {task.comments.length > 0 && <span className="count" style={{ background: "var(--surface-3)" }}>{task.comments.length}</span>}
          </h3>
          {task.comments.length === 0 ? (
            <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>Aucun message pour le moment. Posez votre question ci-dessous.</p>
          ) : (
            <div className="ptl-thread">
              {task.comments.map((c) => (
                <div key={c.id} className={`ptl-msg${c.author.mine && !preview ? " mine" : ""}`}>
                  <Avatar profile={{ full_name: c.author.name, color: c.author.color }} size={28} title={false} />
                  <div className="b">
                    <div className="hd">
                      <b>{c.author.mine && !preview ? "Vous" : c.author.name}</b>
                      {!c.author.client && <span className="tag">Agence</span>}
                      <span suppressHydrationWarning>{ago(c.created_at)}</span>
                      {c.edited && <span>modifié</span>}
                    </div>
                    <div className="bd">{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="ptl-reply">
            <textarea
              className="textarea"
              rows={3}
              placeholder={preview ? "Réponse du client (désactivée en aperçu)" : "Écrire à l'agence…"}
              value={reply}
              maxLength={4000}
              disabled={preview}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
              }}
              aria-label="Votre message"
            />
            <div className="row">
              {preview ? <PreviewLock>Aperçu : seul le client peut répondre.</PreviewLock> : <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>Votre message est visible par l&apos;équipe de l&apos;agence.</span>}
              <button className="btn btn-primary" disabled={busy || preview || !reply.trim()} onClick={() => void send()}>
                <Send size={14} /> Envoyer
              </button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
