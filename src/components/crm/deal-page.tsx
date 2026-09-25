"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Building2, ChartColumn, Ellipsis, ExternalLink, FileSignature, Mail, Phone, Plus, ThumbsDown, Trophy, UserRound } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { AssigneePicker, DatePicker } from "@/components/pickers";
import { ConfirmModal, MenuList, Popover } from "@/components/ui/overlay";
import { ago, fmtDate, money } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Contact, CrmActivity, Deal, PipelineStage, Proposal, Service } from "@/lib/types";
import { ActivityFeed, type JournalEvent } from "./activity-feed";
import { useDealStageFlow } from "./deal-flow";
import { contactName, isClosingOverdue, prettyUrl, normalizeUrl, stageOf, useSynced } from "./lib";
import { ComboList, CompanyMark, InlineText, PageCrumbs, Prop, ServicesPicker, SourcePicker, StageBadge, StagePicker, StatusBadge } from "./shared";

export const PROPOSAL_STATUS: Record<Proposal["status"], { name: string; color: string }> = {
  draft: { name: "Brouillon", color: "var(--gray)" },
  sent: { name: "Envoyée", color: "var(--blue)" },
  viewed: { name: "Consultée", color: "var(--violet)" },
  accepted: { name: "Acceptée", color: "var(--green)" },
  declined: { name: "Refusée", color: "var(--red)" },
  expired: { name: "Expirée", color: "var(--amber)" },
};

export type ProposalRow = Pick<Proposal, "id" | "number" | "title" | "status" | "created_at" | "sent_at" | "company_id" | "deal_id">;

