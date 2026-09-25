"use client";

import Link from "next/link";
import { Fragment } from "react";
import { Bell, ChevronDown, Menu as MenuIcon, PanelLeft, Plus, Search } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { Menu } from "@/components/ui/overlay";
import { useWorkspace } from "@/lib/workspace/context";
import { Logo } from "./sidebar";
import { useCrumbs } from "./crumbs";
import { useUI } from "./ui-context";

export function Topbar({ sideHidden, onToggle }: { sideHidden: boolean; onToggle: () => void }) {
  const ws = useWorkspace();
  const ui = useUI();
  const crumbs = useCrumbs();
  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-sm btn-icon mobile-only" onClick={onToggle} aria-label="Menu" style={{ display: sideHidden ? "inline-flex" : undefined }}>
        {sideHidden ? <PanelLeft size={15} /> : <MenuIcon size={15} />}
      </button>
      <nav className="crumbs" aria-label="Fil d'Ariane">
        <Link href={ws.base} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Logo size={16} />
          <span className="trunc">{ws.workspace.name}</span>
        </Link>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <span className="sep">/</span>
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="trunc">{c.label}</Link>
            ) : (
              <span className="cur trunc">{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
      <span style={{ flex: 1 }} />
      <button className="searchbox" onClick={() => ui.setPalette(true)} aria-label="Rechercher">
        <Search size={14} />
        <span className="label-text" style={{ flex: 1, textAlign: "left" }}>Rechercher ou aller à…</span>
        <kbd>⌘K</kbd>
      </button>
      <Link href={`${ws.base}/inbox`} className="btn btn-ghost btn-sm btn-icon" aria-label="Notifications" style={{ position: "relative" }}>
        <Bell size={15} />
        {ws.unread > 0 && <i style={{ position: "absolute", top: 4, right: 5, width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 0 2px var(--bg)" }} />}
      </Link>
      {ws.canWrite && (
        <Menu
          align="end"
          trigger={(open) => (
            <button className="btn btn-sm" onClick={open}>
              <Plus size={14} />
              Nouveau
              <ChevronDown size={13} className="faint" />
            </button>
          )}
          items={[
            { label: "Tâche", icon: <Icon name="circle-check" size={14} />, sub: "C", onSelect: () => ui.create({ kind: "task" }) },
            { label: "Projet", icon: <Icon name="folder-kanban" size={14} />, sub: "P", onSelect: () => ui.create({ kind: "project" }) },
            { label: "", separator: true },
            { label: "Deal", icon: <Icon name="handshake" size={14} />, sub: "D", onSelect: () => ui.create({ kind: "deal" }) },
            { label: "Proposition", icon: <Icon name="file-signature" size={14} />, onSelect: () => ui.create({ kind: "proposal" }) },
            { label: "", separator: true },
            { label: "Inviter un membre", icon: <Icon name="user-plus" size={14} />, onSelect: () => ui.create({ kind: "invite" }) },
          ]}
        />
      )}
      <Link href={`${ws.base}/settings/profile`} aria-label="Mon profil">
        <Avatar profile={ws.me} size={26} />
      </Link>
    </header>
  );
}
