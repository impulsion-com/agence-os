"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronsUpDown, PanelLeft, Plus, Star } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { ObjIcon } from "@/components/ui/misc";
import { Menu } from "@/components/ui/overlay";
import { APP_NAME, PROJECT_STATUS } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";
import { applyPrefs } from "@/lib/prefs";
import { useMutate, useWorkspace } from "@/lib/workspace/context";
import { useUI } from "./ui-context";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 6, background: "var(--text)", color: "var(--text-inv)", display: "inline-grid",
        placeItems: "center", fontWeight: 700, fontSize: size * 0.5, position: "relative", flexShrink: 0, letterSpacing: "-0.04em",
      }}
      aria-hidden
    >
      a
      <i style={{ position: "absolute", right: size * 0.16, top: size * 0.16, width: size * 0.18, height: size * 0.18, background: "var(--accent)", borderRadius: 1 }} />
    </span>
  );
}

function Item({ href, icon, label, count, accent, exact }: { href: string; icon: string; label: string; count?: number; accent?: boolean; exact?: boolean }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={`side-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      <Icon name={icon} size={16} />
      <span className="trunc">{label}</span>
      {!!count && <span className={`count${accent ? " accent" : ""}`}>{count}</span>}
    </Link>
  );
}

// Section repliable, état mémorisé par navigateur
function Section({ id, title, action, children, defaultOpen = true }: { id: string; title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try {
      const v = localStorage.getItem(`aos-side-${id}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v !== null) setOpen(v === "1");
    } catch {}
  }, [id]);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(`aos-side-${id}`, open ? "0" : "1");
    } catch {}
  };
  return (
    <div className="side-sec">
      <div className="side-title">
        <button type="button" onClick={toggle} aria-expanded={open} className="side-title-btn">
          {title}
          <ChevronDown size={11} style={{ transform: open ? undefined : "rotate(-90deg)", transition: "transform var(--dur)" }} />
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

export function Sidebar({ onToggle }: { onToggle: () => void }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const path = usePathname();
  const mutate = useMutate();
  const b = ws.base;

  const active = ws.projects.filter((p) => !p.archived_at);
  const favs = ws.favorites.map((id) => ws.project(id)).filter((p) => p && !p.archived_at);
  const others = active.filter((p) => !ws.favorites.includes(p.id));
  const sideProjects = [...favs, ...others].slice(0, 12) as typeof active;

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
  };
  const setTheme = (theme: "light" | "dark" | "system") =>
    mutate(async (sb) => {
      const prefs = { ...ws.me.prefs, theme };
      applyPrefs(prefs, ws.workspace.accent);
      await sb.from("profiles").update({ prefs }).eq("id", ws.me.id);
    });

  return (
    <nav className="side" aria-label="Navigation principale">
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 8px 6px" }}>
        <Menu
          search="Changer d'espace…"
          trigger={(open) => (
            <button className="side-item" onClick={open} style={{ fontWeight: 600, color: "var(--text)", flex: 1 }}>
              <Logo />
              <span className="trunc">{ws.workspace.name}</span>
              <ChevronsUpDown size={13} className="faint" />
            </button>
          )}
          items={[
            { label: "Espaces de travail", heading: true },
            ...ws.workspaces.map((w) => ({ label: w.name, checked: w.id === ws.workspace.id, onSelect: () => router.push(`/w/${w.slug}`) })),
            { label: "", separator: true },
            { label: "Créer un espace", icon: <Plus size={14} />, onSelect: () => router.push("/onboarding?new=1") },
            ...(ws.isAdmin ? [{ label: "Réglages de l'espace", icon: <Icon name="settings" size={14} />, onSelect: () => router.push(`${b}/settings/workspace`) }] : []),
          ]}
        />
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onToggle} aria-label="Masquer la barre latérale" title="Masquer ( [ )">
          <PanelLeft size={15} />
        </button>
      </div>

      <div className="side-scroll">
        <Item href={b} icon="house" label="Accueil" exact />
        <Item href={`${b}/inbox`} icon="inbox" label="Boîte de réception" count={ws.unread} accent />
        <Item href={`${b}/my-tasks`} icon="circle-check" label="Mes tâches" count={ws.myOpen} />
        <Item href={`${b}/favorites`} icon="star" label="Favoris" />
        <button className="side-item" onClick={() => ui.setPalette(true)}>
          <Icon name="search" size={16} />
          <span>Rechercher</span>
          <kbd style={{ marginLeft: "auto" }}>⌘K</kbd>
        </button>

        <Section id="prod" title="Production">
          <Item href={`${b}/overview`} icon="layout-dashboard" label="Vue d'ensemble" />
          <Item href={`${b}/projects`} icon="folder-kanban" label="Projets" />
          <Item href={`${b}/tasks`} icon="list-checks" label="Tâches" />
          <Item href={`${b}/calendar`} icon="calendar" label="Calendrier" />
          <Item href={`${b}/timeline`} icon="chart-gantt" label="Timeline" />
        </Section>

        <Section id="com" title="Commercial">
          <Item href={`${b}/crm`} icon="handshake" label="Pipeline" exact />
          <Item href={`${b}/crm/companies`} icon="building-2" label="Clients & prospects" />
          <Item href={`${b}/crm/contacts`} icon="contact" label="Contacts" />
          <Item href={`${b}/proposals`} icon="file-signature" label="Propositions" />
        </Section>

        <Section id="perf" title="Performance">
          <Item href={`${b}/reporting`} icon="chart-column" label="Reporting" />
          <Item href={`${b}/tracking`} icon="mouse-pointer-click" label="Attribution" />
          <Item href={`${b}/links`} icon="link" label="Liens trackés" />
        </Section>

        <Section id="team" title="Agence" defaultOpen={false}>
          <Item href={`${b}/members`} icon="users" label="Membres" />
          <Item href={`${b}/teams`} icon="layers" label="Équipes" />
          <Item href={`${b}/activity`} icon="activity" label="Activité" />
        </Section>

        <Section
          id="proj"
          title="Projets"
          action={
            ws.canWrite && (
              <button className="btn btn-ghost btn-sm btn-icon" style={{ ["--h" as string]: "20px" }} aria-label="Nouveau projet" onClick={() => ui.create({ kind: "project" })}>
                <Plus size={13} />
              </button>
            )
          }
        >
          {sideProjects.map((p) => {
            const href = `${b}/projects/${p.key}`;
            const on = path.startsWith(href);
            return (
              <div key={p.id}>
                <Link href={href} className={`side-item${on ? " on" : ""}`}>
                  <ObjIcon icon={p.icon} color={p.color} size={18} />
                  <span className="trunc">{p.name}</span>
                  {ws.favorites.includes(p.id) && <Star size={11} fill="currentColor" className="faint" style={{ flexShrink: 0 }} />}
                  <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: PROJECT_STATUS[p.status].color, flexShrink: 0 }} />
                </Link>
                {on && (
                  <div>
                    {[
                      ["board", "kanban", "Tableau"],
                      ["list", "list", "Liste"],
                      ["timeline", "chart-gantt", "Timeline"],
                      ["files", "paperclip", "Fichiers"],
                    ].map(([v, i, l]) => (
                      <Link key={v} href={`${href}/${v}`} className={`side-item sub${path === `${href}/${v}` ? " on" : ""}`}>
                        <Icon name={i} size={14} />
                        {l}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!sideProjects.length && <div className="faint" style={{ padding: "4px 8px", fontSize: "var(--fs-sm)" }}>Aucun projet pour l&apos;instant</div>}
        </Section>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: 8 }}>
        <Item href={`${b}/archive`} icon="archive" label="Archives" />
        <Item href={`${b}/settings`} icon="settings" label="Réglages" />
        <Menu
          trigger={(open) => (
            <button className="side-item" onClick={open} style={{ marginTop: 2 }}>
              <Avatar profile={ws.me} size={22} title={false} />
              <span className="trunc" style={{ color: "var(--text)", fontWeight: 500 }}>{ws.me.full_name}</span>
              <ChevronsUpDown size={13} className="faint" style={{ marginLeft: "auto" }} />
            </button>
          )}
          items={[
            { label: ws.me.email, heading: true },
            { label: "Mon profil", icon: <Icon name="users" size={14} />, onSelect: () => router.push(`${b}/settings/profile`) },
            { label: "Préférences", icon: <Icon name="settings" size={14} />, onSelect: () => router.push(`${b}/settings/preferences`) },
            { label: "", separator: true },
            { label: "Thème clair", icon: <Icon name="sun" size={14} />, checked: ws.me.prefs?.theme === "light", onSelect: () => setTheme("light") },
            { label: "Thème sombre", icon: <Icon name="moon" size={14} />, checked: ws.me.prefs?.theme === "dark", onSelect: () => setTheme("dark") },
            { label: "Thème du système", icon: <Icon name="monitor" size={14} />, checked: !ws.me.prefs?.theme || ws.me.prefs.theme === "system", onSelect: () => setTheme("system") },
            { label: "", separator: true },
            { label: `À propos d'${APP_NAME}`, icon: <Icon name="sparkles" size={14} />, onSelect: () => window.open("https://github.com/impulsion-com/agence-os", "_blank") },
            { label: "Se déconnecter", icon: <Icon name="log-out" size={14} />, danger: true, onSelect: signOut },
          ]}
        />
      </div>
    </nav>
  );
}