export function ProposalList({ proposals, onCreate }: { proposals: ProposalRow[]; onCreate?: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="card crm-panel">
      <div className="card-h">
        <h3>Propositions <span className="count">{proposals.length}</span></h3>
        {onCreate && ws.canWrite && (
          <button className="btn btn-sm" onClick={onCreate}>
            <Plus size={13} /> Créer une proposition
          </button>
        )}
      </div>
      {proposals.length ? (
        <ul className="crm-mini-list">
          {proposals.map((p) => (
            <li key={p.id}>
              <Link href={`${ws.base}/proposals/${p.id}`} className="crm-mini-row">
                <FileSignature size={14} className="faint" />
                <span className="mono faint">#{p.number}</span>
                <span className="trunc" style={{ flex: 1 }}>{p.title}</span>
                <span className="badge" style={{ ["--c" as string]: PROPOSAL_STATUS[p.status].color }}>{PROPOSAL_STATUS[p.status].name}</span>
                <span className="fainter num crm-hide-sm">{fmtDate((p.sent_at ?? p.created_at).slice(0, 10))}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="crm-panel-empty">Aucune proposition. Crée-la depuis ce deal pour reprendre le client, le contact et les services.</p>
      )}
    </div>
  );
}

export function DealPage({
  deal: initial,
  stages,
  contacts,
  services,
  activities,
  journal,
  proposals,
  company,
}: {
  deal: Deal;
  stages: PipelineStage[];
  contacts: Contact[];
  services: Service[];
  activities: CrmActivity[];
  journal: JournalEvent[];
  proposals: ProposalRow[];
  company: { id: string; name: string; color: string; status: "lead" | "client" | "former"; website: string; industry: string; monthly_retainer: number | null } | null;
}) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const mutate = useMutate();
  const cur = ws.workspace.currency;
  const [deal, setDeal] = useSynced(initial);
  const [confirmDel, setConfirmDel] = useState(false);
  const stage = stageOf(stages, deal.stage_id);
  const contact = contacts.find((c) => c.id === deal.contact_id);
  const ro = !ws.canWrite;

  const apply = useCallback((_id: string, patch: Partial<Deal>) => setDeal((d) => ({ ...d, ...patch })), [setDeal]);
  const flow = useDealStageFlow(stages, apply);

  const save = (patch: Partial<Deal>, success?: string) => {
    const prev = deal;
    setDeal((d) => ({ ...d, ...patch }));
    mutate(
      async (sb) => {
        const r = await sb.from("deals").update(patch).eq("id", deal.id);
        if (r.error) setDeal(prev);
        return must(r);
      },
      { success },
    );
  };

  const won = stages.find((s) => s.kind === "won");
  const lost = stages.find((s) => s.kind === "lost");
  const coContacts = deal.company_id ? contacts.filter((c) => c.company_id === deal.company_id) : contacts;

  return (
    <div className="page crm-detail">
      <PageCrumbs items={[{ label: "Pipeline", href: `${ws.base}/crm` }, { label: deal.title }]} />

      <header className="crm-dhead">
        <div className="crm-dhead-main">
          <div className="crm-dhead-kicker">
            {ro ? <StageBadge stage={stage} /> : <StagePicker stages={stages} value={deal.stage_id} onChange={(id) => flow.move(deal, id)} trigger={(open) => (
              <button className="crm-stage-btn" onClick={open} aria-label="Changer d'étape">
                <StageBadge stage={stage} />
              </button>
            )} />}
            {stage?.kind === "open" && <span className="faint num">{stage.probability} % de chances</span>}
            {deal.closed_at && <span className="faint">{stage?.kind === "won" ? "Signé" : "Clos"} le {fmtDate(deal.closed_at.slice(0, 10), true)}</span>}
          </div>
          <InlineText className="crm-dtitle" value={deal.title} ariaLabel="Titre du deal" disabled={ro} onSave={(title) => title && save({ title })} />
          <div className="crm-dhead-sub">
            <span className="crm-dvalue num">{money(deal.value, cur)}</span>
            <span className="faint">{deal.billing === "monthly" ? "par mois" : "ponctuel"}</span>
            {company && (
              <>
                <span className="fainter">·</span>
                <Link href={`${ws.base}/crm/companies/${company.id}`} className="crm-co">
                  <CompanyMark name={company.name} color={company.color} size={16} />
                  {company.name}
                </Link>
              </>
            )}
          </div>
        </div>
        {!ro && (
          <div className="crm-dhead-actions">
            {stage?.kind === "open" ? (
              <>
                {won && (
                  <button className="btn crm-btn-won" onClick={() => flow.move(deal, won.id)}>
                    <Trophy size={14} /> Gagné
                  </button>
                )}
                {lost && (
                  <button className="btn" onClick={() => flow.move(deal, lost.id)}>
                    <ThumbsDown size={14} /> Perdu
                  </button>
                )}
              </>
            ) : (
              <button className="btn" onClick={() => { const first = stages.find((s) => s.kind === "open"); if (first) flow.move(deal, first.id); }}>
                Rouvrir le deal
              </button>
            )}
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
                    { label: "Créer une proposition", icon: <FileSignature size={14} />, onSelect: () => ui.create({ kind: "proposal", defaults: { company_id: deal.company_id, contact_id: deal.contact_id, deal_id: deal.id } }) },
                    { label: "", separator: true },
                    { label: "Supprimer le deal", danger: true, onSelect: () => setConfirmDel(true) },
                  ]}
                />
              )}
            </Popover>
          </div>
        )}
      </header>

      {stage?.kind === "lost" && (
        <div className="crm-lost-banner">
          <ThumbsDown size={14} />
          <span>Raison de la perte :</span>
          <InlineText value={deal.lost_reason} placeholder="Non renseignée" disabled={ro} onSave={(lost_reason) => save({ lost_reason })} ariaLabel="Raison de la perte" />
        </div>
      )}

      <div className="crm-grid">
        <div className="crm-grid-main">
          <section className="card crm-props" aria-label="Propriétés du deal">
            <Prop label="Valeur">
              <div className="crm-money-inline">
                <InlineText className="num" value={String(Number(deal.value))} disabled={ro} ariaLabel="Valeur" onSave={(v) => save({ value: Number(v.replace(/\s/g, "").replace(",", ".")) || 0 })} />
                <div className="seg">
                  <button disabled={ro} className={deal.billing === "monthly" ? "on" : ""} onClick={() => save({ billing: "monthly" })}>Mensuel</button>
                  <button disabled={ro} className={deal.billing === "one_off" ? "on" : ""} onClick={() => save({ billing: "one_off" })}>Ponctuel</button>
                </div>
              </div>
            </Prop>
            <Prop label="Étape">
              <StagePicker stages={stages} value={deal.stage_id} onChange={(id) => !ro && flow.move(deal, id)} />
            </Prop>
            <Prop label="Responsable">
              <AssigneePicker value={deal.owner_id} onChange={(owner_id) => !ro && save({ owner_id })} />
            </Prop>
            <Prop label="Closing prévu">
              <DatePicker value={deal.expected_close} overdue={isClosingOverdue(deal)} placeholder="Choisir une date" onChange={(expected_close) => !ro && save({ expected_close })} />
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
                    value={deal.company_id}
                    none="Aucune"
                    items={ws.companies.map((c) => ({ id: c.id, label: c.name, icon: <CompanyMark name={c.name} color={c.color} size={16} /> }))}
                    onPick={(company_id) => {
                      save({ company_id, ...(contact && contact.company_id !== company_id ? { contact_id: null } : {}) });
                      close();
                    }}
                  />
                )}
              </Popover>
            </Prop>
            <Prop label="Contact">
              <Popover
                width={280}
                trigger={(open) => (
                  <button className={`pill${contact ? "" : " empty"}`} onClick={ro ? undefined : open}>
                    <UserRound size={14} />
                    <span className="trunc">{contact ? contactName(contact) : "Aucun"}</span>
                  </button>
                )}
              >
                {(close) => (
                  <ComboList
                    value={deal.contact_id}
                    none="Aucun"
                    items={coContacts.map((c) => ({ id: c.id, label: contactName(c), sub: c.job_title }))}
                    onPick={(contact_id) => {
                      save({ contact_id });
                      close();
                    }}
                  />
                )}
              </Popover>
            </Prop>
            <Prop label="Source">
              {ro ? <span className="pill">{deal.source || "-"}</span> : <SourcePicker value={deal.source} onChange={(source) => save({ source })} />}
            </Prop>
            <Prop label="Services">
              {ro ? (
                <span className="crm-chips">{deal.services.map((s) => <span key={s} className="chip">{s}</span>)}</span>
              ) : (
                <ServicesPicker services={services} value={deal.services} currency={cur} onChange={(s) => save({ services: s })} />
              )}
            </Prop>
            <Prop label="Créé">
              <span className="pill faint" title={new Date(deal.created_at).toLocaleString("fr-FR")}>{fmtDate(deal.created_at.slice(0, 10), true)} ({ago(deal.created_at)})</span>
            </Prop>
          </section>

          <section aria-label="Activités">
            <h2 className="crm-h2">Activités</h2>
            <ActivityFeed activities={activities} journal={journal} scope={{ deal_id: deal.id, company_id: deal.company_id, contact_id: deal.contact_id }} />
          </section>
        </div>

        <aside className="crm-grid-side">
          <ProposalList
            proposals={proposals}
            onCreate={() => ui.create({ kind: "proposal", defaults: { company_id: deal.company_id, contact_id: deal.contact_id, deal_id: deal.id } })}
          />

          <div className="card crm-panel">
            <div className="card-h"><h3>Contact</h3></div>
            {contact ? (
              <div className="crm-side-body">
                <Link href={`${ws.base}/crm/contacts/${contact.id}`} className="crm-person">
                  <span className="av" style={{ ["--s" as string]: "32px", ["--c" as string]: "var(--slate)" }}>
                    {(contact.first_name[0] ?? "") + (contact.last_name[0] ?? "")}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b className="trunc" style={{ display: "block" }}>{contactName(contact)}</b>
                    <span className="faint trunc" style={{ display: "block", fontSize: "var(--fs-xs)" }}>{contact.job_title || "Poste non renseigné"}</span>
                  </span>
                </Link>
                {contact.email && (
                  <a className="crm-side-link" href={`mailto:${contact.email}`}><Mail size={14} /> <span className="trunc">{contact.email}</span></a>
                )}
                {contact.phone && (
                  <a className="crm-side-link" href={`tel:${contact.phone.replace(/\s/g, "")}`}><Phone size={14} /> {contact.phone}</a>
                )}
              </div>
            ) : (
              <p className="crm-panel-empty">Aucun contact associé à ce deal.</p>
            )}
          </div>

          <div className="card crm-panel">
            <div className="card-h"><h3>Entreprise</h3></div>
            {company ? (
              <div className="crm-side-body">
                <Link href={`${ws.base}/crm/companies/${company.id}`} className="crm-person">
                  <CompanyMark name={company.name} color={company.color} size={32} />
                  <span style={{ minWidth: 0 }}>
                    <b className="trunc" style={{ display: "block" }}>{company.name}</b>
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>{company.industry || "Secteur non renseigné"}</span>
                  </span>
                </Link>
                <div className="crm-side-row"><span className="faint">Statut</span><StatusBadge status={company.status} /></div>
                {company.monthly_retainer ? (
                  <div className="crm-side-row"><span className="faint">Retainer</span><span className="num">{money(company.monthly_retainer, cur)} /mois</span></div>
                ) : null}
                {company.website && (
                  <a className="crm-side-link" href={normalizeUrl(company.website)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> <span className="trunc">{prettyUrl(company.website)}</span></a>
                )}
                {company.status !== "lead" && (
                  <Link className="crm-side-link" href={`${ws.base}/reporting/${company.id}`}><ChartColumn size={14} /> Voir le reporting</Link>
                )}
              </div>
            ) : (
              <p className="crm-panel-empty">Aucune entreprise associée.</p>
            )}
          </div>
        </aside>
      </div>

      {flow.element}
      {confirmDel && (
        <ConfirmModal
          title="Supprimer ce deal ?"
          text={<>« {deal.title} » et ses activités seront supprimés définitivement. Les propositions liées sont conservées.</>}
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.from("deals").delete().eq("id", deal.id)), { success: "Deal supprimé", refresh: false });
            if (ok !== undefined) router.push(`${ws.base}/crm`);
          }}
        />
      )}
    </div>
  );
}
