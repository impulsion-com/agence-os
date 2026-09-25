"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Archive, ArchiveRestore, ArrowLeft, AtSign, Bell, CheckCheck, CircleDot, FileSignature, Handshake, Mail, MailOpen,
  MessageSquare, UserPlus,
} from "lucide-react";

import "@/styles/workspace.css";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon } from "@/components/ui/misc";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { DueText } from "@/components/pickers";
import { PRIORITY, STATUS, colorOf } from "@/lib/constants";
import { ago, dayBucket, fmtDate, money } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Notification, Priority, ProposalStatus, TaskStatus } from "@/lib/types";
import { useOpenTask } from "./hooks";

export interface InboxItem extends Notification {
  task: {
    id: string; title: string; number: number; status: TaskStatus; priority: Priority; due_date: string | null;
    project_id: string; description: string; assignee_id: string | null;
  } | null;
  deal: { id: string; title: string; value: number; billing: string; stage_id: string | null; company_id: string | null; expected_close: string | null } | null;
  proposal?: { id: string; title: string; number: number; status: string; company_id: string | null; valid_until: string | null; sent_at: string | null } | null;
}

type Filter = "all" | "unread" | "assigned" | "comments" | "sales" | "archived";
const FILTERS: { id: Filter; name: string }[] = [
  { id: "all", name: "Tout" },
  { id: "unread", name: "Non lues" },
  { id: "assigned", name: "Assignations" },
  { id: "comments", name: "Commentaires" },
  { id: "sales", name: "Commercial" },
];

export const PROPOSAL_STATUS: Record<ProposalStatus, { name: string; color: string }> = {
  draft: { name: "Brouillon", color: "var(--gray)" },
  sent: { name: "Envoyée", color: "var(--blue)" },
  viewed: { name: "Consultée", color: "var(--violet)" },
  accepted: { name: "Acceptée", color: "var(--green)" },
  declined: { name: "Refusée", color: "var(--red)" },
  expired: { name: "Expirée", color: "var(--amber)" },
};

const match = (n: InboxItem, f: Filter) => {
  if (f === "archived") return !!n.archived_at;
  if (n.archived_at) return false;
  if (f === "unread") return !n.read_at;
  if (f === "assigned") return n.kind === "assigned" || n.kind === "mentioned";
  if (f === "comments") return n.kind === "commented" || n.kind === "mentioned";
  if (f === "sales") return n.kind === "deal" || n.kind === "proposal";
  return true;
};

const KIND_ICON: Record<Notification["kind"], ReactNode> = {
  assigned: <UserPlus size={11} />,
  mentioned: <AtSign size={11} />,
  commented: <MessageSquare size={11} />,
  status: <CircleDot size={11} />,
  due: <Bell size={11} />,
  invited: <UserPlus size={11} />,
  deal: <Handshake size={11} />,
  proposal: <FileSignature size={11} />,
};

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};

