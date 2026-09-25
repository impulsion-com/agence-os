"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowUpDown, Building2, Calendar, CircleCheck, CircleDot, LayoutGrid, List, Plus, Search, Star, X } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { setUrlParams } from "@/components/tasks/view-state";
import { AvatarStack } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon, PageHeader, Progress } from "@/components/ui/misc";
import { Menu } from "@/components/ui/overlay";
import { PLATFORMS, PROJECT_STATUS } from "@/lib/constants";
import { diffDays, fmtDate, money, parseDay, today } from "@/lib/format";
import type { Profile, Project, ProjectStatus } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { useFavorite } from "./use-favorite";

import "@/styles/projects.css";

export interface ProjectStats {
  total: number;
  done: number;
  overdue: number;
  people: string[];
}

const SORTS = [
  { id: "recent", name: "Plus récents" },
  { id: "name", name: "Nom" },
  { id: "due", name: "Échéance" },
  { id: "progress", name: "Progression" },
  { id: "budget", name: "Budget média" },
] as const;
type Sort = (typeof SORTS)[number]["id"];

const STATUS_IDS = Object.keys(PROJECT_STATUS) as ProjectStatus[];

function Platforms({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <span className="pj-plats">
      {ids.map((id) => {
        const p = PLATFORMS.find((x) => x.id === id);
        return (
          <span key={id} className="chip" style={{ ["--c" as string]: p?.color }}>
            <i />
            {(p?.name ?? id).replace(" Ads", "")}
          </span>
        );
      })}
    </span>
  );
}

function Due({ p }: { p: Project }) {
  if (!p.due_date) return null;
  const n = diffDays(parseDay(p.due_date)!, today());
  const late = n < 0 && p.status !== "complete";
  return (
    <span className="pj-meta num" style={late ? { color: "var(--red)" } : undefined} title="Échéance du projet">
      <Calendar size={13} />
      {fmtDate(p.due_date)}
    </span>
  );
}

function FavButton({ id }: { id: string }) {
  const [fav, toggle] = useFavorite(id);
  return (
    <button
      type="button"
      className={`pj-star${fav ? " on" : ""}`}
      aria-pressed={fav}
      aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
    >
      <Star size={14} fill={fav ? "currentColor" : "none"} />
    </button>
  );
}

function ProjectCard({ p, s, people, href }: { p: Project; s: ProjectStats; people: Pick<Profile, "full_name" | "color">[]; href: string }) {
  const ws = useWorkspace();
  const company = ws.company(p.company_id);
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <Link href={href} className="card pj-card">
      <div className="pj-card-h">
        <ObjIcon icon={p.icon} color={p.color} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pj-card-name">
            <span className="trunc">{p.name}</span>
            <FavButton id={p.id} />
          </div>
          <div className="faint trunc pj-card-client">
            {company ? company.name : "Projet interne"}
            <span className="mono"> · {p.key}</span>
          </div>
        </div>
        <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge>
      </div>
      {p.description && <p className="pj-card-desc">{p.description}</p>}
      <div className="pj-card-prog">
        <Progress value={pct} color={pct === 100 ? "var(--green)" : colorOf2(p)} />
        <span className="num faint">{pct} %</span>
      </div>
      {(p.monthly_budget || p.platforms.length > 0) && (
        <div className="pj-card-media">
          {p.monthly_budget ? <span className="pj-meta num" title="Budget média mensuel"><b style={{ color: "var(--text)", fontWeight: 600 }}>{money(p.monthly_budget, ws.workspace.currency)}</b>/mois</span> : null}
          <Platforms ids={p.platforms} />
        </div>
      )}
      <div className="pj-card-f">
        <span className="pj-meta num" title="Tâches terminées">
          <CircleCheck size={13} />
          {s.done}/{s.total}
        </span>
        {s.overdue > 0 && (
          <span className="pj-meta num" style={{ color: "var(--red)" }} title="Tâches en retard">
            {s.overdue} en retard
          </span>
        )}
        <Due p={p} />
        <span style={{ marginLeft: "auto" }}>{people.length > 0 && <AvatarStack profiles={people} max={4} size={22} />}</span>
      </div>
    </Link>
  );
}

// Le jaune/ambre des projets est trop pâle en barre : on garde l'accent pour ces couleurs
const colorOf2 = (p: Project) => (p.color === "amber" ? "var(--amber)" : undefined);

