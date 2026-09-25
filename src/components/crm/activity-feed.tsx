"use client";

import { useState } from "react";
import { ArrowRightLeft, Ellipsis, PartyPopper, Plus, XCircle } from "lucide-react";

import { DatePicker } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { MenuList, Popover } from "@/components/ui/overlay";
import { ago, diffDays, fmtDate, parseDay, relDate, today } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { CrmActivity } from "@/lib/types";
import { ACTIVITY_KIND, ACTIVITY_KINDS, dayToTs, tsToDay, useSynced } from "./lib";
import { KIND_ICON } from "./shared";

export interface JournalEvent {
  id: number;
  verb: string;
  actor_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

type Scope = { deal_id?: string | null; company_id?: string | null; contact_id?: string | null };

type Item = { t: "act"; at: string; a: CrmActivity } | { t: "log"; at: string; e: JournalEvent };

/**
 * Fil d'activités CRM (note, appel, email, rendez-vous, tâche à faire) avec composer en haut.
 * `scope` est recopié sur chaque nouvelle activité pour qu'elle remonte aussi sur l'entreprise et le contact.
 */
export function ActivityFeed({ activities, scope, journal = [], showContext }: { activities: CrmActivity[]; scope: Scope; journal?: JournalEvent[]; showContext?: (a: CrmActivity) => React.ReactNode }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [list, setList] = useSynced(activities);
  const [kind, setKind] = useState<CrmActivity["kind"]>("note");
  const [body, setBody] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "task">("all");

  const add = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const row = await mutate(
      async (sb) =>
        must(
          await sb
            .from("crm_activities")
            .insert({
              workspace_id: ws.workspace.id,
              kind,
              body: body.trim(),
              due_at: kind === "task" ? dayToTs(due) : null,
              author_id: ws.me.id,
              deal_id: scope.deal_id ?? null,
              company_id: scope.company_id ?? null,
              contact_id: scope.contact_id ?? null,
            })
            .select("*")
            .single(),
        ),
      { success: kind === "task" ? "Relance ajoutée" : "Activité ajoutée" },
    );
    setBusy(false);
    if (row) {
      setList((l) => [row as CrmActivity, ...l]);
      setBody("");
      setDue(null);
    }
  };

  const toggle = (a: CrmActivity) => {
    setList((l) => l.map((x) => (x.id === a.id ? { ...x, done: !a.done } : x)));
    mutate(async (sb) => must(await sb.from("crm_activities").update({ done: !a.done }).eq("id", a.id)), { success: a.done ? undefined : "Relance faite" });
  };

  const remove = (a: CrmActivity) => {
    setList((l) => l.filter((x) => x.id !== a.id));
    mutate(async (sb) => must(await sb.from("crm_activities").delete().eq("id", a.id)), {
      success: "Activité supprimée",
      undo: async () => {
        const { id: _id, ...rest } = a;
        void _id;
        await mutate(async (sb) => must(await sb.from("crm_activities").insert({ ...rest, workspace_id: ws.workspace.id })), { refresh: false });
      },
    });
  };

  const open = list.filter((a) => a.kind === "task" && !a.done);
  const items: Item[] = [
    ...list.filter((a) => filter === "all" || a.kind === "task").map((a) => ({ t: "act" as const, at: a.created_at, a })),
    ...(filter === "all" ? journal.map((e) => ({ t: "log" as const, at: e.created_at, e })) : []),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <div className="crm-feed">
      {ws.canWrite && (
        <div className="crm-composer card">
          <div className="crm-kinds" role="radiogroup" aria-label="Type d'activité">
            {ACTIVITY_KINDS.map((k) => {
              const I = KIND_ICON[k.id];
              return (
                <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>
                  <I size={13} /> {k.name}
                </button>
              );
            })}
          </div>
          <textarea
            className="crm-composer-input"
            rows={2}
            value={body}
            placeholder={
              kind === "note" ? "Ajouter une note…" : kind === "call" ? "Résumé de l'appel…" : kind === "email" ? "Ce que tu as envoyé ou reçu…" : kind === "meeting" ? "Compte rendu du rendez-vous…" : "Ce qu'il faut faire, ex. relancer pour la proposition"
            }
            aria-label="Contenu de l'activité"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
            }}
          />
          <div className="crm-composer-f">
            {kind === "task" && <DatePicker value={due} onChange={setDue} placeholder="Échéance" />}
            <span className="fainter crm-kbd-hint" style={{ marginLeft: "auto", fontSize: "var(--fs-xs)" }}>
              <kbd>⌘</kbd> <kbd>Entrée</kbd>
            </span>
            <button className="btn btn-primary btn-sm" disabled={!body.trim() || busy} onClick={add}>
              <Plus size={13} /> Ajouter
            </button>
          </div>
        </div>
      )}

      <div className="crm-feed-h">
        <div className="seg" role="radiogroup" aria-label="Filtrer le fil">
          <button role="radio" aria-checked={filter === "all"} className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            Tout
          </button>
          <button role="radio" aria-checked={filter === "task"} className={filter === "task" ? "on" : ""} onClick={() => setFilter("task")}>
            À faire {open.length > 0 && <span className="count accent">{open.length}</span>}
          </button>
        </div>
      </div>

      {items.length ? (
        <ol className="crm-timeline">
          {items.map((it) =>
            it.t === "log" ? (
              <JournalLine key={`log-${it.e.id}`} e={it.e} />
            ) : (
              <ActivityItem key={it.a.id} a={it.a} onToggle={() => toggle(it.a)} onRemove={() => remove(it.a)} context={showContext?.(it.a)} />
            ),
          )}
        </ol>
      ) : (
        <p className="crm-feed-empty">
          {filter === "task" ? "Aucune tâche à faire." : "Aucune activité pour l'instant. Note ton premier échange pour garder l'historique de la relation."}
        </p>
      )}
    </div>
  );
}

