"use client";

import "@/styles/proposals.css";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake, UserRound } from "lucide-react";

import { CompanyPicker } from "@/components/pickers";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import type { Json } from "@/lib/database.types";
import { dayOffset } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Contact, Deal, Service } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { SelectPill } from "./fields";
import { PROPOSAL_TEMPLATES } from "./lib";

export interface ProposalDefaults {
  company_id?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
}

type ContactLite = Pick<Contact, "id" | "first_name" | "last_name" | "email" | "company_id">;
type DealLite = Pick<Deal, "id" | "title" | "company_id" | "contact_id">;

export const contactName = (c: Pick<Contact, "first_name" | "last_name" | "email">) =>
  `${c.first_name} ${c.last_name}`.trim() || c.email || "Sans nom";

export function ProposalCreateModal({ defaults, onClose }: { defaults?: ProposalDefaults; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [companyId, setCompanyId] = useState<string | null>(defaults?.company_id ?? null);
  const [contactId, setContactId] = useState<string | null>(defaults?.contact_id ?? null);
  const [dealId, setDealId] = useState<string | null>(defaults?.deal_id ?? null);
  const [tpl, setTpl] = useState(PROPOSAL_TEMPLATES[0].id);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [busy, setBusy] = useState(false);

  // Contacts et deals de l'espace, chargés à l'ouverture
  useEffect(() => {
    const sb = supabaseBrowser();
    let alive = true;
    Promise.all([
      sb.from("contacts").select("id, first_name, last_name, email, company_id").eq("workspace_id", ws.workspace.id).order("first_name"),
      sb.from("deals").select("id, title, company_id, contact_id, closed_at").eq("workspace_id", ws.workspace.id).order("created_at", { ascending: false }),
    ]).then(([c, d]) => {
      if (!alive) return;
      setContacts((c.data ?? []) as ContactLite[]);
      const dl = (d.data ?? []) as (DealLite & { closed_at: string | null })[];
      setDeals(dl.filter((x) => !x.closed_at || x.id === defaults?.deal_id));
      // Deal pré-rempli : on complète client et contact depuis le deal
      const pre = dl.find((x) => x.id === defaults?.deal_id);
      if (pre) {
        setCompanyId((v) => v ?? pre.company_id);
        setContactId((v) => v ?? pre.contact_id);
      }
    });
    return () => {
      alive = false;
    };
  }, [ws.workspace.id, defaults?.deal_id]);

  const template = PROPOSAL_TEMPLATES.find((x) => x.id === tpl)!;
  const company = ws.company(companyId);
  const autoTitle = [template.title || "Proposition", company?.name].filter(Boolean).join(" · ");
  const finalTitle = (titleTouched ? title : autoTitle).trim();

  const contactOptions = useMemo(
    () =>
      contacts
        .filter((c) => !companyId || c.company_id === companyId)
        .map((c) => ({ id: c.id, label: contactName(c), sub: c.email })),
    [contacts, companyId],
  );
  const dealOptions = useMemo(
    () => deals.filter((d) => !companyId || d.company_id === companyId).map((d) => ({ id: d.id, label: d.title })),
    [deals, companyId],
  );

  const pickCompany = (id: string | null) => {
    setCompanyId(id);
    if (contactId && contacts.find((c) => c.id === contactId)?.company_id !== id) setContactId(null);
    if (dealId && deals.find((d) => d.id === dealId)?.company_id !== id) setDealId(null);
  };
  const pickDeal = (id: string | null) => {
    setDealId(id);
    const d = deals.find((x) => x.id === id);
    if (d) {
      if (d.company_id) setCompanyId(d.company_id);
      if (d.contact_id) setContactId(d.contact_id);
    }
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!finalTitle || busy) return;
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      const { data: prop, error } = await sb
        .from("proposals")
        .insert({
          workspace_id: ws.workspace.id,
          title: finalTitle,
          company_id: companyId,
          contact_id: contactId,
          deal_id: dealId,
          currency: ws.workspace.currency || "EUR",
          valid_until: dayOffset(30),
          blocks: template.blocks() as unknown as Json,
          number: undefined as unknown as number, // attribué par le déclencheur
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      if (template.lines.length) {
        const { data: services } = await sb
          .from("services")
          .select("id, name, description, unit_price, billing, position, archived")
          .eq("workspace_id", ws.workspace.id);
        const byName = new Map(((services ?? []) as Service[]).map((s) => [s.name.toLowerCase(), s]));
        const rows = template.lines.map((l, i) => {
          const s = byName.get(l.service.toLowerCase());
          return {
            proposal_id: prop.id,
            service_id: s?.id ?? null,
            name: s?.name ?? l.service,
            description: s?.description ?? l.fallback.description,
            unit_price: s ? Number(s.unit_price) : l.fallback.unit_price,
            billing: s?.billing ?? l.fallback.billing,
            quantity: 1,
            optional: !!l.optional,
            selected: !l.optional,
            position: i,
          };
        });
        const r = await sb.from("proposal_items").insert(rows);
        if (r.error) throw new Error(r.error.message);
      }
      onClose();
      router.push(`${ws.base}/proposals/${prop.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Création impossible", { error: true });
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouvelle proposition"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ marginRight: "auto", fontSize: "var(--fs-xs)" }}>
            Valable 30 jours, modifiable ensuite
          </span>
          <button className="btn" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" type="submit" form="proposal-create" disabled={!finalTitle || busy}>
            {busy ? "Création…" : "Créer et rédiger"}
          </button>
        </>
      }
    >
      <form id="proposal-create" onSubmit={submit} className="pc-form">
        <input
          className="input bare pc-title"
          autoFocus
          placeholder={autoTitle || "Titre de la proposition"}
          aria-label="Titre de la proposition"
          value={titleTouched ? title : autoTitle}
          onChange={(e) => {
            setTitleTouched(true);
            setTitle(e.target.value);
          }}
        />
        <div className="pc-pills">
          <CompanyPicker value={companyId} onChange={pickCompany} />
          <SelectPill
            value={contactId}
            options={contactOptions}
            onChange={setContactId}
            placeholder="Contact"
            icon={<UserRound size={14} />}
            search="Contact…"
          />
          <SelectPill
            value={dealId}
            options={dealOptions}
            onChange={pickDeal}
            placeholder="Deal lié"
            icon={<Handshake size={14} />}
            search="Deal…"
          />
        </div>

        <fieldset className="pc-tpls">
          <legend className="label">Modèle de départ</legend>
          <div className="pc-grid" role="radiogroup">
            {PROPOSAL_TEMPLATES.map((x) => (
              <label key={x.id} className={`pc-tpl${tpl === x.id ? " on" : ""}`}>
                <input type="radio" name="tpl" className="sr" checked={tpl === x.id} onChange={() => setTpl(x.id)} />
                <span className="pc-tpl-ic">
                  <Icon name={x.icon} size={16} />
                </span>
                <span>
                  <strong>{x.name}</strong>
                  <span className="faint">{x.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="hint faint">Chaque modèle pré-remplit les sections rédigées et les lignes de prix depuis ton catalogue de services.</p>
        </fieldset>
      </form>
    </Modal>
  );
}
