"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChartColumn, Ellipsis, ExternalLink, FolderKanban, Handshake, Mail, Pencil, Phone, Plus, Trash2, Users } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { AssigneePicker, DueText } from "@/components/pickers";
import { ObjIcon } from "@/components/ui/misc";
import { ConfirmModal, MenuList, Popover } from "@/components/ui/overlay";
import { INDUSTRIES, PROJECT_STATUS } from "@/lib/constants";
import { fmtDate, money } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Company, Contact, CrmActivity, Deal, PipelineStage } from "@/lib/types";
import { ActivityFeed } from "./activity-feed";
import { CompanyFormModal } from "./company-form-modal";
import { ContactFormModal } from "./contact-form-modal";
import { ProposalList, type ProposalRow } from "./deal-page";
import { COMPANY_STATUSES, contactName, dealAmount, normalizeUrl, prettyUrl, stageOf, useSynced } from "./lib";
import { ColorPicker, CompanyMark, InlineText, PageCrumbs, PillSelect, Prop, StageBadge } from "./shared";

// Liste compacte de deals (fiches entreprise et contact)
export function DealRows({ deals, stages, empty, compact }: { deals: Deal[]; stages: PipelineStage[]; empty: string; compact?: boolean }) {
  const ws = useWorkspace();
  if (!deals.length) return <p className="crm-panel-empty">{empty}</p>;
  return (
    <ul className="crm-mini-list">
      {deals.map((d) => {
        const s = stageOf(stages, d.stage_id);
        const date = s?.kind === "open" ? <DueText date={d.expected_close} /> : <span className="fainter">{fmtDate(d.closed_at?.slice(0, 10))}</span>;
        if (compact)
          return (
            <li key={d.id}>
              <Link href={`${ws.base}/crm/deals/${d.id}`} className="crm-mini-row crm-mini-2">
                <span className="l1">
                  <span className="trunc" style={{ flex: 1, fontWeight: 500 }}>{d.title}</span>
                  <span className="num">{dealAmount(d, ws.workspace.currency)}</span>
                </span>
                <span className="l2">
                  <StageBadge stage={s} />
                  <span style={{ fontSize: "var(--fs-xs)" }}>{date}</span>
                </span>
              </Link>
            </li>
          );
        return (
          <li key={d.id}>
            <Link href={`${ws.base}/crm/deals/${d.id}`} className="crm-mini-row">
              <Handshake size={14} className="faint" />
              <span className="trunc" style={{ flex: 1, fontWeight: 500 }}>{d.title}</span>
              <StageBadge stage={s} />
              <span className="num crm-hide-sm nowrap" style={{ minWidth: 96, textAlign: "right" }}>{dealAmount(d, ws.workspace.currency)}</span>
              <span className="crm-hide-sm" style={{ minWidth: 84, textAlign: "right", fontSize: "var(--fs-xs)" }}>{date}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ContactRows({ contacts, empty }: { contacts: Contact[]; empty: string }) {
  const ws = useWorkspace();
  if (!contacts.length) return <p className="crm-panel-empty">{empty}</p>;
  return (
    <ul className="crm-mini-list">
      {contacts.map((c) => (
        <li key={c.id}>
          <div className="crm-mini-row">
            <span className="av" style={{ ["--s" as string]: "22px", ["--c" as string]: "var(--slate)" }}>
              {((c.first_name[0] ?? "") + (c.last_name[0] ?? "")).toUpperCase() || "?"}
            </span>
            <Link href={`${ws.base}/crm/contacts/${c.id}`} className="crm-cell-link" style={{ flex: 1 }}>
              <span className="trunc">{contactName(c)}</span>
              {c.job_title && <span className="faint trunc" style={{ fontWeight: 400 }}>{c.job_title}</span>}
            </Link>
            {c.email && (
              <a className="btn btn-ghost btn-sm btn-icon" href={`mailto:${c.email}`} aria-label={`Écrire à ${contactName(c)}`} title={c.email}>
                <Mail size={14} />
              </a>
            )}
            {c.phone && (
              <a className="btn btn-ghost btn-sm btn-icon" href={`tel:${c.phone.replace(/\s/g, "")}`} aria-label={`Appeler ${contactName(c)}`} title={c.phone}>
                <Phone size={14} />
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Tab = "overview" | "contacts" | "deals" | "projects" | "proposals" | "activity";

export function CompanyPage({
  company: initial,
  contacts,
  deals,
  stages,
  proposals,
  activities,
}: {
  company: Company;
  contacts: Contact[];
  deals: Deal[];
  stages: PipelineStage[];
  proposals: ProposalRow[];
  activities: CrmActivity[];
}) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const mutate = useMutate();
  const cur = ws.workspace.currency;
  const [c, setC] = useSynced(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [addContact, setAddContact] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [notes, setNotes] = useState(initial.notes);
  const ro = !ws.canWrite;

  const projects = ws.projects.filter((p) => p.company_id === c.id && !p.archived_at);
  const activeProjects = projects.filter((p) => p.status !== "complete");
  const kind = (d: Deal) => stageOf(stages, d.stage_id)?.kind ?? "open";
  const openDeals = deals.filter((d) => kind(d) === "open");
  const wonMonthly = deals.filter((d) => kind(d) === "won" && d.billing === "monthly").reduce((a, d) => a + Number(d.value), 0);
  const wonOneOff = deals.filter((d) => kind(d) === "won" && d.billing === "one_off").reduce((a, d) => a + Number(d.value), 0);

  const save = (patch: Partial<Company>, success?: string) => {
    const prev = c;
    setC((x) => ({ ...x, ...patch }));
    mutate(
      async (sb) => {
        const r = await sb.from("companies").update(patch).eq("id", c.id);
        if (r.error) setC(prev);
        return must(r);
      },
      { success },
    );
  };

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: "overview", label: "Vue d'ensemble" },
    { id: "contacts", label: "Contacts", n: contacts.length },
    { id: "deals", label: "Deals", n: deals.length },
    { id: "projects", label: "Projets", n: projects.length },
    { id: "proposals", label: "Propositions", n: proposals.length },
    { id: "activity", label: "Activités", n: activities.length },
  ];

  const newDeal = () => ui.create({ kind: "deal", defaults: { company_id: c.id, contact_id: contacts.length === 1 ? contacts[0].id : null } });

  return (
    <div className="page crm-detail">
      <PageCrumbs items={[{ label: "Clients & prospects", href: `${ws.base}/crm/companies` }, { label: c.name }]} />

      <header className="crm-dhead">
        <div className="crm-co-head">
          <CompanyMark name={c.name} color={c.color} size={44} />
          <div className="crm-dhead-main">
            <InlineText className="crm-dtitle" value={c.name} disabled={ro} ariaLabel="Nom de l'entreprise" onSave={(name) => name && save({ name })} />
            <div className="crm-dhead-sub">
              {ro ? (
                <span className="badge" style={{ ["--c" as string]: COMPANY_STATUSES.find((s) => s.id === c.status)!.color }}>{COMPANY_STATUSES.find((s) => s.id === c.status)!.name}</span>
              ) : (
                <PillSelect value={c.status} options={COMPANY_STATUSES.map((s) => ({ id: s.id, name: s.name, color: s.color }))} onChange={(status) => save({ status }, "Statut mis à jour")} />
              )}
              {c.industry && <span className="faint">{c.industry}</span>}
              {c.website && (
                <a href={normalizeUrl(c.website)} target="_blank" rel="noreferrer" className="crm-muted-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {prettyUrl(c.website)} <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="crm-dhead-actions">
          <Link href={`${ws.base}/reporting/${c.id}`} className="btn">
            <ChartColumn size={14} /> Voir le reporting
          </Link>
          {!ro && (
            <>
              <button className="btn btn-primary" onClick={newDeal}>
                <Plus size={14} /> Nouveau deal
              </button>
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
                      { label: "Modifier", icon: <Pencil size={14} />, onSelect: () => setEditing(true) },
                      { label: "Nouveau projet", icon: <FolderKanban size={14} />, onSelect: () => ui.create({ kind: "project", defaults: { company_id: c.id } }) },
                      { label: "Nouvelle proposition", icon: <Plus size={14} />, onSelect: () => ui.create({ kind: "proposal", defaults: { company_id: c.id } }) },
                      { label: "", separator: true },
                      { label: "Supprimer l'entreprise", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDel(true) },
                    ]}
                  />
                )}
              </Popover>
            </>
          )}
        </div>
      </header>

      <div className="stats crm-kpis">
        <div className="stat">
          <div className="k">Retainer mensuel</div>
          <div className="v">{c.monthly_retainer ? money(c.monthly_retainer, cur) : "-"}</div>
          <div className="d">{c.status === "client" ? "Client actif" : c.status === "lead" ? "Prospect" : "Ancien client"}</div>
        </div>
        <div className="stat">
          <div className="k">Pipeline ouvert</div>
          <div className="v">{money(openDeals.reduce((a, d) => a + Number(d.value), 0), cur)}</div>
          <div className="d">{openDeals.length} deal{openDeals.length > 1 ? "s" : ""} en cours</div>
        </div>
        <div className="stat">
          <div className="k">Signé</div>
          <div className="v">{money(wonMonthly, cur)}<span className="faint" style={{ fontSize: 13, fontWeight: 500 }}> /mois</span></div>
          <div className="d">{wonOneOff ? `+ ${money(wonOneOff, cur)} ponctuel` : "Deals gagnés mensuels"}</div>
        </div>
        <div className="stat">
          <div className="k">Projets actifs</div>
          <div className="v">{activeProjects.length}</div>
          <div className="d">{projects.length} au total</div>
        </div>
      </div>

      <nav className="tabs crm-section-tabs" role="tablist" aria-label="Sections de la fiche">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.n !== undefined && <span className="count">{t.n}</span>}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="crm-grid">
          <div className="crm-grid-main" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <section className="card crm-props" aria-label="Informations">
              <Prop label="Site web">
                <InlineText value={c.website} placeholder="Ajouter un site" disabled={ro} onSave={(website) => save({ website })} />
              </Prop>
              <Prop label="Secteur">
                {ro ? (
                  <span className="pill">{c.industry || "-"}</span>
                ) : (
                  <PillSelect
                    value={c.industry || "__none"}
                    options={[{ id: "__none", name: "Non renseigné" }, ...INDUSTRIES.map((i) => ({ id: i, name: i })), ...(c.industry && !INDUSTRIES.includes(c.industry) ? [{ id: c.industry, name: c.industry }] : [])]}
                    onChange={(v) => save({ industry: v === "__none" ? "" : v })}
                  />
                )}
              </Prop>
              <Prop label="Responsable">
                <AssigneePicker value={c.owner_id} onChange={(owner_id) => !ro && save({ owner_id })} />
              </Prop>
              <Prop label="Retainer">
                <div className="crm-money-inline">
                  <InlineText
                    className="num"
                    value={c.monthly_retainer ? String(Number(c.monthly_retainer)) : ""}
                    placeholder="0"
                    disabled={ro}
                    ariaLabel="Retainer mensuel"
                    onSave={(v) => save({ monthly_retainer: v ? Number(v.replace(/\s/g, "").replace(",", ".")) || null : null })}
                  />
                  <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>{cur === "EUR" ? "€" : cur} /mois</span>
                </div>
              </Prop>
              <Prop label="Couleur">
                {ro ? <CompanyMark name={c.name} color={c.color} /> : <ColorPicker value={c.color} onChange={(color) => save({ color })} />}
              </Prop>
              <Prop label="Créée le">
                <span className="pill faint">{fmtDate(c.created_at.slice(0, 10), true)}</span>
              </Prop>
            </section>

            <section className="card" aria-label="Notes">
              <div className="card-h"><h3>Notes</h3></div>
              <textarea
                className="crm-notes"
                value={notes}
                disabled={ro}
                placeholder="Contexte, objectifs du client, historique de la relation…"
                aria-label="Notes"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== c.notes && save({ notes }, "Notes enregistrées")}
              />
            </section>
          </div>

          <aside className="crm-grid-side">
            <div className="card crm-panel">
              <div className="card-h">
                <h3>Contacts <span className="count">{contacts.length}</span></h3>
                {!ro && <button className="btn btn-ghost btn-sm" onClick={() => setAddContact(true)}><Plus size={13} /> Ajouter</button>}
              </div>
              <ContactRows contacts={contacts.slice(0, 5)} empty="Aucun contact pour l'instant." />
            </div>
            <div className="card crm-panel">
              <div className="card-h">
                <h3>Deals ouverts <span className="count">{openDeals.length}</span></h3>
              </div>
              <DealRows compact deals={openDeals.slice(0, 5)} stages={stages} empty="Aucun deal en cours." />
            </div>
          </aside>
        </div>
      )}

      {tab === "contacts" && (
        <div className="card crm-panel">
          <div className="card-h">
            <h3><Users size={15} className="faint" /> Contacts</h3>
            {!ro && <button className="btn btn-sm" onClick={() => setAddContact(true)}><Plus size={13} /> Nouveau contact</button>}
          </div>
          <ContactRows contacts={contacts} empty={`Aucun contact chez ${c.name}. Ajoute ton interlocuteur principal.`} />
        </div>
      )}

      {tab === "deals" && (
        <div className="card crm-panel">
          <div className="card-h">
            <h3><Handshake size={15} className="faint" /> Deals</h3>
            {!ro && <button className="btn btn-sm" onClick={newDeal}><Plus size={13} /> Nouveau deal</button>}
          </div>
          <DealRows deals={deals} stages={stages} empty="Aucun deal avec cette entreprise." />
        </div>
      )}

      {tab === "projects" && (
        <div className="card crm-panel">
          <div className="card-h">
            <h3><FolderKanban size={15} className="faint" /> Projets</h3>
            {!ro && <button className="btn btn-sm" onClick={() => ui.create({ kind: "project", defaults: { company_id: c.id } })}><Plus size={13} /> Nouveau projet</button>}
          </div>
          {projects.length ? (
            <div>
              {projects.map((p) => (
                <Link key={p.id} href={`${ws.base}/projects/${p.key}/board`} className="crm-proj-row">
                  <ObjIcon icon={p.icon} color={p.color} size={22} />
                  <span className="trunc" style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
                  <span className="mono faint crm-hide-sm">{p.key}</span>
                  <span className="badge" style={{ ["--c" as string]: PROJECT_STATUS[p.status].color }}>{PROJECT_STATUS[p.status].name}</span>
                  {p.due_date && <span className="crm-hide-sm" style={{ fontSize: "var(--fs-xs)" }}><DueText date={p.due_date} done={p.status === "complete"} /></span>}
                </Link>
              ))}
            </div>
          ) : (
            <p className="crm-panel-empty">Aucun projet pour ce client. Un deal gagné te propose de créer le projet d&apos;onboarding.</p>
          )}
        </div>
      )}

      {tab === "proposals" && (
        <ProposalList proposals={proposals} onCreate={() => ui.create({ kind: "proposal", defaults: { company_id: c.id } })} />
      )}

      {tab === "activity" && (
        <div style={{ maxWidth: 760 }}>
          <ActivityFeed
            activities={activities}
            scope={{ company_id: c.id }}
            showContext={(a) => {
              const d = a.deal_id ? deals.find((x) => x.id === a.deal_id) : null;
              return d ? (
                <Link href={`${ws.base}/crm/deals/${d.id}`} className="crm-muted-link trunc" style={{ maxWidth: 200 }}>
                  sur {d.title}
                </Link>
              ) : null;
            }}
          />
        </div>
      )}

      {editing && <CompanyFormModal company={c} onClose={() => setEditing(false)} onSaved={() => {}} />}
      {addContact && <ContactFormModal companyId={c.id} onClose={() => setAddContact(false)} />}
      {confirmDel && (
        <ConfirmModal
          title={`Supprimer ${c.name} ?`}
          text={
            <>
              L&apos;entreprise et ses activités seront supprimées définitivement. Ses {contacts.length} contact{contacts.length > 1 ? "s" : ""}, {deals.length} deal{deals.length > 1 ? "s" : ""} et {projects.length} projet{projects.length > 1 ? "s" : ""} sont conservés mais ne seront plus rattachés à aucun client.
            </>
          }
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.from("companies").delete().eq("id", c.id)), { success: `${c.name} supprimé`, refresh: false });
            if (ok !== undefined) {
              router.push(`${ws.base}/crm/companies`);
              router.refresh();
            }
          }}
        />
      )}
    </div>
  );
}
