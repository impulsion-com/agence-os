"use client";

import "@/styles/proposals.css";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Check, CircleAlert, Copy, Ellipsis, ExternalLink, FolderPlus, Handshake, Link2, LoaderCircle, Lock, Mail,
  RotateCcw, Send, Trash2, UserRound,
} from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { useUI } from "@/components/shell/ui-context";
import { AssigneePicker, CompanyPicker, DatePicker } from "@/components/pickers";
import { Badge } from "@/components/ui/misc";
import { ConfirmModal, Menu, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import type { Database, Json } from "@/lib/database.types";
import { ago, dayOffset, fmtDate, money, parseDay, today } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Contact, Deal, PipelineStage, Proposal, ProposalBlock, ProposalItem, ProposalStatus, Service } from "@/lib/types";
import { logActivity, useWorkspace } from "@/lib/workspace/context";
import { BlocksEditor } from "./blocks-editor";
import { ProposalDocument } from "./document";
import { SelectPill } from "./fields";
import { PROPOSAL_STATUS, STATUS_ORDER, computeTotals, effectiveStatus } from "./lib";
import { PricingEditor, type EditItem } from "./pricing-editor";
import { contactName } from "./proposal-create-modal";

type ContactLite = Pick<Contact, "id" | "first_name" | "last_name" | "email" | "company_id">;
type DealLite = Pick<Deal, "id" | "title" | "company_id" | "contact_id" | "stage_id" | "closed_at">;
type StageLite = Pick<PipelineStage, "id" | "name" | "position" | "kind">;

export interface EditorData {
  proposal: Proposal;
  items: ProposalItem[];
  services: Service[];
  contacts: ContactLite[];
  deals: DealLite[];
  stages: StageLite[];
}

