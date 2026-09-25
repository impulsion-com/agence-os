"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, UserRound } from "lucide-react";

import { AssigneePicker, DatePicker } from "@/components/pickers";
import { Modal, Popover } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { logActivity, must, useWorkspace } from "@/lib/workspace/context";
import type { Billing, Contact, PipelineStage, Service } from "@/lib/types";
import { colorForName, contactName } from "./lib";
import { ComboList, CompanyMark, ServicesPicker, SourcePicker, StagePicker } from "./shared";

export interface DealDefaults {
  company_id?: string | null;
  contact_id?: string | null;
  stage_id?: string | null;
}

type Co = { id: string; name: string; color: string; status: string };

export function DealCreateModal({ defaults, onClose }: { defaults?: DealDefaults; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [extraCos, setExtraCos] = useState<Co[]>([]);

  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(defaults?.company_id ?? null);
  const [contactId, setContactId] = useState<string | null>(defaults?.contact_id ?? null);
  const [stageId, setStageId] = useState<string | null>(defaults?.stage_id ?? null);
  const [value, setValue] = useState("");
  const [valueTouched, setValueTouched] = useState(false);
  const [billing, setBilling] = useState<Billing>("monthly");
  const [svc, setSvc] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [close, setClose] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(ws.me.id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    const id = ws.workspace.id;
    let alive = true;
    Promise.all([
      sb.from("pipeline_stages").select("*").eq("workspace_id", id).order("position"),
      sb.from("services").select("*").eq("workspace_id", id).eq("archived", false).order("position"),
      sb.from("contacts").select("*").eq("workspace_id", id).order("first_name"),
    ]).then(([st, sv, ct]) => {
      if (!alive) return;
      const s = (st.data ?? []) as PipelineStage[];
      setStages(s);
      setStageId((cur) => cur ?? s.find((x) => x.kind === "open")?.id ?? s[0]?.id ?? null);
      setServices((sv.data ?? []) as Service[]);
      setContacts((ct.data ?? []) as Contact[]);
    });
    return () => {
      alive = false;
    };
  }, [ws.workspace.id]);

  const companies: Co[] = useMemo(() => [...ws.companies, ...extraCos.filter((e) => !ws.companies.some((c) => c.id === e.id))], [ws.companies, extraCos]);
  const company = companies.find((c) => c.id === companyId);
  const contact = contacts.find((c) => c.id === contactId);
  const coContacts = companyId ? contacts.filter((c) => c.company_id === companyId) : contacts;

  // Valeur proposée à partir des services cochés, tant que l'utilisateur ne l'a pas saisie
  const pickServices = (names: string[]) => {
    setSvc(names);
    if (valueTouched) return;
    const picked = services.filter((s) => names.includes(s.name));
    const monthly = picked.filter((s) => s.billing === "monthly");
    const base = monthly.length ? monthly : picked;
    setValue(base.length ? String(base.reduce((a, s) => a + Number(s.unit_price), 0)) : "");
    if (picked.length) setBilling(monthly.length ? "monthly" : "one_off");
  };

  const createCompany = async (name: string) => {
    const sb = supabaseBrowser();
    const color = colorForName(name);
    const { data, error } = await sb
      .from("companies")
      .insert({ workspace_id: ws.workspace.id, name, status: "lead", owner_id: ws.me.id, color })
      .select("id, name, color, status")
      .single();
    if (error) return toast(error.message, { error: true });
    setExtraCos((x) => [...x, data as Co]);
    setCompanyId(data.id);
    setContactId(null);
    toast(`${name} ajouté aux prospects`);
  };

  const createContact = async (full: string) => {
    const [first, ...rest] = full.split(/\s+/);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("contacts")
      .insert({ workspace_id: ws.workspace.id, company_id: companyId, first_name: first, last_name: rest.join(" ") })
      .select("*")
      .single();
    if (error) return toast(error.message, { error: true });
    setContacts((x) => [...x, data as Contact]);
    setContactId(data.id);
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      const stage = stages.find((s) => s.id === stageId);
      const first = stageId
        ? (await sb.from("deals").select("position").eq("stage_id", stageId).order("position").limit(1)).data?.[0]
        : undefined;
      const deal = must(
        await sb
          .from("deals")
          .insert({
            workspace_id: ws.workspace.id,
            title: title.trim(),
            company_id: companyId,
            contact_id: contactId,
            stage_id: stageId,
            owner_id: owner,
            value: Number(value.replace(",", ".")) || 0,
            billing,
            services: svc,
            source,
            expected_close: close,
            position: first ? Number(first.position) - 1000 : 1000,
            closed_at: stage && stage.kind !== "open" ? new Date().toISOString() : null,
          })
          .select("id")
          .single(),
      )!;
      await logActivity(sb, { workspace_id: ws.workspace.id, verb: "deal.created", deal_id: deal.id, meta: { title: title.trim(), stage: stage?.name ?? null } });
      toast("Deal créé", { action: { label: "Ouvrir", run: () => router.push(`${ws.base}/crm/deals/${deal.id}`) } });
      router.refresh();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouveau deal"
      onClose={onClose}
      footer={
        <>
          <span className="faint crm-kbd-hint" style={{ marginRight: "auto", fontSize: "var(--fs-xs)" }}>
            <kbd>⌘</kbd> <kbd>Entrée</kbd> pour créer
          </span>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!title.trim() || busy} onClick={submit}>
            Créer le deal
          </button>
        </>
      }
    >
      <form
        className="crm-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <input
          className="input bare crm-title-input"
          autoFocus
          placeholder="Nom du deal, ex. Gestion Meta Ads + créas"
          aria-label="Nom du deal"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="crm-form-grid">
          <div className="field">
            <span className="label">Entreprise</span>
            <Popover
              width={280}
              trigger={(open) => (
                <button type="button" className={`pill bordered crm-field-pill${company ? "" : " empty"}`} onClick={open}>
                  {company ? <CompanyMark name={company.name} color={company.color} size={16} /> : <Building2 size={14} />}
                  <span className="trunc">{company?.name ?? "Choisir ou créer"}</span>
                </button>
              )}
            >
              {(c) => (
                <ComboList
                  placeholder="Client ou prospect…"
                  value={companyId}
                  none="Aucune"
                  items={companies.map((x) => ({
                    id: x.id,
                    label: x.name,
                    icon: <CompanyMark name={x.name} color={x.color} size={16} />,
                    sub: x.status === "client" ? "client" : x.status === "lead" ? "prospect" : "ancien",
                  }))}
                  onPick={(id) => {
                    setCompanyId(id);
                    if (id && contact && contact.company_id !== id) setContactId(null);
                    if (!contactId && id) {
                      const only = contacts.filter((k) => k.company_id === id);
                      if (only.length === 1) setContactId(only[0].id);
                    }
                    c();
                  }}
                  onCreate={(q) => {
                    c();
                    createCompany(q);
                  }}
                  createLabel={(q) => `Créer le prospect « ${q} »`}
                />
              )}
            </Popover>
          </div>
          <div className="field">
            <span className="label">Contact</span>
            <Popover
              width={280}
              trigger={(open) => (
                <button type="button" className={`pill bordered crm-field-pill${contact ? "" : " empty"}`} onClick={open}>
                  <UserRound size={14} />
                  <span className="trunc">{contact ? contactName(contact) : "Choisir ou créer"}</span>
                </button>
              )}
            >
              {(c) => (
                <ComboList
                  placeholder={company ? `Contact chez ${company.name}…` : "Contact…"}
                  value={contactId}
                  none="Aucun"
                  items={coContacts.map((x) => ({ id: x.id, label: contactName(x), sub: x.job_title }))}
                  onPick={(id) => {
                    setContactId(id);
                    const k = contacts.find((x) => x.id === id);
                    if (k?.company_id && !companyId) setCompanyId(k.company_id);
                    c();
                  }}
                  onCreate={(q) => {
                    c();
                    createContact(q);
                  }}
                  createLabel={(q) => `Créer le contact « ${q} »`}
                />
              )}
            </Popover>
          </div>

          <div className="field">
            <label htmlFor="deal-value">Valeur</label>
            <div className="crm-money">
              <input
                id="deal-value"
                className="input num"
                inputMode="decimal"
                placeholder="0"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value.replace(/[^\d.,]/g, ""));
                  setValueTouched(true);
                }}
              />
              <div className="seg" role="radiogroup" aria-label="Facturation">
                <button type="button" role="radio" aria-checked={billing === "monthly"} className={billing === "monthly" ? "on" : ""} onClick={() => setBilling("monthly")}>
                  Mensuel
                </button>
                <button type="button" role="radio" aria-checked={billing === "one_off"} className={billing === "one_off" ? "on" : ""} onClick={() => setBilling("one_off")}>
                  Ponctuel
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <span className="label">Étape</span>
            <StagePicker
              stages={stages}
              value={stageId}
              onChange={setStageId}
              trigger={(open) => {
                const s = stages.find((x) => x.id === stageId);
                return (
                  <button type="button" className="pill bordered crm-field-pill" onClick={open}>
                    <i className="crm-dot" style={{ ["--c" as string]: s?.color }} />
                    <span className="trunc">{s?.name ?? "Chargement…"}</span>
                    {s && s.kind === "open" && <span className="faint num" style={{ marginLeft: "auto" }}>{s.probability} %</span>}
                  </button>
                );
              }}
            />
          </div>
        </div>

        <div className="field">
          <span className="label">Services</span>
          <div>
            <ServicesPicker services={services} value={svc} onChange={pickServices} currency={ws.workspace.currency} />
          </div>
        </div>

        <div className="crm-form-row">
          <SourcePicker value={source} onChange={setSource} />
          <DatePicker value={close} onChange={setClose} placeholder="Closing prévu" />
          <AssigneePicker value={owner} onChange={setOwner} />
        </div>
      </form>
    </Modal>
  );
}
