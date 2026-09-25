"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import "@/styles/workspace.css";
import { Icon } from "@/components/ui/icon";
import { useWorkspace } from "@/lib/workspace/context";

interface NavItem {
  href: string;
  icon: string;
  label: string;
  admin?: boolean;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Compte",
    items: [
      { href: "profile", icon: "users", label: "Profil" },
      { href: "preferences", icon: "palette", label: "Préférences" },
      { href: "shortcuts", icon: "zap", label: "Raccourcis clavier" },
    ],
  },
  {
    title: "Espace de travail",
    items: [
      { href: "workspace", icon: "settings", label: "Général" },
      { href: "members", icon: "user-plus", label: "Membres et invitations" },
      { href: "teams", icon: "layers", label: "Équipes" },
      { href: "labels", icon: "filter", label: "Étiquettes" },
    ],
  },
  {
    title: "Commercial",
    items: [
      { href: "pipeline", icon: "handshake", label: "Pipeline" },
      { href: "services", icon: "receipt", label: "Catalogue de services" },
    ],
  },
  {
    title: "Reporting",
    items: [
      { href: "integrations", icon: "plug", label: "Connexions publicitaires" },
      { href: "utm", icon: "link", label: "Conventions UTM" },
    ],
  },
];

// Mise en page des réglages : navigation latérale par sections + contenu.
// Les pages Pipeline, Catalogue et Connexions sont fournies par leurs modules.
export function SettingsShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const path = usePathname();
  const base = `${ws.base}/settings`;
  return (
    <div className="set">
      <nav className="set-nav" aria-label="Réglages">
        {SECTIONS.map((s) => (
          <div key={s.title} style={{ display: "contents" }}>
            <div className="side-title">{s.title}</div>
            {s.items.map((i) => {
              const href = `${base}/${i.href}`;
              const on = path === href || path.startsWith(href + "/");
              return (
                <Link key={i.href} href={href} className={`side-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                  <Icon name={i.icon} size={15} />
                  <span className="trunc">{i.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="set-body">{children}</div>
    </div>
  );
}

// En-tête et sections standard d'une page de réglages
export function SetPage({ title, lead, children, wide }: { title: string; lead?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="set-page" style={wide ? { maxWidth: 1000 } : undefined}>
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </div>
  );
}

export function SetSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-sec" aria-label={title}>
      <h2>
        {title}
        {action}
      </h2>
      {children}
    </section>
  );
}

export function SetRow({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <div className="l">
        {htmlFor ? (
          <label htmlFor={htmlFor}>
            <b>{label}</b>
          </label>
        ) : (
          <b>{label}</b>
        )}
        {hint && <p>{hint}</p>}
      </div>
      <div className="r">{children}</div>
    </div>
  );
}
