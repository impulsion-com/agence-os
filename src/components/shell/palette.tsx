"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { ObjIcon } from "@/components/ui/misc";
import { StatusIcon } from "@/components/ui/status";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import type { TaskStatus } from "@/lib/types";
import { openTask } from "@/components/tasks/view-state";
import { useUI } from "./ui-context";

interface Cmd {
  id: string;
  group: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  run: () => void;
}

// Palette ⌘K : navigation, actions, recherche de tâches, deals et contacts.
// Ouvre le tiroir de la tâche sur place si on est déjà sur la page, sinon navigue.
function openTaskFrom(href: string, id: string, push: (u: string) => void) {
  if (location.pathname.includes("/projects/") || location.pathname.endsWith("/tasks") || location.pathname.endsWith("/my-tasks")) openTask(id);
  else push(`${href}?task=${id}`);
}

export function CommandPalette() {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const [remote, setRemote] = useState<Cmd[]>([]);
  const open = ui.palette;
  const close = () => {
    ui.setPalette(false);
    setQ("");
    setAct(0);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPalette(!ui.palette);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ui]);

  // Recherche serveur : tâches, deals, contacts
  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const sb = supabaseBrowser();
      const like = `%${q.trim()}%`;
      const [tasks, deals, contacts] = await Promise.all([
        sb.from("tasks").select("id, title, number, status, project_id").eq("workspace_id", ws.workspace.id).ilike("title", like).is("archived_at", null).limit(8),
        sb.from("deals").select("id, title").eq("workspace_id", ws.workspace.id).ilike("title", like).limit(5),
        sb.from("contacts").select("id, first_name, last_name, email").eq("workspace_id", ws.workspace.id).or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(5),
      ]);
      const go = (href: string) => () => { router.push(href); close(); };
      setRemote([
        ...(tasks.data ?? []).map((t) => {
          const p = ws.project(t.project_id);
          return { id: "t" + t.id, group: "Tâches", label: t.title, icon: <StatusIcon status={t.status as TaskStatus} />, hint: p ? `${p.key}-${t.number}` : "", run: () => { close(); openTaskFrom(`${ws.base}/projects/${p?.key}/board`, t.id, router.push); } };
        }),
        ...(deals.data ?? []).map((d) => ({ id: "d" + d.id, group: "Deals", label: d.title, icon: <Icon name="handshake" size={15} />, run: go(`${ws.base}/crm/deals/${d.id}`) })),
        ...(contacts.data ?? []).map((c) => ({ id: "c" + c.id, group: "Contacts", label: `${c.first_name} ${c.last_name}`.trim() || c.email, icon: <Icon name="contact" size={15} />, hint: c.email, run: go(`${ws.base}/crm/contacts/${c.id}`) })),
      ]);
    }, 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const local = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => { router.push(href); close(); };
    const b = ws.base;
    const nav: [string, string, string][] = [
      ["Accueil", "house", b], ["Boîte de réception", "inbox", `${b}/inbox`], ["Mes tâches", "circle-check", `${b}/my-tasks`],
      ["Vue d'ensemble", "layout-dashboard", `${b}/overview`], ["Projets", "folder-kanban", `${b}/projects`], ["Tâches", "list-checks", `${b}/tasks`],
      ["Calendrier", "calendar", `${b}/calendar`], ["Timeline", "chart-gantt", `${b}/timeline`], ["Pipeline", "handshake", `${b}/crm`],
      ["Clients & prospects", "building-2", `${b}/crm/companies`], ["Contacts", "contact", `${b}/crm/contacts`], ["Propositions", "file-signature", `${b}/proposals`],
      ["Reporting", "chart-column", `${b}/reporting`], ["Membres", "users", `${b}/members`], ["Équipes", "layers", `${b}/teams`],
      ["Activité", "activity", `${b}/activity`], ["Réglages", "settings", `${b}/settings`],
    ];
    const act = (fn: () => void) => () => { close(); fn(); };
    return [
      ...(ws.canWrite
        ? [
            { id: "a-task", group: "Actions", label: "Créer une tâche", icon: <Icon name="plus" size={15} />, hint: "C", run: act(() => ui.create({ kind: "task" })) },
            { id: "a-proj", group: "Actions", label: "Créer un projet", icon: <Icon name="folder-kanban" size={15} />, run: act(() => ui.create({ kind: "project" })) },
            { id: "a-deal", group: "Actions", label: "Créer un deal", icon: <Icon name="handshake" size={15} />, run: act(() => ui.create({ kind: "deal" })) },
            { id: "a-prop", group: "Actions", label: "Créer une proposition", icon: <Icon name="file-signature" size={15} />, run: act(() => ui.create({ kind: "proposal" })) },
            { id: "a-inv", group: "Actions", label: "Inviter un membre", icon: <Icon name="user-plus" size={15} />, run: act(() => ui.create({ kind: "invite" })) },
          ]
        : []),
      ...ws.projects.filter((p) => !p.archived_at).map((p) => ({ id: "p" + p.id, group: "Projets", label: p.name, icon: <ObjIcon icon={p.icon} color={p.color} size={18} />, hint: p.key, run: go(`${b}/projects/${p.key}`) })),
      ...nav.map(([l, i, h]) => ({ id: "n" + h, group: "Aller à", label: l, icon: <Icon name={i} size={15} />, run: go(h) })),
      ...ws.members.map((m) => ({ id: "m" + m.user_id, group: "Membres", label: m.profile.full_name, icon: <Avatar profile={m.profile} size={18} title={false} />, run: go(`${b}/members/${m.user_id}`) })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const ql = q.trim().toLowerCase();
  const items = [...local.filter((c) => !ql || c.label.toLowerCase().includes(ql) || c.hint?.toLowerCase().includes(ql)).slice(0, ql ? 30 : 14), ...(q.trim().length >= 2 ? remote : [])];
  if (!open) return null;
  let lastGroup = "";
  return createPortal(
    <>
      <div className="scrim" onClick={close} />
      <div className="palette" role="dialog" aria-label="Palette de commandes">
        <input
          autoFocus
          placeholder="Rechercher une tâche, un projet, un deal, un contact… ou lancer une action"
          value={q}
          onChange={(e) => { setQ(e.target.value); setAct(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => Math.min(items.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter") items[act]?.run();
          }}
        />
        <div className="list">
          {items.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div className="mi-h">{head}</div>}
                <button className={`mi${i === act ? " act" : ""}`} onMouseEnter={() => setAct(i)} onClick={c.run} style={{ minHeight: 36 }}>
                  {c.icon}
                  <span className="trunc">{c.label}</span>
                  {c.hint && <span className="sub mono">{c.hint}</span>}
                </button>
              </div>
            );
          })}
          {!items.length && <div className="mi faint">Aucun résultat pour « {q} »</div>}
        </div>
      </div>
    </>,
    document.body,
  );
}
