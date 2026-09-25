"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Ellipsis, Handshake, Mail, Phone, Plus, Trash2 } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { ConfirmModal, MenuList, Popover } from "@/components/ui/overlay";
import { fmtDate } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Contact, CrmActivity, Deal, PipelineStage } from "@/lib/types";
import { ActivityFeed } from "./activity-feed";
import { DealRows } from "./company-page";
import { contactName, useSynced } from "./lib";
import { ComboList, CompanyMark, InlineText, PageCrumbs, Prop, StatusBadge } from "./shared";

export function ContactPage({ contact: initial, deals, stages, activities }: { contact: Contact; deals: Deal[]; stages: PipelineStage[]; activities: CrmActivity[] }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const mutate = useMutate();
  const [c, setC] = useSynced(initial);
  const [notes, setNotes] = useState(initial.notes);
  const [confirmDel, setConfirmDel] = useState(false);
  const ro = !ws.canWrite;
  const company = ws.company(c.company_id);
  const name = contactName(c);

  const save = (patch: Partial<Contact>, success?: string) => {
    const prev = c;
    setC((x) => ({ ...x, ...patch }));
    mutate(
      async (sb) => {
        const r = await sb.from("contacts").update(patch).eq("id", c.id);
        if (r.error) setC(prev);
        return must(r);
      },
      { success },
    );
  };

  return (
    <div className="page crm-detail">
      <PageCrumbs items={[{ label: "Contacts", href: `${ws.base}/crm/contacts` }, { label: name }]} />

      <header className="crm-dhead">
        <div className="crm-co-head">
          <span className="av" style={{ ["--s" as string]: "48px", ["--c" as string]: company ? company.color : "var(--slate)" }}>
            {((c.first_name[0] ?? "") + (c.last_name[0] ?? "")).toUpperCase() || "?"}
          </span>
          <div className="crm-dhead-main">
            <h1 style={{ fontSize: "var(--fs-2xl)" }}>{name}</h1>
            <div className="crm-dhead-sub">
              {c.job_title && <span className="muted">{c.job_title}</span>}
              {c.job_title && company && <span className="fainter">chez</span>}
              {company && (
                <Link href={`${ws.base}/crm/companies/${company.id}`} className="crm-co">
                  <CompanyMark name={company.name} color={company.color} size={16} />
                  {company.name}
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="crm-dhead-actions">
          {c.email && (
            <a className="btn" href={`mailto:${c.email}`}>
              <Mail size={14} /> Écrire
            </a>
          )}
          {c.phone && (
            <a className="btn" href={`tel:${c.phone.replace(/\s/g, "")}`}>
              <Phone size={14} /> Appeler
            </a>
          )}
          {!ro && (
            <Popover
              align="end"
              trigger={(open) => (
                <button className="btn btn-icon" aria-label="Plus d'actions" onClick={open}>
                  <Ellipsis size={15} />
                </button>
              )}
            >
              {(close) => (
                <MenuList
                  onClose={close}
                  items={[
                    { label: "Nouveau deal", icon: <Handshake size={14} />, onSelect: () => ui.create({ kind: "deal", defaults: { company_id: c.company_id, contact_id: c.id } }) },
                    { label: "", separator: true },
                    { label: "Supprimer le contact", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDel(true) },
                  ]}
                />
              )}
            </Popover>
          )}
        </div>
      </header>

      <div className="crm-grid">
        <div className="crm-grid-main">
          <section className="card crm-props" aria-label="Coordonnées">
            <Prop label="Prénom">
              <InlineText value={c.first_name} disabled={ro} placeholder="Prénom" onSave={(first_name) => save({ first_name })} />
            </Prop>
            <Prop label="Nom">
              <InlineText value={c.last_name} disabled={ro} placeholder="Nom" onSave={(last_name) => save({ last_name })} />
            </Prop>
            <Prop label="Email">
              <InlineText value={c.email} type="email" disabled={ro} placeholder="Ajouter un email" onSave={(email) => save({ email })} />
            </Prop>
            <Prop label="Téléphone">
              <InlineText value={c.phone} type="tel" disabled={ro} placeholder="Ajouter un numéro" onSave={(phone) => save({ phone })} />
            </Prop>
            <Prop label="Poste">
              <InlineText value={c.job_title} disabled={ro} placeholder="Ajouter un poste" onSave={(job_title) => save({ job_title })} />
            </Prop>
            <Prop label="Entreprise">
              <Popover
                width={280}
                trigger={(open) => (
                  <button className={`pill${company ? "" : " empty"}`} onClick={ro ? undefined : open}>
                    {company ? <CompanyMark name={company.name} color={company.color} size={16} /> : <Building2 size={14} />}
                    <span className="trunc">{company?.name ?? "Aucune"}</span>
                  </button>
                )}
              >
                {(close) => (
                  <ComboList
                    value={c.company_id}
                    none="Aucune"
                    items={ws.companies.map((x) => ({ id: x.id, label: x.name, icon: <CompanyMark name={x.name} color={x.color} size={16} /> }))}
                    onPick={(company_id) => {
                      save({ company_id });
                      close();
                    }}
                  />
                )}
              </Popover>
            </Prop>
          </section>

          <section className="card" aria-label="Notes" style={{ marginTop: 16 }}>
            <div className="card-h"><h3>Notes</h3></div>
            <textarea
              className="crm-notes"
              style={{ minHeight: 90 }}
              value={notes}
              disabled={ro}
              placeholder="Ce qui compte pour cette personne, ses préférences de contact…"
              aria-label="Notes"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== c.notes && save({ notes }, "Notes enregistrées")}
            />
          </section>

          <section aria-label="Activités">
            <h2 className="crm-h2">Activités</h2>
            <ActivityFeed
              activities={activities}
              scope={{ contact_id: c.id, company_id: c.company_id }}
              showContext={(a) => {
                const d = a.deal_id ? deals.find((x) => x.id === a.deal_id) : null;
                return d ? <Link href={`${ws.base}/crm/deals/${d.id}`} className="crm-muted-link trunc" style={{ maxWidth: 200 }}>sur {d.title}</Link> : null;
              }}
            />
          </section>
        </div>

        <aside className="crm-grid-side">
          <div className="card crm-panel">
            <div className="card-h">
              <h3>Deals <span className="count">{deals.length}</span></h3>
              {!ro && (
                <button className="btn btn-ghost btn-sm" onClick={() => ui.create({ kind: "deal", defaults: { company_id: c.company_id, contact_id: c.id } })}>
                  <Plus size={13} /> Nouveau
                </button>
              )}
            </div>
            <DealRows compact deals={deals} stages={stages} empty="Aucun deal avec ce contact." />
          </div>
          {company && (
            <div className="card crm-panel">
              <div className="card-h"><h3>Entreprise</h3></div>
              <div className="crm-side-body">
                <Link href={`${ws.base}/crm/companies/${company.id}`} className="crm-person">
                  <CompanyMark name={company.name} color={company.color} size={32} />
                  <b className="trunc">{company.name}</b>
                </Link>
                <div className="crm-side-row"><span className="faint">Statut</span><StatusBadge status={company.status} /></div>
              </div>
            </div>
          )}
          <p className="fainter" style={{ fontSize: "var(--fs-xs)", padding: "0 4px" }}>Ajouté le {fmtDate(c.created_at.slice(0, 10), true)}</p>
        </aside>
      </div>

      {confirmDel && (
        <ConfirmModal
          title={`Supprimer ${name} ?`}
          text="Le contact et ses activités seront supprimés. Les deals associés sont conservés."
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.from("contacts").delete().eq("id", c.id)), { success: "Contact supprimé", refresh: false });
            if (ok !== undefined) {
              router.push(`${ws.base}/crm/contacts`);
              router.refresh();
            }
          }}
        />
      )}
    </div>
  );
}