type Meta = Omit<Proposal, "blocks">;
type ProposalUpdate = Database["public"]["Tables"]["proposals"]["Update"];
type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const CURRENCIES = ["EUR", "USD", "CHF", "GBP", "CAD", "MUR"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const noop = () => () => {};
/** Origine de l'app : celle du navigateur, ou NEXT_PUBLIC_APP_URL au rendu serveur. */
function useOrigin() {
  return useSyncExternalStore(noop, () => window.location.origin, () => process.env.NEXT_PUBLIC_APP_URL || "");
}

export function ProposalEditor({ data }: { data: EditorData }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const toast = useToast();

  const [meta, setMeta] = useState<Meta>(() => {
    const { blocks: _b, ...rest } = data.proposal;
    void _b;
    return rest;
  });
  const [blocks, setBlocks] = useState<ProposalBlock[]>(() => (Array.isArray(data.proposal.blocks) ? data.proposal.blocks : []));
  const [items, setItems] = useState<EditItem[]>(() => data.items.map(({ proposal_id: _p, ...i }) => (void _p, i)));
  const [save, setSave] = useState<SaveState>("idle");
  const [sendOpen, setSendOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");

  // ---------------------------------------------------------------
  // Sauvegarde automatique (debounce 800 ms)
  // ---------------------------------------------------------------
  const patch = useRef<Record<string, unknown>>({});
  const dirtyItems = useRef<Set<string>>(new Set());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inflight.current) await inflight.current;
    const p = patch.current;
    const ids = [...dirtyItems.current];
    if (!Object.keys(p).length && !ids.length) return;
    patch.current = {};
    dirtyItems.current = new Set();
    setSave("saving");
    const run = (async () => {
      const sb = supabaseBrowser();
      try {
        if (Object.keys(p).length) {
          const r = await sb.from("proposals").update(p as ProposalUpdate).eq("id", data.proposal.id);
          if (r.error) throw new Error(r.error.message);
        }
        if (ids.length) {
          const rows = itemsRef.current
            .map((i, position) => ({ ...i, position, proposal_id: data.proposal.id }))
            .filter((i) => ids.includes(i.id));
          if (rows.length) {
            const r = await sb.from("proposal_items").upsert(rows);
            if (r.error) throw new Error(r.error.message);
          }
        }
        setSave("saved");
      } catch (e) {
        // On remet en file pour le prochain essai
        patch.current = { ...p, ...patch.current };
        ids.forEach((id) => dirtyItems.current.add(id));
        setSave("error");
        toast(e instanceof Error ? `Enregistrement impossible : ${e.message}` : "Enregistrement impossible", { error: true });
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, [data.proposal.id, toast]);

  const schedule = useCallback(() => {
    setSave("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }, [flush]);

  // Enregistre ce qui reste en quittant la page
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(patch.current).length || dirtyItems.current.size) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  const setField = <K extends keyof Meta>(k: K, v: Meta[K]) => {
    setMeta((m) => ({ ...m, [k]: v }));
    patch.current[k] = v;
    schedule();
  };
  const changeBlocks = (b: ProposalBlock[]) => {
    setBlocks(b);
    patch.current.blocks = b as unknown as Json;
    schedule();
  };
  const markAll = (list: EditItem[]) => list.forEach((i) => dirtyItems.current.add(i.id));
  const changeItem = (id: string, p: Partial<EditItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
    dirtyItems.current.add(id);
    schedule();
  };
  const addItem = (s?: Service) => {
    const it: EditItem = {
      id: crypto.randomUUID(),
      service_id: s?.id ?? null,
      name: s?.name ?? "",
      description: s?.description ?? "",
      quantity: 1,
      unit_price: s ? Number(s.unit_price) : 0,
      billing: s?.billing ?? "monthly",
      optional: false,
      selected: true,
      position: items.length,
    };
    setItems((l) => [...l, it]);
    dirtyItems.current.add(it.id);
    schedule();
    if (!s) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".pe-line:last-child .pe-line-name")?.focus());
  };
  const removeItem = async (id: string) => {
    const before = items;
    setItems((l) => l.filter((i) => i.id !== id));
    dirtyItems.current.delete(id);
    const next = before.filter((i) => i.id !== id);
    markAll(next);
    schedule();
    const r = await supabaseBrowser().from("proposal_items").delete().eq("id", id);
    if (r.error) {
      setItems(before);
      toast(r.error.message, { error: true });
    }
  };
  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setItems(next);
    markAll(next);
    schedule();
  };

  // ---------------------------------------------------------------
  // Données dérivées
  // ---------------------------------------------------------------
  const status = effectiveStatus(meta);
  const locked = !ws.canWrite || meta.status === "accepted" || meta.status === "declined";
  const totals = useMemo(() => computeTotals(items, meta.discount_pct, meta.tax_pct), [items, meta.discount_pct, meta.tax_pct]);
  const company = ws.company(meta.company_id);
  const contact = data.contacts.find((c) => c.id === meta.contact_id);
  const deal = data.deals.find((d) => d.id === meta.deal_id);
  const contactOptions = data.contacts
    .filter((c) => !meta.company_id || c.company_id === meta.company_id || c.id === meta.contact_id)
    .map((c) => ({ id: c.id, label: contactName(c), sub: c.email }));
  const dealOptions = data.deals
    .filter((d) => !meta.company_id || d.company_id === meta.company_id || d.id === meta.deal_id)
    .map((d) => ({ id: d.id, label: d.title, sub: data.stages.find((s) => s.id === d.stage_id)?.name }));
  const origin = useOrigin();
  const url = `${origin}/p/${meta.public_token}`;

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  const copyLink = async (silent = false) => {
    try {
      await navigator.clipboard.writeText(url);
      if (!silent) toast("Lien copié");
      return true;
    } catch {
      if (!silent) toast("Copie impossible, sélectionne le lien à la main", { error: true });
      return false;
    }
  };

  const mailto = () => {
    const first = contact?.first_name?.trim();
    const until = meta.valid_until ? `\n\nElle est valable jusqu'au ${fmtDate(meta.valid_until, true)}.` : "";
    const subject = `Proposition : ${meta.title}`;
    const body =
      `Bonjour${first ? " " + first : ""},\n\n` +
      `Suite à notre échange, vous trouverez ci-dessous notre proposition « ${meta.title} ».\n\n` +
      `Vous pouvez la consulter, choisir les options qui vous intéressent et la valider en ligne :\n${url}` +
      until +
      `\n\nJe reste à votre disposition pour en discuter.\n\nBien cordialement,\n${ws.me.full_name}\n${ws.workspace.name}`;
    return `mailto:${encodeURIComponent(contact?.email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  /** Passe la proposition en « envoyée », journalise et fait avancer le deal lié. */
  const markSent = async () => {
    await flush();
    const sb = supabaseBrowser();
    const first = meta.status === "draft" || !meta.sent_at;
    const expired = meta.valid_until && parseDay(meta.valid_until)! < today();
    const upd: Record<string, unknown> = {};
    if (meta.status === "draft") upd.status = "sent";
    if (first) upd.sent_at = new Date().toISOString();
    if (expired) upd.valid_until = dayOffset(30);
    if (Object.keys(upd).length) {
      const r = await sb.from("proposals").update(upd as ProposalUpdate).eq("id", data.proposal.id);
      if (r.error) {
        toast(r.error.message, { error: true });
        return false;
      }
      setMeta((m) => ({ ...m, ...(upd as Partial<Meta>) }));
    }
    if (first) {
      await logActivity(sb, {
        workspace_id: ws.workspace.id,
        verb: "proposal.sent",
        deal_id: meta.deal_id,
        meta: { proposal_id: data.proposal.id, number: meta.number, title: meta.title },
      });
      // Deal lié : vers « Proposition envoyée » s'il est plus tôt dans le pipeline
      if (deal && !deal.closed_at) {
        const target = data.stages.find((s) => norm(s.name) === "proposition envoyee") ?? data.stages.find((s) => norm(s.name).startsWith("proposition"));
        const cur = data.stages.find((s) => s.id === deal.stage_id);
        if (target && target.kind === "open" && (!cur || (cur.kind === "open" && cur.position < target.position))) {
          const r = await sb.from("deals").update({ stage_id: target.id }).eq("id", deal.id);
          if (!r.error) {
            await logActivity(sb, { workspace_id: ws.workspace.id, verb: "deal.stage", deal_id: deal.id, meta: { from: cur?.id ?? null, to: target.id, title: deal.title } });
            toast(`Deal déplacé vers « ${target.name} »`);
          }
        }
      }
    }
    router.refresh();
    return true;
  };

  const duplicate = async () => {
    await flush();
    const sb = supabaseBrowser();
    const { data: copy, error } = await sb
      .from("proposals")
      .insert({
        workspace_id: ws.workspace.id,
        title: `${meta.title} (copie)`,
        company_id: meta.company_id,
        contact_id: meta.contact_id,
        deal_id: meta.deal_id,
        currency: meta.currency,
        discount_pct: meta.discount_pct,
        tax_pct: meta.tax_pct,
        valid_until: dayOffset(30),
        blocks: blocks as unknown as Json,
        number: undefined as unknown as number,
      })
      .select("id")
      .single();
    if (error) return toast(error.message, { error: true });
    if (items.length) {
      const r = await sb.from("proposal_items").insert(
        items.map(({ id: _id, ...i }, position) => (void _id, { ...i, position, selected: !i.optional, proposal_id: copy.id })),
      );
      if (r.error) return toast(r.error.message, { error: true });
    }
    toast("Proposition dupliquée");
    router.push(`${ws.base}/proposals/${copy.id}`);
  };

  const remove = async () => {
    patch.current = {};
    dirtyItems.current = new Set();
    const r = await supabaseBrowser().from("proposals").delete().eq("id", data.proposal.id);
    if (r.error) return toast(r.error.message, { error: true });
    toast("Proposition supprimée");
    router.push(`${ws.base}/proposals`);
    router.refresh();
  };

  const setStatus = async (s: ProposalStatus) => {
    const upd: Partial<Meta> = { status: s };
    if (s === "draft") Object.assign(upd, { sent_at: null, viewed_at: null, accepted_at: null, accepted_name: null, declined_reason: null });
    if (s === "sent" && !meta.sent_at) upd.sent_at = new Date().toISOString();
    if (s === "accepted" && !meta.accepted_at) upd.accepted_at = new Date().toISOString();
    setMeta((m) => ({ ...m, ...upd }));
    Object.assign(patch.current, upd);
    await flush();
    router.refresh();
  };

  const preview = async () => {
    await flush();
    window.open(`/p/${meta.public_token}`, "_blank", "noopener");
  };

  // ---------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------
  const saveLabel =
    save === "saving" || save === "pending" ? (
      <>
        <LoaderCircle size={13} className="pe-spin" /> Enregistrement…
      </>
    ) : save === "error" ? (
      <>
        <CircleAlert size={13} /> Non enregistré
      </>
    ) : save === "saved" ? (
      <>
        <Check size={13} /> Enregistré
      </>
    ) : (
      <>Modifiée {ago(meta.updated_at)}</>
    );

  const pricing = (
    <PricingEditor
      items={items}
      services={data.services}
      currency={meta.currency}
      discountPct={meta.discount_pct}
      taxPct={meta.tax_pct}
      onAdd={addItem}
      onChange={changeItem}
      onRemove={removeItem}
      onMove={moveItem}
    />
  );

  return (
    <div className="pe">
      <SetCrumbs items={[{ label: "Propositions", href: `${ws.base}/proposals` }, { label: `#${meta.number} ${meta.title || "Sans titre"}` }]} />

      <div className="pe-bar">
        <Link href={`${ws.base}/proposals`} className="btn btn-ghost btn-sm btn-icon" aria-label="Retour aux propositions">
          <ArrowLeft size={15} />
        </Link>
        <span className="mono faint">#{meta.number}</span>
        <Badge color={PROPOSAL_STATUS[status].color}>{PROPOSAL_STATUS[status].name}</Badge>
        <span className={`pe-save${save === "error" ? " err" : ""}`} aria-live="polite">
          {!locked && saveLabel}
          {locked && (
            <>
              <Lock size={12} /> Lecture seule
            </>
          )}
        </span>
        <div className="pe-bar-actions">
          {!locked && (
            <div className="seg pe-view" role="tablist" aria-label="Mode d'affichage">
              <button role="tab" aria-selected={view === "edit"} className={view === "edit" ? "on" : ""} onClick={() => setView("edit")}>
                Édition
              </button>
              <button role="tab" aria-selected={view === "preview"} className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>
                Rendu
              </button>
            </div>
          )}
          <button className="btn btn-sm" onClick={preview} title="Ouvre la page client dans un nouvel onglet">
            <ExternalLink size={13} />
            <span className="pe-hide-sm">Aperçu</span>
          </button>
          {meta.status === "accepted" && ws.canWrite && (
            <button className="btn btn-sm btn-primary" onClick={() => ui.create({ kind: "project", defaults: { company_id: meta.company_id, name: meta.title } })}>
              <FolderPlus size={13} />
              Créer le projet
            </button>
          )}
          {ws.canWrite && meta.status !== "accepted" && meta.status !== "declined" && (
            <button className="btn btn-sm btn-primary" onClick={() => setSendOpen(true)}>
              <Send size={13} />
              {meta.status === "draft" ? "Envoyer" : "Renvoyer"}
            </button>
          )}
          <Menu
            align="end"
            trigger={(open) => (
              <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label="Plus d'actions">
                <Ellipsis size={15} />
              </button>
            )}
            items={[
              { label: "Copier le lien client", icon: <Link2 size={14} />, onSelect: () => void copyLink() },
              ...(ws.canWrite
                ? [
                    { label: "Dupliquer", icon: <Copy size={14} />, onSelect: () => void duplicate() },
                    ...(meta.status !== "draft"
                      ? [{ label: "Repasser en brouillon", icon: <RotateCcw size={14} />, onSelect: () => void setStatus("draft") }]
                      : []),
                    { separator: true, label: "" },
                    { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDelete(true) },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      <div className="pe-layout">
        <div className="pe-main">
          {meta.status === "accepted" && (
            <div className="pe-banner ok">
              <Check size={15} />
              <span>
                Acceptée par <strong>{meta.accepted_name ?? "le client"}</strong>
                {meta.accepted_at && <> le {fmtDate(meta.accepted_at.slice(0, 10), true)}</>}. Le document est figé : duplique-le pour en faire une nouvelle version.
              </span>
            </div>
          )}
          {meta.status === "declined" && (
            <div className="pe-banner bad">
              <CircleAlert size={15} />
              <span>
                Refusée par le client{meta.declined_reason ? <> : « {meta.declined_reason} »</> : "."} Duplique-la pour retravailler une nouvelle version.
              </span>
            </div>
          )}
          {!locked && (meta.status === "sent" || meta.status === "viewed") && (
            <div className="pe-banner">
              <CircleAlert size={15} />
              <span>Déjà envoyée : tes modifications sont visibles immédiatement par le client.</span>
            </div>
          )}

          {locked || view === "preview" ? (
            <div className="pe-paper pe-paper-ro">
              <ProposalDocument
                data={{ ...meta, blocks }}
                items={items}
                agency={ws.workspace.name}
                client={company?.name}
                contact={contact ? contactName(contact) : null}
                selected={new Set(items.filter((i) => i.optional && i.selected).map((i) => i.id))}
              />
            </div>
          ) : (
            <div className="pe-paper">
              <header className="pd-head pe-head">
                <div className="pd-agency">
                  <span className="pd-mark" aria-hidden>
                    {ws.workspace.name.slice(0, 1).toUpperCase()}
                  </span>
                  {ws.workspace.name}
                </div>
                <p className="pd-kicker">Proposition commerciale n° {meta.number}</p>
                <input
                  className="input bare pd-title pe-title"
                  value={meta.title}
                  placeholder="Titre de la proposition"
                  aria-label="Titre de la proposition"
                  onChange={(e) => setField("title", e.target.value)}
                />
                <p className="pe-head-meta faint">
                  {company ? <>Pour {company.name}</> : "Aucun client"}
                  {contact && <>, à l&apos;attention de {contactName(contact)}</>}
                  {meta.valid_until && <> · valable jusqu&apos;au {fmtDate(meta.valid_until, true)}</>}
                </p>
              </header>
              <BlocksEditor blocks={blocks} onChange={changeBlocks} pricing={pricing} />
              {!blocks.some((b) => b.type === "pricing") && (
                <div className="pe-nopricing">
                  <p className="faint">
                    Le document ne contient pas de tableau de prix : il sera ajouté automatiquement à la fin de la page client
                    {items.length ? "" : " dès que tu auras des lignes"}.
                  </p>
                  {pricing}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="pe-panel" aria-label="Réglages de la proposition">
          <section className="pe-sec">
            <h3>Récapitulatif</h3>
            <div className="pe-sum">
              <div>
                <span className="faint">Mensuel HT</span>
                <strong className="num">{money(totals.monthly.net, meta.currency)}</strong>
              </div>
              <div>
                <span className="faint">Ponctuel HT</span>
                <strong className="num">{money(totals.one_off.net, meta.currency)}</strong>
              </div>
            </div>
            {totals.optionsLeft > 0 && <p className="pe-hint">+ {money(totals.optionsLeft, meta.currency)} HT d&apos;options proposées</p>}
          </section>

          <section className="pe-sec">
            <h3>Client</h3>
            <div className="pe-props">
              <span className="pe-k">Entreprise</span>
              <CompanyPicker
                value={meta.company_id}
                onChange={(v) => {
                  if (locked) return;
                  setField("company_id", v);
                  if (contact && contact.company_id !== v) setField("contact_id", null);
                }}
                trigger={locked ? () => <span className="pill">{company?.name ?? "Aucun"}</span> : undefined}
              />
              <span className="pe-k">Contact</span>
              <SelectPill
                value={meta.contact_id}
                options={contactOptions}
                onChange={(v) => setField("contact_id", v)}
                placeholder="Aucun"
                icon={<UserRound size={14} />}
                search="Contact…"
                disabled={locked}
              />
              <span className="pe-k">Deal lié</span>
              <SelectPill
                value={meta.deal_id}
                options={dealOptions}
                onChange={(v) => setField("deal_id", v)}
                placeholder="Aucun"
                icon={<Handshake size={14} />}
                search="Deal…"
                disabled={locked}
              />
              <span className="pe-k">Responsable</span>
              <AssigneePicker value={meta.owner_id} onChange={(v) => !locked && setField("owner_id", v)} />
            </div>
            {deal && (
              <Link className="pe-link" href={`${ws.base}/crm`}>
                Voir le deal <ExternalLink size={12} />
              </Link>
            )}
          </section>

          <section className="pe-sec">
            <h3>Conditions</h3>
            <div className="pe-props">
              <span className="pe-k">Validité</span>
              <DatePicker value={meta.valid_until} onChange={(v) => !locked && setField("valid_until", v)} placeholder="Sans limite" />
              <span className="pe-k">Devise</span>
              <select className="select pe-select" value={meta.currency} disabled={locked} onChange={(e) => setField("currency", e.target.value)} aria-label="Devise">
                {[...new Set([meta.currency, ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <label className="pe-k" htmlFor="pe-tax">
                TVA
              </label>
              <span className="pe-pct">
                <input
                  id="pe-tax"
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  disabled={locked}
                  value={meta.tax_pct}
                  onChange={(e) => setField("tax_pct", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                />
                %
              </span>
              <label className="pe-k" htmlFor="pe-disc">
                Remise
              </label>
              <span className="pe-pct">
                <input
                  id="pe-disc"
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  disabled={locked}
                  value={meta.discount_pct}
                  onChange={(e) => setField("discount_pct", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                />
                %
              </span>
              <span className="pe-k">Statut</span>
              {ws.canWrite ? (
                <Menu
                  trigger={(open) => (
                    <button type="button" className="pill" onClick={open}>
                      <Badge color={PROPOSAL_STATUS[status].color}>{PROPOSAL_STATUS[status].name}</Badge>
                    </button>
                  )}
                  items={STATUS_ORDER.filter((s) => s !== "expired").map((s) => ({
                    label: PROPOSAL_STATUS[s].name,
                    checked: s === meta.status,
                    onSelect: () => s !== meta.status && void setStatus(s),
                  }))}
                />
              ) : (
                <Badge color={PROPOSAL_STATUS[status].color}>{PROPOSAL_STATUS[status].name}</Badge>
              )}
            </div>
            {ws.canWrite && <p className="pe-hint">Le statut suit l&apos;envoi et la réponse du client. Change-le à la main seulement pour corriger.</p>}
          </section>

          <section className="pe-sec">
            <h3>Lien client</h3>
            <div className="pe-linkbox">
              <input className="input" readOnly value={url} aria-label="Lien public" onFocus={(e) => e.target.select()} />
              <button className="btn btn-icon" onClick={() => void copyLink()} aria-label="Copier le lien">
                <Copy size={14} />
              </button>
            </div>
            <p className="pe-hint">
              {meta.status === "draft"
                ? "Le lien s'active à l'envoi. En attendant, toi seul peux l'ouvrir (connecté) pour prévisualiser."
                : "Le client n'a pas besoin de compte. Ouvrir ce lien en étant connecté ne compte pas comme une vue."}
            </p>
          </section>

          <section className="pe-sec">
            <h3>Suivi</h3>
            <ol className="pe-track">
              <li className="on">
                <span />
                Créée le {fmtDate(meta.created_at.slice(0, 10), true)}
              </li>
              <li className={meta.sent_at ? "on" : ""}>
                <span />
                {meta.sent_at ? <>Envoyée {ago(meta.sent_at)}</> : "Pas encore envoyée"}
              </li>
              <li className={meta.viewed_at ? "on" : ""}>
                <span />
                {meta.viewed_at ? <>Vue par le client {ago(meta.viewed_at)}</> : "Pas encore ouverte"}
              </li>
              <li className={meta.accepted_at || meta.status === "declined" ? "on" : ""}>
                <span />
                {meta.status === "accepted" && meta.accepted_at ? (
                  <>
                    Acceptée par {meta.accepted_name} {ago(meta.accepted_at)}
                  </>
                ) : meta.status === "declined" ? (
                  "Refusée"
                ) : (
                  "En attente de réponse"
                )}
              </li>
            </ol>
          </section>
        </aside>
      </div>

      {sendOpen && (
        <SendModal
          first={meta.status === "draft"}
          email={contact?.email ?? ""}
          contactLabel={contact ? contactName(contact) : null}
          url={url}
          hasItems={items.length > 0}
          onClose={() => setSendOpen(false)}
          onEmail={async () => {
            const ok = await markSent();
            if (!ok) return;
            await copyLink(true);
            window.location.href = mailto();
            toast(meta.status === "draft" ? "Proposition envoyée, lien copié" : "Lien copié");
            setSendOpen(false);
          }}
          onCopy={async () => {
            const ok = await markSent();
            if (!ok) return;
            await copyLink(true);
            toast(meta.status === "draft" ? "Proposition marquée envoyée, lien copié" : "Lien copié");
            setSendOpen(false);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Supprimer la proposition ?"
          text={`« ${meta.title} » et son lien client seront supprimés définitivement.`}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function SendModal({
  first,
  email,
  contactLabel,
  url,
  hasItems,
  onClose,
  onEmail,
  onCopy,
}: {
  first: boolean;
  email: string;
  contactLabel: string | null;
  url: string;
  hasItems: boolean;
  onClose: () => void;
  onEmail: () => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  return (
    <Modal
      title={first ? "Envoyer la proposition" : "Renvoyer la proposition"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={run(onCopy)} disabled={busy}>
            <Copy size={14} />
            Copier le lien seulement
          </button>
          <button className="btn btn-primary" onClick={run(onEmail)} disabled={busy} autoFocus>
            <Mail size={14} />
            {email ? "Préparer l'email" : "Ouvrir un email"}
          </button>
        </>
      }
    >
      <p className="muted">
        {first
          ? "La proposition passe en « Envoyée », le lien client est copié et un email pré-rempli s'ouvre dans ta messagerie. Tu seras prévenu quand le client l'ouvrira et quand il répondra."
          : "Le lien client est copié et un email de relance pré-rempli s'ouvre dans ta messagerie."}
      </p>
      <div className="pe-send-to">
        <span className="faint">Destinataire</span>
        {email ? (
          <span>
            {contactLabel} <span className="faint">&lt;{email}&gt;</span>
          </span>
        ) : (
          <span className="pe-warn">Aucun email de contact : tu pourras saisir l&apos;adresse dans ta messagerie.</span>
        )}
      </div>
      <div className="pe-linkbox">
        <input className="input" readOnly value={url} aria-label="Lien public" onFocus={(e) => e.target.select()} />
      </div>
      {!hasItems && <p className="pe-warn">Attention : aucune ligne de prix pour l&apos;instant.</p>}
    </Modal>
  );
}