export function InboxView({ items, stages }: { items: InboxItem[]; stages: { id: string; name: string; color: string; kind: string }[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const router = useRouter();
  const openTask = useOpenTask();
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null);
  // Surcharges optimistes (lu / archivé) appliquées aux données serveur
  const [over, setOver] = useState<Record<string, Partial<Pick<Notification, "read_at" | "archived_at">>>>({});

  const all = useMemo(() => items.map((n) => (over[n.id] ? { ...n, ...over[n.id] } : n)), [items, over]);
  const shown = useMemo(() => all.filter((n) => match(n, filter)), [all, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter((n) => match(n, f.id) && !n.read_at).length])), [all]);
  const unread = all.filter((n) => !n.read_at && !n.archived_at).length;
  const current = all.find((n) => n.id === sel) ?? null;

  const groups = useMemo(() => {
    const g: { label: string; items: InboxItem[] }[] = [];
    for (const n of shown) {
      const label = dayBucket(n.created_at);
      const last = g[g.length - 1];
      if (last?.label === label) last.items.push(n);
      else g.push({ label, items: [n] });
    }
    return g;
  }, [shown]);

  const patch = useCallback(
    (ids: string[], values: Partial<Pick<Notification, "read_at" | "archived_at">>, success?: string) => {
      setOver((o) => {
        const next = { ...o };
        for (const id of ids) next[id] = { ...next[id], ...values };
        return next;
      });
      return mutate(async (sb) => must(await sb.from("notifications").update(values).in("id", ids).select("id")), { success });
    },
    [mutate],
  );

  const setRead = useCallback((n: InboxItem, read: boolean) => patch([n.id], { read_at: read ? new Date().toISOString() : null }), [patch]);
  const archive = useCallback(
    (n: InboxItem, value: boolean) => {
      patch([n.id], { archived_at: value ? new Date().toISOString() : null, ...(value ? { read_at: n.read_at ?? new Date().toISOString() } : {}) }, value ? "Notification archivée" : "Notification restaurée");
      if (value && sel === n.id) {
        const i = shown.findIndex((x) => x.id === n.id);
        setSel(shown[i + 1]?.id ?? shown[i - 1]?.id ?? null);
      }
    },
    [patch, sel, shown],
  );
  const markAll = () => {
    const ids = all.filter((n) => !n.read_at && !n.archived_at).map((n) => n.id);
    if (ids.length) patch(ids, { read_at: new Date().toISOString() }, "Tout est marqué comme lu");
  };

  const select = useCallback(
    (n: InboxItem) => {
      setSel(n.id);
      if (!n.read_at) setRead(n, true);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`.inbox-scroll [data-id="${n.id}"]`);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
      });
    },
    [setRead],
  );

  const openObject = useCallback(
    (n: InboxItem) => {
      if (n.task) openTask(n.task.id);
      else if (n.deal) router.push(`${ws.base}/crm/deals/${n.deal.id}`);
      else if (n.proposal_id) router.push(`${ws.base}/proposals/${n.proposal_id}`);
    },
    [openTask, router, ws.base],
  );

  // Navigation clavier : J/K (ou flèches), Entrée ouvre, U lu/non lu, E archive
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || document.querySelector(".modal, .palette, .drawer")) return;
      const k = e.key.toLowerCase();
      const i = shown.findIndex((n) => n.id === sel);
      if (k === "j" || k === "arrowdown") {
        e.preventDefault();
        const n = shown[Math.min(shown.length - 1, i + 1)];
        if (n) select(n);
      } else if (k === "k" || k === "arrowup") {
        e.preventDefault();
        const n = shown[Math.max(0, i - 1)];
        if (n) select(n);
      } else if (current && k === "enter") {
        e.preventDefault();
        openObject(current);
      } else if (current && k === "u") {
        setRead(current, !current.read_at);
      } else if (current && k === "e") {
        archive(current, !current.archived_at);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [shown, sel, current, select, setRead, archive, openObject]);

  // Temps réel : une nouvelle notification rafraîchit la liste
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`inbox-${ws.me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${ws.me.id}` }, () => router.refresh())
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [ws.me.id, router]);

  return (
    <div className={`inbox${current ? " showing" : ""}`}>
      <div className="inbox-list">
        <div className="inbox-top">
          <div className="row1">
            <h1>{filter === "archived" ? "Archivées" : "Boîte de réception"}</h1>
            <button className="btn btn-ghost btn-sm" onClick={markAll} disabled={!unread} title="Tout marquer comme lu">
              <CheckCheck size={14} />
              <span className="hide-sm">Tout lire</span>
            </button>
            <button
              className={`btn btn-sm btn-icon ${filter === "archived" ? "" : "btn-ghost"}`}
              aria-pressed={filter === "archived"}
              onClick={() => {
                setFilter(filter === "archived" ? "all" : "archived");
                setSel(null);
              }}
              title={filter === "archived" ? "Revenir à la boîte de réception" : "Voir les notifications archivées"}
              aria-label="Notifications archivées"
            >
              <Archive size={14} />
            </button>
          </div>
          <div className="tabs" role="tablist" aria-label="Filtrer les notifications">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={`tab${filter === f.id ? " on" : ""}`}
                onClick={() => {
                  setFilter(f.id);
                  setSel(null);
                }}
              >
                {f.name}
                {f.id === "unread" && counts[f.id] > 0 && <span className="count accent">{counts[f.id]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="inbox-scroll" role="listbox" aria-label="Notifications">
          {groups.length ? (
            groups.map((g) => (
              <div key={g.label}>
                <div className="inbox-gh">{g.label}</div>
                {g.items.map((n) => (
                  <NotifRow key={n.id} n={n} on={n.id === sel} onSelect={() => select(n)} onRead={() => setRead(n, !n.read_at)} onArchive={() => archive(n, !n.archived_at)} />
                ))}
              </div>
            ))
          ) : (
            <EmptyState
              icon={filter === "archived" ? "archive" : "inbox"}
              title={filter === "archived" ? "Aucune notification archivée" : filter === "unread" ? "Tout est lu" : "Boîte de réception vide"}
              text={
                filter === "archived"
                  ? "Archive une notification (touche E) pour la retrouver ici."
                  : "Tu seras prévenu ici quand on t'assigne une tâche, qu'on la commente ou qu'un deal ou une proposition bouge."
              }
            />
          )}
        </div>
        <div className="kb-hint" aria-hidden>
          <span><kbd>J</kbd><kbd>K</kbd> naviguer</span>
          <span><kbd>↵</kbd> ouvrir</span>
          <span><kbd>U</kbd> lu / non lu</span>
          <span><kbd>E</kbd> archiver</span>
        </div>
      </div>

      <div className="inbox-view">
        {current ? (
          <Preview n={current} stages={stages} onBack={() => setSel(null)} onRead={() => setRead(current, !current.read_at)} onArchive={() => archive(current, !current.archived_at)} onOpen={() => openObject(current)} />
        ) : (
          <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
            <EmptyState icon="inbox" title="Sélectionne une notification" text="Son contexte s'affiche ici : la tâche, le deal ou la proposition concernés." />
          </div>
        )}
      </div>
    </div>
  );
}

// Phrase d'une notification, avec l'objet en gras
function useSentence() {
  const ws = useWorkspace();
  return (n: InboxItem): { line: ReactNode; detail: string } => {
    const actor = n.actor_id ? ws.member(n.actor_id)?.profile.full_name ?? "Un ancien membre" : null;
    const A = actor ? <b>{actor}</b> : null;
    const task = <b>{n.task?.title ?? "une tâche supprimée"}</b>;
    const [prefix, rest] = n.body.includes(" : ") ? [n.body.split(" : ")[0], n.body.split(" : ").slice(1).join(" : ")] : ["", n.body];
    switch (n.kind) {
      case "assigned":
        return { line: <>{A ?? "On"} t&apos;a assigné {task}</>, detail: n.task ? `${STATUS[n.task.status].name} · ${PRIORITY[n.task.priority].name}` : "" };
      case "mentioned":
        return { line: <>{A ?? "Quelqu'un"} t&apos;a mentionné dans {task}</>, detail: n.body };
      case "commented":
        return { line: <>{A ?? "Quelqu'un"} a commenté {task}</>, detail: n.body };
      case "status":
        return { line: <>{A ?? "Quelqu'un"} a déplacé {task}</>, detail: n.body };
      case "due":
        return { line: <>{task} arrive à échéance</>, detail: n.body };
      case "invited":
        return { line: <>{A ?? "On"} t&apos;a invité</>, detail: n.body };
      case "deal": {
        const title = <b>{n.deal?.title ?? rest}</b>;
        if (prefix.startsWith("Deal gagné")) return { line: <>{A ?? "Quelqu'un"} a gagné le deal {title}</>, detail: n.deal ? money(n.deal.value, ws.workspace.currency) : "" };
        if (prefix.startsWith("Deal perdu")) return { line: <>{A ?? "Quelqu'un"} a perdu le deal {title}</>, detail: "" };
        return { line: <>{A ?? "On"} t&apos;a confié le deal {title}</>, detail: n.deal ? `${money(n.deal.value, ws.workspace.currency)}${n.deal.billing === "monthly" ? " / mois" : ""}` : "" };
      }
      case "proposal":
        return { line: <>{prefix || "Proposition"} : <b>{n.proposal?.title ?? rest}</b></>, detail: n.proposal ? `Proposition n° ${n.proposal.number}` : "" };
      default:
        return { line: n.body, detail: "" };
    }
  };
}

function NotifRow({ n, on, onSelect, onRead, onArchive }: { n: InboxItem; on: boolean; onSelect: () => void; onRead: () => void; onArchive: () => void }) {
  const ws = useWorkspace();
  const sentence = useSentence();
  const { line, detail } = sentence(n);
  const actor = ws.member(n.actor_id);
  const project = ws.project(n.project_id ?? n.task?.project_id);
  const company = ws.company(n.deal?.company_id ?? n.proposal?.company_id);
  return (
    <div
      className={`nt${on ? " on" : ""}${n.read_at ? " read" : ""}`}
      data-id={n.id}
      role="option"
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      onClick={onSelect}
    >
      {!n.read_at && <span className="unread" aria-label="Non lue" />}
      {actor ? (
        <Avatar profile={actor.profile} size={26} />
      ) : (
        <span className="nt-ic">{n.kind === "proposal" ? <FileSignature size={13} /> : n.kind === "deal" ? <Handshake size={13} /> : <Bell size={13} />}</span>
      )}
      <div className="nt-b">
        <div className="nt-l1">{line}</div>
        {detail && <div className="nt-l2 trunc">{detail}</div>}
        <div className="nt-meta">
          {KIND_ICON[n.kind]}
          {project ? (
            <>
              <i style={{ background: colorOf(project.color) }} />
              <span className="trunc" style={{ maxWidth: 170 }}>{project.name}</span>
            </>
          ) : company ? (
            <span className="trunc" style={{ maxWidth: 170 }}>{company.name}</span>
          ) : null}
          <span>·</span>
          <time dateTime={n.created_at}>{ago(n.created_at)}</time>
        </div>
      </div>
      <div className="nt-acts">
        <button
          className="btn btn-ghost btn-sm btn-icon"
          aria-label={n.read_at ? "Marquer comme non lue" : "Marquer comme lue"}
          title={n.read_at ? "Marquer comme non lue (U)" : "Marquer comme lue (U)"}
          onClick={(e) => {
            e.stopPropagation();
            onRead();
          }}
        >
          {n.read_at ? <Mail size={14} /> : <MailOpen size={14} />}
        </button>
        <button
          className="btn btn-ghost btn-sm btn-icon"
          aria-label={n.archived_at ? "Restaurer" : "Archiver"}
          title={n.archived_at ? "Restaurer (E)" : "Archiver (E)"}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
        >
          {n.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        </button>
      </div>
    </div>
  );
}

function Preview({
  n, stages, onBack, onRead, onArchive, onOpen,
}: {
  n: InboxItem;
  stages: { id: string; name: string; color: string; kind: string }[];
  onBack: () => void;
  onRead: () => void;
  onArchive: () => void;
  onOpen: () => void;
}) {
  const ws = useWorkspace();
  const sentence = useSentence();
  const { line } = sentence(n);
  const actor = ws.member(n.actor_id);
  const project = ws.project(n.project_id ?? n.task?.project_id);
  const t = n.task;
  const deal = n.deal;
  const prop = n.proposal;
  const stage = stages.find((s) => s.id === deal?.stage_id);
  const company = ws.company(deal?.company_id ?? prop?.company_id);
  const assignee = ws.member(t?.assignee_id);
  const quote = n.kind === "commented" || n.kind === "mentioned" ? n.body : "";

  return (
    <article className="pv" aria-live="polite">
      <div className="pv-top">
        <button className="btn btn-ghost btn-sm btn-icon back" onClick={onBack} aria-label="Retour à la liste">
          <ArrowLeft size={15} />
        </button>
        <div className="crumb">
          {project ? (
            <>
              <ObjIcon icon={project.icon} color={project.color} size={18} />
              <Link href={`${ws.base}/projects/${project.key}/board`} className="trunc">{project.name}</Link>
              {t && <span className="mono fainter">{project.key}-{t.number}</span>}
            </>
          ) : deal || prop ? (
            <>
              {deal ? <Handshake size={14} /> : <FileSignature size={14} />}
              <span>{deal ? "Pipeline" : "Propositions"}</span>
              {company && <span className="trunc">· {company.name}</span>}
            </>
          ) : null}
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onRead} aria-label={n.read_at ? "Marquer comme non lue" : "Marquer comme lue"} title={n.read_at ? "Marquer comme non lue (U)" : "Marquer comme lue (U)"}>
          {n.read_at ? <Mail size={15} /> : <MailOpen size={15} />}
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onArchive} aria-label={n.archived_at ? "Restaurer" : "Archiver"} title={n.archived_at ? "Restaurer (E)" : "Archiver (E)"}>
          {n.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </button>
      </div>

      <h2>{t?.title ?? deal?.title ?? prop?.title ?? "Notification"}</h2>

      <div className="pv-event">
        {actor ? <Avatar profile={actor.profile} size={22} /> : <span className="nt-ic" style={{ width: 22, height: 22 }}>{KIND_ICON[n.kind]}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div>{line}</div>
          <div className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>{new Date(n.created_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}</div>
          {n.kind === "status" && n.body && <div style={{ marginTop: 6 }}>{n.body}</div>}
        </div>
      </div>

      {quote && <blockquote className="pv-quote" style={{ margin: 0 }}>{quote}</blockquote>}

      {t && (
        <dl className="pv-props">
          <dt>Statut</dt>
          <dd><StatusIcon status={t.status} />{STATUS[t.status].name}</dd>
          <dt>Priorité</dt>
          <dd><PriorityIcon priority={t.priority} />{PRIORITY[t.priority].name}</dd>
          <dt>Responsable</dt>
          <dd>{assignee ? <><Avatar profile={assignee.profile} size={18} />{assignee.profile.full_name}</> : <span className="faint">Non assignée</span>}</dd>
          <dt>Échéance</dt>
          <dd>{t.due_date ? <DueText date={t.due_date} done={t.status === "done"} /> : <span className="faint">Aucune</span>}</dd>
        </dl>
      )}
      {t?.description && <div className="pv-desc">{t.description.length > 600 ? t.description.slice(0, 600) + "…" : t.description}</div>}

      {deal && (
        <dl className="pv-props">
          <dt>Étape</dt>
          <dd>{stage ? <Badge color={colorOf(stage.color)}>{stage.name}</Badge> : <span className="faint">Aucune</span>}</dd>
          <dt>Valeur</dt>
          <dd className="num">{money(deal.value, ws.workspace.currency)}{deal.billing === "monthly" ? " / mois" : ""}</dd>
          <dt>Client</dt>
          <dd>{company?.name ?? <span className="faint">Aucun</span>}</dd>
          <dt>Clôture prévue</dt>
          <dd>{deal.expected_close ? fmtDate(deal.expected_close) : <span className="faint">Non définie</span>}</dd>
        </dl>
      )}

      {prop && (
        <dl className="pv-props">
          <dt>Statut</dt>
          <dd>
            <Badge color={PROPOSAL_STATUS[prop.status as ProposalStatus]?.color ?? "var(--gray)"}>{PROPOSAL_STATUS[prop.status as ProposalStatus]?.name ?? prop.status}</Badge>
          </dd>
          <dt>Client</dt>
          <dd>{company?.name ?? <span className="faint">Aucun</span>}</dd>
          <dt>Envoyée le</dt>
          <dd>{prop.sent_at ? fmtDate(prop.sent_at.slice(0, 10)) : <span className="faint">Pas encore</span>}</dd>
          <dt>Valable jusqu&apos;au</dt>
          <dd>{prop.valid_until ? fmtDate(prop.valid_until) : <span className="faint">Sans limite</span>}</dd>
        </dl>
      )}

      <div className="pv-actions">
        {(t || deal || n.proposal_id) && (
          <button className="btn btn-primary" onClick={onOpen}>
            {t ? "Ouvrir la tâche" : deal ? "Ouvrir le deal" : "Ouvrir la proposition"}
            <kbd style={{ background: "transparent", color: "inherit", borderColor: "color-mix(in srgb, currentColor 35%, transparent)" }}>↵</kbd>
          </button>
        )}
        {project && (
          <Link className="btn" href={`${ws.base}/projects/${project.key}/board`}>
            Voir le projet
          </Link>
        )}
        {!t && !deal && !n.proposal_id && <span className="faint">L&apos;objet lié à cette notification a été supprimé.</span>}
      </div>
    </article>
  );
}
