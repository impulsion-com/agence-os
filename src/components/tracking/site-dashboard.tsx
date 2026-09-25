"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Globe, Settings2 } from "lucide-react";

import { CompanyMark, Crumbs } from "@/components/reporting/common";
import { Menu } from "@/components/ui/overlay";
import { useWorkspace } from "@/lib/workspace/context";
import type { Period } from "@/lib/ads/metrics";
import type { ModelId } from "@/lib/tracking/attribution";
import type { Goal, Overview, Person, SiteRow } from "@/lib/tracking/load";
import { ApiTab } from "./api-tab";
import { AttributionTab } from "./attribution-tab";
import { InstallTab } from "./install-tab";
import { JourneysTab } from "./journeys-tab";
import { PeopleTab } from "./people-tab";
import { SiteModal } from "./site-modal";
import { SiteStatus } from "./shared";

export type Tab = "overview" | "journeys" | "people" | "install" | "api";
export const TABS: { id: Tab; name: string }[] = [
  { id: "overview", name: "Attribution" },
  { id: "journeys", name: "Parcours" },
  { id: "people", name: "Visiteurs identifiés" },
  { id: "install", name: "Installation" },
  { id: "api", name: "API" },
];

export interface DashboardProps {
  site: SiteRow;
  sites: SiteRow[];
  tab: Tab;
  period: Period;
  model: ModelId;
  window: number;
  goal: Goal;
  overview: Overview | null;
  people: Person[] | null;
  q: string;
  secret: string | null;
  appUrl: string;
}

export function SiteDashboard(p: DashboardProps) {
  const ws = useWorkspace();
  const router = useRouter();
  const sp = useSearchParams();
  const [edit, setEdit] = useState(false);
  const { site } = p;
  const c = ws.company(site.company_id);
  const keep = (tab: Tab) => {
    // la période, le modèle et l'objectif suivent d'un onglet à l'autre
    const q = new URLSearchParams(sp.toString());
    q.delete("q");
    if (tab === "overview") q.delete("tab");
    else q.set("tab", tab);
    return `${ws.base}/tracking/${site.id}${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="page trk-page">
      <Crumbs items={[{ label: "Attribution", href: `${ws.base}/tracking` }, { label: site.name }]} />
      <div className="ph" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          {c ? <CompanyMark name={c.name} color={c.color} size={34} /> : <span className="trk-agency lg" aria-hidden><Globe size={17} /></span>}
          <div style={{ minWidth: 0 }}>
            <Menu
              width={300}
              search={p.sites.length > 6 ? "Rechercher un site…" : undefined}
              trigger={(open, isOpen) => (
                <button type="button" className="trk-switch" onClick={open} aria-haspopup="menu" aria-expanded={isOpen} aria-label="Changer de site suivi">
                  <h1 className="trunc">{site.name}</h1>
                  <ChevronDown size={16} className="faint" />
                </button>
              )}
              items={p.sites.map((s) => ({
                label: s.name,
                sub: ws.company(s.company_id)?.name ?? "Agence",
                checked: s.id === site.id,
                onSelect: () => router.push(`${ws.base}/tracking/${s.id}${p.tab !== "overview" ? `?tab=${p.tab}` : ""}`),
              }))}
            />
            <p className="trk-head-sub">
              <span className="trunc">{c ? c.name : "Site de l'agence"} · {site.domains.length ? site.domains.join(", ") : "tous les domaines"}</span>
              <SiteStatus last={site.last_event_at} compact />
            </p>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setEdit(true)}>
            <Settings2 size={14} /> Réglages
          </button>
        </div>
      </div>

      <nav className="tabs trk-tabs" aria-label="Sections du site suivi">
        {TABS.map((t) => (
          <Link key={t.id} href={keep(t.id)} className={`tab${p.tab === t.id ? " on" : ""}`} aria-current={p.tab === t.id ? "page" : undefined} scroll={false}>
            {t.name}
          </Link>
        ))}
      </nav>

      {p.tab === "overview" && p.overview && <AttributionTab {...p} overview={p.overview} />}
      {p.tab === "journeys" && p.overview && <JourneysTab {...p} overview={p.overview} />}
      {p.tab === "people" && <PeopleTab site={site} people={p.people ?? []} q={p.q} />}
      {p.tab === "install" && <InstallTab site={site} appUrl={p.appUrl} />}
      {p.tab === "api" && <ApiTab site={site} secret={p.secret} appUrl={p.appUrl} />}

      {edit && <SiteModal site={site} onClose={() => setEdit(false)} />}
    </div>
  );
}