function ActivityItem({ a, onToggle, onRemove, context }: { a: CrmActivity; onToggle: () => void; onRemove: () => void; context?: React.ReactNode }) {
  const ws = useWorkspace();
  const author = ws.member(a.author_id);
  const k = ACTIVITY_KIND[a.kind];
  const I = KIND_ICON[a.kind];
  const day = tsToDay(a.due_at);
  const n = day ? diffDays(parseDay(day)!, today()) : null;
  return (
    <li className={`crm-act k-${a.kind}${a.done ? " done" : ""}`}>
      <span className="crm-act-ic" aria-hidden>
        <I size={13} />
      </span>
      <div className="crm-act-b">
        <div className="crm-act-h">
          <Avatar profile={author?.profile} size={16} title={false} />
          <b>{author?.profile.full_name ?? "Quelqu'un"}</b>
          <span className="faint">{k.verb}</span>
          {context}
          <time className="fainter" dateTime={a.created_at} title={new Date(a.created_at).toLocaleString("fr-FR")}>
            {ago(a.created_at)}
          </time>
          {ws.canWrite && (
            <Popover
              align="end"
              trigger={(open) => (
                <button className="btn btn-ghost btn-sm btn-icon crm-act-menu" aria-label="Actions" onClick={open}>
                  <Ellipsis size={14} />
                </button>
              )}
            >
              {(close) => <MenuList onClose={close} items={[{ label: "Supprimer", danger: true, onSelect: onRemove }]} />}
            </Popover>
          )}
        </div>
        {a.kind === "task" ? (
          <label className="crm-task">
            <input type="checkbox" className="check" checked={a.done} disabled={!ws.canWrite} onChange={onToggle} />
            <span className="crm-act-text">{a.body}</span>
            {day && (
              <span className="crm-task-due num" style={{ color: a.done ? undefined : n! < 0 ? "var(--red)" : n! <= 1 ? "var(--amber)" : undefined }} title={fmtDate(day, true)}>
                {relDate(day)}
              </span>
            )}
          </label>
        ) : (
          <p className="crm-act-text">{a.body}</p>
        )}
      </div>
    </li>
  );
}

function JournalLine({ e }: { e: JournalEvent }) {
  const ws = useWorkspace();
  const actor = ws.member(e.actor_id);
  const m = e.meta as { to?: string; from?: string; reason?: string; stage?: string };
  const [Ic, text] =
    e.verb === "deal.won"
      ? [PartyPopper, <>a marqué le deal <b>gagné</b></>]
      : e.verb === "deal.lost"
        ? [XCircle, <>a marqué le deal <b>perdu</b>{m.reason ? <> : {m.reason}</> : null}</>]
        : e.verb === "deal.created"
          ? [Plus, <>a créé le deal{m.stage ? <> dans <b>{m.stage}</b></> : null}</>]
          : [ArrowRightLeft, <>a déplacé le deal {m.from ? <>de <b>{m.from}</b> </> : null}vers <b>{m.to}</b></>];
  return (
    <li className={`crm-log${e.verb === "deal.won" ? " won" : e.verb === "deal.lost" ? " lost" : ""}`}>
      <span className="crm-act-ic" aria-hidden>
        <Ic size={12} />
      </span>
      <span className="crm-log-t">
        <b>{actor?.profile.full_name ?? "Quelqu'un"}</b> {text}
      </span>
      <time className="fainter" dateTime={e.created_at}>{ago(e.created_at)}</time>
    </li>
  );
}
