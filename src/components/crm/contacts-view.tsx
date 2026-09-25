"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, FileUp, Pencil, Plus, Search, X } from "lucide-react";

import { EmptyState } from "@/components/ui/misc";
import { Popover } from "@/components/ui/overlay";
import { ago } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import type { Contact } from "@/lib/types";
import { ContactFormModal } from "./contact-form-modal";
import { CsvImportModal } from "./csv-import-modal";
import { contactName } from "./lib";
import { ComboList, CompanyLink, CompanyMark, PageCrumbs, sortRows, SortTh } from "./shared";

export interface ContactRow extends Contact {
  last_activity: string | null;
}

type Col = "name" | "job" | "company" | "email" | "phone" | "last";

export function ContactsView({ contacts }: { contacts: ContactRow[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [co, setCo] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "name", dir: 1 });

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const filtered = contacts.filter((c) => {
    if (co && (co === "none" ? c.company_id : c.company_id !== co)) return false;
    if (!q) return true;
    return norm(`${c.first_name} ${c.last_name} ${c.email} ${c.job_title} ${ws.company(c.company_id)?.name ?? ""}`).includes(norm(q));
  });
  const rows = sortRows(
    filtered,
    (c) => {
      switch (sort.col) {
        case "name": return contactName(c);
        case "job": return c.job_title || "~";
        case "company": return ws.company(c.company_id)?.name ?? "~";
        case "email": return c.email || "~";
        case "phone": return c.phone || "~";
        case "last": return c.last_activity ?? "";
      }
    },
    sort.dir,
  );
  const coSel = co && co !== "none" ? ws.company(co) : null;

  return (
    <div className="crm-wrap">
      <PageCrumbs items={[{ label: "Contacts" }]} />
      <div className="crm-top">
        <div className="ph">
          <div>
            <h1>Contacts</h1>
            <p>Les personnes avec qui tu échanges chez tes clients et prospects.</p>
          </div>
          {ws.canWrite && (
            <div className="actions">
              <button className="btn" onClick={() => setImporting(true)}>
                <FileUp size={14} /> Importer un CSV
              </button>
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus size={14} /> Nouveau contact
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="crm-body" style={{ display: "block" }}>
        <div className="crm-list-bar">
          <label className="crm-search">
            <Search size={14} className="faint" />
            <input placeholder="Rechercher un contact" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un contact" />
            {q && (
              <button onClick={() => setQ("")} aria-label="Effacer la recherche">
                <X size={13} />
              </button>
            )}
          </label>
          <Popover
            width={260}
            trigger={(open) => (
              <button className={`btn btn-sm${co ? " crm-on" : " btn-ghost"}`} onClick={open}>
                {coSel ? <CompanyMark name={coSel.name} color={coSel.color} size={14} /> : <Building2 size={14} />}
                {coSel ? coSel.name : co === "none" ? "Sans entreprise" : "Entreprise"}
              </button>
            )}
          >
            {(close) => (
              <ComboList
                placeholder="Filtrer par entreprise…"
                value={co}
                none="Toutes les entreprises"
                items={[
                  ...ws.companies.map((c) => ({ id: c.id, label: c.name, icon: <CompanyMark name={c.name} color={c.color} size={16} /> })),
                  { id: "none", label: "Sans entreprise" },
                ]}
                onPick={(id) => {
                  setCo(id);
                  close();
                }}
              />
            )}
          </Popover>
          {co && (
            <button className="btn btn-ghost btn-sm" onClick={() => setCo(null)}>
              <X size={13} /> Effacer
            </button>
          )}
        </div>

        {!contacts.length ? (
          <div className="card">
            <EmptyState icon="contact" title="Aucun contact" text="Ajoute tes interlocuteurs un par un ou importe-les depuis un fichier CSV (export LinkedIn, Google Contacts, ancien CRM).">
              {ws.canWrite && (
                <>
                  <button className="btn" onClick={() => setImporting(true)}>
                    <FileUp size={14} /> Importer un CSV
                  </button>
                  <button className="btn btn-primary" onClick={() => setEditing("new")}>
                    <Plus size={14} /> Nouveau contact
                  </button>
                </>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="crm-table-wrap card">
            <table className="tbl crm-tbl">
              <thead>
                <tr>
                  <SortTh sort={sort} onSort={setSort} col="name">Nom</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="job" cls="crm-hide-md">Poste</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="company" cls="crm-hide-sm">Entreprise</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="email">Email</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="phone" cls="crm-hide-md">Téléphone</SortTh>
                  <SortTh sort={sort} onSort={setSort} col="last" cls="crm-hide-sm">Dernière activité</SortTh>
                  {ws.canWrite && <th style={{ width: 40 }} aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const href = `${ws.base}/crm/contacts/${c.id}`;
                  return (
                    <tr key={c.id} className="crm-tr" onClick={() => router.push(href)}>
                      <td>
                        <Link href={href} className="crm-cell-link" onClick={(e) => e.stopPropagation()}>
                          <span className="av" style={{ ["--s" as string]: "22px", ["--c" as string]: "var(--slate)" }}>
                            {((c.first_name[0] ?? "") + (c.last_name[0] ?? "")).toUpperCase() || "?"}
                          </span>
                          <span className="trunc">{contactName(c)}</span>
                        </Link>
                      </td>
                      <td className="crm-hide-md faint">{c.job_title || <span className="fainter">-</span>}</td>
                      <td className="crm-hide-sm" onClick={(e) => e.stopPropagation()}>
                        {c.company_id ? <CompanyLink id={c.company_id} /> : <span className="fainter">-</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ maxWidth: 240 }}>
                        {c.email ? <a href={`mailto:${c.email}`} className="crm-muted-link trunc" style={{ display: "block" }}>{c.email}</a> : <span className="fainter">-</span>}
                      </td>
                      <td className="crm-hide-md num" onClick={(e) => e.stopPropagation()}>
                        {c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="crm-muted-link">{c.phone}</a> : <span className="fainter">-</span>}
                      </td>
                      <td className="crm-hide-sm faint">{c.last_activity ? ago(c.last_activity) : <span className="fainter">Jamais</span>}</td>
                      {ws.canWrite && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Modifier ${contactName(c)}`} onClick={() => setEditing(c)}>
                            <Pencil size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={7} className="faint" style={{ textAlign: "center", height: 80 }}>
                      Aucun contact ne correspond.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <ContactFormModal contact={editing === "new" ? undefined : editing} companyId={co && co !== "none" ? co : null} onClose={() => setEditing(null)} />}
      {importing && <CsvImportModal existing={contacts} onClose={() => setImporting(false)} />}
    </div>
  );
}