export function ProjectsList({ stats, members }: { stats: Record<string, ProjectStats>; members: Record<string, string[]> }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const sp = useSearchParams();
  const layout = sp.get("v") === "list" ? "list" : "grid";
  const statuses = (sp.get("st")?.split(",").filter(Boolean) ?? []) as ProjectStatus[];
  const client = sp.get("client");
  const sort = (SORTS.find((s) => s.id === sp.get("sort"))?.id ?? "recent") as Sort;
  const archived = sp.get("archived") === "1";
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (k: string, v: string | null) => setUrlParams((p) => (v ? p.set(k, v) : p.delete(k)));
  const empty: ProjectStats = { total: 0, done: 0, overdue: 0, people: [] };
  const peopleOf = (p: Project) =>
    [...new Set([p.lead_id, ...(members[p.id] ?? []), ...(stats[p.id]?.people ?? [])].filter(Boolean) as string[])]
      .map((id) => ws.member(id)?.profile)
      .filter(Boolean) as Profile[];

  const pool = ws.projects.filter((p) => (archived ? !!p.archived_at : !p.archived_at));
  const shown = pool
    .filter((p) => !statuses.length || statuses.includes(p.status))
    .filter((p) => !client || (client === "none" ? !p.company_id : p.company_id === client))
    .filter((p) => {
      if (!q.trim()) return true;
      const s = q.trim().toLowerCase();
      return p.name.toLowerCase().includes(s) || p.key.toLowerCase().includes(s) || (ws.company(p.company_id)?.name.toLowerCase().includes(s) ?? false);
    })
    .sort((a, b) => {
      const pa = stats[a.id] ?? empty;
      const pb = stats[b.id] ?? empty;
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name, "fr");
        case "due":
          return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
        case "progress":
          return (pb.total ? pb.done / pb.total : 0) - (pa.total ? pa.done / pa.total : 0);
        case "budget":
          return (b.monthly_budget ?? 0) - (a.monthly_budget ?? 0);
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });

  const favs = shown.filter((p) => ws.favorites.includes(p.id));
  const active = ws.projects.filter((p) => !p.archived_at);
  const counts = STATUS_IDS.map((s) => [s, active.filter((p) => p.status === s).length] as const);
  const totalBudget = active.filter((p) => p.status !== "complete").reduce((m, p) => m + (p.monthly_budget ?? 0), 0);
  const clients = ws.companies.filter((c) => ws.projects.some((p) => p.company_id === c.id));
  const filtered = statuses.length > 0 || !!client || !!q.trim();

  const href = (p: Project) => `${ws.base}/projects/${p.key}/board`;

  return (
    <div className="page pj-list-page">
      <PageHeader
        title="Projets"
        sub={
          <>
            {counts.filter(([s]) => s !== "complete").reduce((m, [, n]) => m + n, 0)} actifs · {counts.find(([s]) => s === "complete")?.[1] ?? 0} terminés
            {totalBudget > 0 && <> · {money(totalBudget, ws.workspace.currency)} de budget média mensuel géré</>}
          </>
        }
      >
        {ws.canWrite && (
          <button className="btn btn-primary" onClick={() => ui.create({ kind: "project" })}>
            <Plus size={15} />
            Nouveau projet
          </button>
        )}
      </PageHeader>

      <div className="pj-filters">
        <label className="tv-search pj-search">
          <Search size={14} />
          <input
            placeholder="Rechercher un projet ou un client"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              set("q", e.target.value || null);
            }}
            aria-label="Rechercher un projet"
          />
          {q && (
            <button type="button" aria-label="Effacer" onClick={() => { setQ(""); set("q", null); }}>
              <X size={12} />
            </button>
          )}
        </label>
        <div className="pj-status-filter" role="group" aria-label="Filtrer par statut">
          <button type="button" className={`pj-sf${!statuses.length ? " on" : ""}`} onClick={() => set("st", null)}>
            Tous <span className="num faint">{active.length}</span>
          </button>
          {counts.map(([s, n]) => {
            const on = statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                className={`pj-sf${on ? " on" : ""}`}
                onClick={() => set("st", (on ? statuses.filter((x) => x !== s) : [...statuses, s]).join(",") || null)}
              >
                <span className="pj-dot" style={{ background: PROJECT_STATUS[s].color }} />
                {PROJECT_STATUS[s].name}
                <span className="num faint">{n}</span>
              </button>
            );
          })}
        </div>
        <Menu
          search="Client…"
          trigger={(open) => (
            <button type="button" className={`btn btn-sm${client ? " pj-on" : ""}`} onClick={open}>
              <Building2 size={14} />
              <span className="trunc" style={{ maxWidth: 140 }}>{client ? (client === "none" ? "Projets internes" : ws.company(client)?.name) : "Tous les clients"}</span>
            </button>
          )}
          items={[
            { label: "Tous les clients", checked: !client, onSelect: () => set("client", null) },
            { label: "Projets internes", checked: client === "none", onSelect: () => set("client", "none") },
            { label: "", separator: true },
            ...clients.map((c) => ({ label: c.name, checked: client === c.id, onSelect: () => set("client", c.id) })),
          ]}
        />
        <Menu
          trigger={(open) => (
            <button type="button" className="btn btn-sm" onClick={open}>
              <ArrowUpDown size={14} />
              {SORTS.find((s) => s.id === sort)?.name}
            </button>
          )}
          items={[{ label: "Trier par", heading: true }, ...SORTS.map((s) => ({ label: s.name, checked: s.id === sort, onSelect: () => set("sort", s.id === "recent" ? null : s.id) }))]}
        />
        <span style={{ flex: 1 }} />
        <button type="button" className={`btn btn-ghost btn-sm${archived ? " pj-on" : ""}`} onClick={() => set("archived", archived ? null : "1")}>
          {archived ? "Voir les projets actifs" : "Archivés"}
        </button>
        <div className="seg" role="group" aria-label="Affichage">
          <button type="button" className={layout === "grid" ? "on" : ""} onClick={() => set("v", null)} aria-pressed={layout === "grid"}>
            <LayoutGrid size={13} />
            Cartes
          </button>
          <button type="button" className={layout === "list" ? "on" : ""} onClick={() => set("v", "list")} aria-pressed={layout === "list"}>
            <List size={13} />
            Liste
          </button>
        </div>
      </div>

      {!pool.length ? (
        archived ? (
          <EmptyState icon="archive" title="Aucun projet archivé" text="Les projets archivés depuis leurs réglages apparaissent ici. Ils restent consultables et peuvent être restaurés." />
        ) : (
          <EmptyState icon="folder-kanban" title="Crée ton premier projet" text="Un projet regroupe les tâches d'une mission client : lancement de campagnes, sprint créa, audit… Pars d'un modèle pour gagner du temps.">
            {ws.canWrite && (
              <button className="btn btn-primary" onClick={() => ui.create({ kind: "project" })}>
                <Plus size={15} />
                Nouveau projet
              </button>
            )}
          </EmptyState>
        )
      ) : !shown.length ? (
        <EmptyState icon="filter" title="Aucun projet ne correspond" text="Essaie un autre statut, un autre client ou une autre recherche.">
          {filtered && (
            <button className="btn" onClick={() => { setQ(""); setUrlParams((p) => ["st", "client", "q"].forEach((k) => p.delete(k))); }}>
              Effacer les filtres
            </button>
          )}
        </EmptyState>
      ) : layout === "grid" ? (
        <>
          {favs.length > 0 && !filtered && sort === "recent" && (
            <>
              <h2 className="pj-sec">Favoris</h2>
              <div className="pj-grid-cards">
                {favs.map((p) => (
                  <ProjectCard key={p.id} p={p} s={stats[p.id] ?? empty} people={peopleOf(p)} href={href(p)} />
                ))}
              </div>
              <h2 className="pj-sec">Autres projets</h2>
            </>
          )}
          <div className="pj-grid-cards">
            {(favs.length > 0 && !filtered && sort === "recent" ? shown.filter((p) => !favs.includes(p)) : shown).map((p) => (
              <ProjectCard key={p.id} p={p} s={stats[p.id] ?? empty} people={peopleOf(p)} href={href(p)} />
            ))}
          </div>
        </>
      ) : (
        <div className="pj-table-wrap card">
          <table className="tbl pj-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th className="pj-col-client">Client</th>
                <th>Statut</th>
                <th className="pj-col-prog">Progression</th>
                <th className="pj-col-budget">Budget média</th>
                <th className="pj-col-due">Échéance</th>
                <th className="pj-col-team">Équipe</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const s = stats[p.id] ?? empty;
                const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                return (
                  <tr key={p.id} onClick={() => router.push(href(p))} style={{ cursor: "pointer" }}>
                    <td>
                      <Link href={href(p)} className="pj-row-name" onClick={(e) => e.stopPropagation()}>
                        <ObjIcon icon={p.icon} color={p.color} size={24} />
                        <span className="trunc">{p.name}</span>
                        <FavButton id={p.id} />
                      </Link>
                    </td>
                    <td className="pj-col-client faint">{ws.company(p.company_id)?.name ?? "Interne"}</td>
                    <td><Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge></td>
                    <td className="pj-col-prog">
                      <span style={{ display: "flex", alignItems: "center", gap: 8, width: 150 }}>
                        <Progress value={pct} color={pct === 100 ? "var(--green)" : undefined} />
                        <span className="num faint" style={{ fontSize: "var(--fs-xs)", minWidth: 50 }}>{s.done}/{s.total}</span>
                      </span>
                    </td>
                    <td className="pj-col-budget num">
                      {p.monthly_budget ? money(p.monthly_budget, ws.workspace.currency) : <span className="fainter">·</span>}
                      <div><Platforms ids={p.platforms} /></div>
                    </td>
                    <td className="pj-col-due"><Due p={p} /></td>
                    <td className="pj-col-team"><AvatarStack profiles={peopleOf(p)} max={4} size={22} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint pj-foot">
        <CircleDot size={12} /> Astuce : appuie sur <kbd>P</kbd> pour créer un projet depuis n&apos;importe où.
      </p>
    </div>
  );
}
