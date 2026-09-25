"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { ago, money } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import type { Company } from "@/lib/types";
import { CompanyFormModal } from "./company-form-modal";
import { COMPANY_STATUSES } from "./lib";
import { CompanyMark, PageCrumbs, sortRows, SortTh, StatusBadge } from "./shared";

export interface CompanyRow extends Company {
  open_deals: number;
  open_value: number;
  active_projects: number;
  last_activity: string | null;
}

type Col = "name" | "status" | "industry" | "owner" | "retainer" | "deals" | "projects" | "last";

export function CompaniesView({ companies }: { companies: CompanyRow[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | Company["status"]>("all");
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "name", dir: 1 });

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const filtered = companies.filter(
    (c) => (status === "all" || c.status === status) && (!q || norm(`${c.name} ${c.industry} ${c.website}`).includes(norm(q))),
  );
  const rows = sortRows(
    filtered,
    (c) => {
      switch (sort.col) {
        case "name": return c.name;
        case "status": return ["client", "lead", "former"].indexOf(c.status);
        case "industry": return c.industry || "~";
        case "owner": return ws.member(c.owner_id)?.profile.full_name ?? "~";
        case "retainer": return Number(c.monthly_retainer ?? 0);
        case "deals": return c.open_deals;
        case "projects": return c.active_projects;
        case "last": return c.last_activity ?? "";
      }
    },
    sort.dir,
  );
  const mrr = companies.filter((c) => c.status === "client").reduce((a, c) => a + Number(c.monthly_retainer ?? 0), 0);

  return (
    <div className="crm-wrap">
      <PageCrumbs items={[{ label: "Clients & prospects" }]} />
      <div className="crm-top">
        <div className="ph">
          <div>
            <h1>Clients & prospects</h1>
            <p>
              {companies.filter((c) => c.status === "client").length} clients actifs, {money(mrr, ws.workspace.currency)} de retainers mensuels.
            </p>
          </div>
          {ws.canWrite && (
            <div className="actions">
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Nouvelle entreprise
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="crm-body" style={{ display: "block" }}>
        <div className="crm-list-bar">
          <label className="crm-search">
            <Search size={14} className="faint" />
            <input placeholder="Rechercher une entreprise" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une entreprise" />
            {q && (
              <button onClick={() => setQ("")} aria-label="Effacer la recherche">
                <X size={13} />
              </button>
            )}
          </label>
          <div className="seg" role="radiogroup" aria-label="Filtrer par statut">
            <button role="radio" aria-checked={status === "all"} className={status === "all" ? "on" : ""} onClick={() => setStatus("all")}>
              Tous <span className="count">{companies.length}</span>
            </button>
            {COMPANY_STATUSES.map((s) => (
              <button key={s.id} role="radio" aria-checked={status === s.id} className={status === s.id ? "on" : ""} onClick={() => setStatus(s.id)}>
                {s.name === "Client" ? "Clients" : s.name === "Prospect" ? "Prospects" : "Anciens"}
                <span className="count">{companies.filter((c) => c.status === s.id).length}</span>
              </button>
            ))}
          </div>
        </div>

        {!companies.length ? (
          <div className="card">
            <EmptyState icon="building-2" title="Aucune entreprise" text="Ajoute tes clients et tes prospects pour relier deals, contacts, projets et reporting.">
              {ws.canWrite && (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={14} /> Nouvelle entreprise
                </button>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="crm-table-wrap card">
            <table className="tbl crm-tbl">
              <thead>
                <tr>
                  <SortTh sort={sort} onSort={setSort} col="name">Nom</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="status">Statut</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="industry" cls="crm-hide-sm">Secteur</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="owner" cls="crm-hide-md">Responsable</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="retainer" r cls="crm-hide-sm">Retainer</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="deals" r cls="crm-hide-md">Deals ouverts</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="projects" r cls="crm-hide-md">Projets actifs</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="last" cls="crm-hide-sm">Dernière activité</SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const href = `${ws.base}/crm/companies/${c.id}`;
                  const owner = ws.member(c.owner_id);
                  return (
                    <tr key={c.id} className="crm-tr" onClick={() => router.push(href)}>
                      <td>
                        <Link href={href} className="crm-cell-link" onClick={(e) => e.stopPropagation()}>
                          <CompanyMark name={c.name} color={c.color} size={20} />
                          <span className="trunc">{c.name}</span>
                        </Link>
                      </td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="crm-hide-sm">{c.industry || <span className="fainter">-</span>}</td>
                      <td className="crm-hide-md">
                        <span className="crm-owner">
                          <Avatar profile={owner?.profile} size={18} title={false} />
                          <span className="trunc">{owner?.profile.full_name ?? "Non assigné"}</span>
                        </span>
                      </td>
                      <td className="r num crm-hide-sm">{c.monthly_retainer ? money(c.monthly_retainer, ws.workspace.currency) : <span className="fainter">-</span>}</td>
                      <td className="r num crm-hide-md">
                        {c.open_deals ? (
                          <span title={money(c.open_value, ws.workspace.currency)}>{c.open_deals}</span>
                        ) : (
                          <span className="fainter">0</span>
                        )}
                      </td>
                      <td className="r num crm-hide-md">{c.active_projects || <span className="fainter">0</span>}</td>
                      <td className="crm-hide-sm faint">{c.last_activity ? ago(c.last_activity) : <span className="fainter">Jamais</span>}</td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="faint" style={{ textAlign: "center", height: 80 }}>
                      Aucune entreprise ne correspond.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <CompanyFormModal onClose={() => setCreating(false)} />}
    </div>
  );
}
