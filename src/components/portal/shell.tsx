"use client";

import "@/styles/portal.css";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ChevronsUpDown, Eye } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { Menu } from "@/components/ui/overlay";
import { colorOf } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";
import { tabsFor } from "@/lib/portal/nav";
import type { PortalContext } from "@/lib/portal/types";
import { AccountMenu } from "./account";
import { Bell } from "./bell";
import { PortalProvider, usePortal } from "./context";

/**
 * Coque du portail client : en-tête aux couleurs de l'agence, onglets selon les fonctionnalités
 * ouvertes, cloche et menu du compte. Aucune barre latérale interne. Un membre de l'espace y est
 * en aperçu (bandeau, actions désactivées).
 */
export function PortalShell({ ctx, cookieCompany, children }: { ctx: PortalContext; cookieCompany: string | null; children: ReactNode }) {
  return (
    <PortalProvider ctx={ctx} cookieCompany={cookieCompany}>
      <Frame>{children}</Frame>
    </PortalProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { ctx, portal, preview, companyId, setCompany, href } = usePortal();
  const sp = useSearchParams();
  const banner = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const slug = ctx.workspace.slug;
  const param = sp.get("company");

  // Mémorise l'entreprise ouverte par un lien ?company=<id>
  useEffect(() => {
    if (param && param === companyId) setCompany(companyId);
  }, [param, companyId, setCompany]);

  // Dernière visite du client (jamais en aperçu : portal_touch ne concerne que sa propre ligne)
  useEffect(() => {
    if (preview) return;
    void supabaseBrowser().rpc("portal_touch", { p_company: companyId });
  }, [preview, companyId]);

  // Les onglets restent collés sous le bandeau d'aperçu
  useEffect(() => {
    const el = banner.current;
    if (!el || !root.current) return;
    const apply = () => root.current?.style.setProperty("--ptl-preview-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview]);

  return (
    <div className={`ptl${preview ? " is-preview" : ""}`} data-ptl-accent={ctx.workspace.accent || "indigo"} ref={root}>
      {preview && (
        <div className="ptl-preview" ref={banner} role="status">
          <span className="who">
            <Eye size={14} />
            <span>
              Aperçu du portail de <b>{portal.company}</b>
            </span>
          </span>
          <span className="note">
            {portal.enabled ? "Vous voyez ce que voit le client. Les actions sont désactivées." : "Portail non activé : le client n'y a pas encore accès."}
          </span>
          <Link href={`/w/${slug}/crm/companies/${companyId}`}>
            <ArrowLeft size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Retour à la fiche client
          </Link>
        </div>
      )}
      <header className="ptl-head">
        <div className="ptl-bar">
          <Link href={href("")} className="ptl-brand" aria-label={`${ctx.workspace.name}, accueil de l'espace client`}>
            <span className="ptl-mark" aria-hidden>{ctx.workspace.name.slice(0, 1).toUpperCase()}</span>
            <span className="nm trunc">{ctx.workspace.name}</span>
          </Link>
          <CompanySwitch />
          <span className="ptl-sp" />
          <Bell />
          <AccountMenu />
        </div>
      </header>
      <Tabs />
      <main className="ptl-main">{children}</main>
      <footer className="ptl-foot">Espace client {ctx.workspace.name}</footer>
    </div>
  );
}

function Tabs() {
  const { portal, href, ctx } = usePortal();
  const path = usePathname();
  const base = `/c/${ctx.workspace.slug}`;
  const rel = path.startsWith(base) ? path.slice(base.length).replace(/^\/+/, "") : "";
  const tabs = tabsFor(portal);
  if (tabs.length < 2) return null;
  return (
    <nav className="ptl-nav" aria-label="Rubriques de l'espace client">
      <div className="ptl-tabs">
        {tabs.map((t) => {
          const on = t.path ? rel === t.path || rel.startsWith(`${t.path}/`) : rel === "";
          return (
            <Link key={t.id} href={href(t.path)} className={`ptl-tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
              <Icon name={t.icon} size={15} />
              {t.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Entreprise courante ; sélecteur si l'utilisateur est client de plusieurs entreprises (ou membre en aperçu). */
function CompanySwitch() {
  const { ctx, portal, setCompany } = usePortal();
  const router = useRouter();
  const path = usePathname();
  const base = `/c/${ctx.workspace.slug}`;
  const rel = path.startsWith(base) ? path.slice(base.length).replace(/^\/+/, "") : "";
  const dot = <i style={{ ["--c" as string]: colorOf(portal.color) }} />;
  if (ctx.portals.length < 2)
    return (
      <span className="ptl-co single" title={portal.company}>
        {dot}
        <span className="trunc">{portal.company}</span>
      </span>
    );
  return (
    <Menu
      width={280}
      search={ctx.portals.length > 7 ? "Rechercher une entreprise…" : undefined}
      trigger={(open, isOpen) => (
        <button type="button" className="ptl-co" onClick={open} aria-haspopup="menu" aria-expanded={isOpen} title="Changer d'entreprise">
          {dot}
          <span className="trunc">{portal.company}</span>
          <ChevronsUpDown size={12} className="faint" />
        </button>
      )}
      items={ctx.portals.map((p) => ({
        label: p.company,
        icon: p.company_id === portal.company_id ? <Check size={14} /> : <span style={{ width: 14 }} />,
        sub: ctx.preview && !p.enabled ? "non activé" : undefined,
        onSelect: () => {
          setCompany(p.company_id);
          // même rubrique si elle est ouverte pour cette entreprise, sinon l'accueil (les fiches ?task= ou ?c= ne suivent pas)
          const keep = tabsFor(p).some((t) => t.path === rel);
          router.push(`${keep ? path : base}?company=${p.company_id}`);
        },
      }))}
    />
  );
}
