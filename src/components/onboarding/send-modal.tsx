"use client";

import "@/styles/onboarding.css";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Copy, ExternalLink, ListChecks, Send } from "lucide-react";

import { CompanyPicker } from "@/components/pickers";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { missingVars, questionCount } from "@/lib/onboarding/logic";
import type { OnboardingSettings, OnboardingTemplate } from "@/lib/onboarding/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import { copyText, formUrl, sendForm, useOrigin, type SendResult } from "./shared";

interface ContactLite {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Bouton « Envoyer l'onboarding » à poser sur une fiche client (CRM) :
 *   <SendOnboardingButton companyId={company.id} />
 */
export function SendOnboardingButton({ companyId, contactId, className = "btn", label = "Envoyer l'onboarding" }: { companyId?: string | null; contactId?: string | null; className?: string; label?: string }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!ws.canWrite) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <ListChecks size={14} />
        {label}
      </button>
      {open && <SendOnboardingModal companyId={companyId} contactId={contactId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Modale d'envoi : client, contact, modèle, message et automatisations.
 * Charge elle-même modèles et réglages : utilisable depuis n'importe quelle page de l'espace.
 */
export function SendOnboardingModal({
  companyId, contactId, onClose, emailOn,
}: {
  companyId?: string | null;
  contactId?: string | null;
  onClose: () => void;
  emailOn?: boolean;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const origin = useOrigin();
  const [templates, setTemplates] = useState<OnboardingTemplate[] | null>(null);
  const [settings, setSettings] = useState<OnboardingSettings | null>(null);
  const [company, setCompany] = useState<string | null>(companyId ?? null);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [contact, setContact] = useState<string>(contactId ?? "");
  const [industry, setIndustry] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [intro, setIntro] = useState<string | null>(null);
  const [opts, setOpts] = useState<{ project: boolean; kpis: boolean; company: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; url: string; result: SendResult | null; error?: string } | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("onboarding_templates").select("*").eq("workspace_id", ws.workspace.id).eq("archived", false).order("position").order("created_at"),
      sb.from("onboarding_settings").select("*").eq("workspace_id", ws.workspace.id).maybeSingle(),
    ]).then(([t, s]) => {
      setTemplates((t.data ?? []) as unknown as OnboardingTemplate[]);
      setSettings((s.data as OnboardingSettings | null) ?? null);
    });
  }, [ws.workspace.id]);

  useEffect(() => {
    if (!company) return;
    let alive = true;
    void supabaseBrowser()
      .from("companies")
      .select("industry")
      .eq("id", company)
      .maybeSingle()
      .then(({ data }) => alive && setIndustry(data?.industry ?? ""));
    void supabaseBrowser()
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("company_id", company)
      .order("created_at")
      .then(({ data }) => {
        if (!alive) return;
        const list = data ?? [];
        setContacts(list);
        setContact((c) => (list.some((x) => x.id === c) ? c : (list.find((x) => x.email)?.id ?? list[0]?.id ?? "")));
      });
    return () => {
      alive = false;
    };
  }, [company]);

  const companyObj = ws.company(company);
  // Modèle suggéré selon le secteur du client (tant qu'aucun n'a été choisi)
  const suggested = useMemo(() => {
    if (!templates?.length) return null;
    const key = /e-?commerce/i.test(industry) ? "ecommerce" : /local|restauration|santé/i.test(industry) ? "local" : industry ? "leads" : null;
    return (key && templates.find((t) => t.key === key)?.id) || templates[0].id;
  }, [templates, industry]);
  const tplId = templateId ?? suggested;
  const tpl = templates?.find((t) => t.id === tplId) ?? null;
  const options = opts ?? { project: settings?.auto_project ?? true, kpis: settings?.auto_kpis ?? true, company: settings?.auto_company ?? true };
  const message = intro ?? settings?.intro ?? "";
  const contactObj = company ? contacts.find((c) => c.id === contact) : undefined;
  const missing = tpl
    ? missingVars(tpl.sections, { name: ws.workspace.name, meta_business_id: settings?.meta_business_id ?? "", google_mcc_id: settings?.google_mcc_id ?? "", access_email: settings?.access_email ?? "" })
    : [];
  const willEmail = emailOn !== false && !!contactObj?.email;

  async function create() {
    if (!company || !tpl) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("onboarding_forms")
      .insert({
        workspace_id: ws.workspace.id,
        template_id: tpl.id,
        company_id: company,
        contact_id: contactObj?.id ?? null,
        title: `${tpl.name} · ${companyObj?.name ?? "Client"}`,
        intro: message.trim(),
        sections: JSON.parse(JSON.stringify(tpl.sections)),
        options,
      })
      .select("id, token")
      .single();
    if (error || !data) {
      setBusy(false);
      toast(error?.message ?? "Création impossible", { error: true });
      return;
    }
    const url = formUrl(origin, data.token);
    let result: SendResult | null = null;
    let err: string | undefined;
    if (contactObj?.email) {
      try {
        result = await sendForm(data.id);
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
    }
    setBusy(false);
    setDone({ id: data.id, url, result, error: err ?? result?.error });
    router.refresh();
  }

  if (done) {
    const emailed = !!done.result?.sent;
    return (
      <Modal
        title="Formulaire prêt"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>
              Fermer
            </button>
            <Link className="btn btn-primary" href={`${ws.base}/onboarding/${done.id}`} onClick={onClose}>
              Voir le suivi
            </Link>
          </>
        }
      >
        <div className="onb-sent">
          <span className="onb-sent-ic">{emailed ? <Send size={20} /> : <CircleCheck size={22} />}</span>
          <strong>{emailed ? `Email envoyé à ${done.result?.email}` : "Lien créé"}</strong>
          <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
            {emailed
              ? "Le client peut remplir le formulaire en plusieurs fois avec le même lien. Tu seras notifié dès qu'il l'aura terminé."
              : done.error && done.result?.emailEnabled !== false
                ? `L'email n'est pas parti (${done.error}). Copie le lien et envoie-le toi-même.`
                : "L'envoi d'emails n'est pas configuré sur cet espace : copie le lien et envoie-le au client (email, WhatsApp, Slack…)."}
          </p>
        </div>
        <div className="onb-linkbox">
          <input className="input" readOnly value={done.url} onFocus={(e) => e.target.select()} aria-label="Lien du formulaire" />
          <button
            className="btn"
            onClick={async () => toast((await copyText(done.url)) ? "Lien copié" : "Copie impossible, sélectionne le lien", { error: false })}
          >
            <Copy size={14} />
            Copier
          </button>
          <a className="btn btn-icon" href={done.url} target="_blank" rel="noreferrer" aria-label="Ouvrir le formulaire" title="Ouvrir (aperçu)">
            <ExternalLink size={14} />
          </a>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Envoyer un formulaire d'onboarding"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ marginRight: "auto", fontSize: "var(--fs-xs)" }}>
            {willEmail ? `Envoyé par email à ${contactObj?.email}` : "Tu obtiendras un lien à copier"}
          </span>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={!company || !tpl || busy} onClick={() => void create()}>
            <Send size={14} />
            {busy ? "Création…" : willEmail ? "Envoyer" : "Créer le lien"}
          </button>
        </>
      }
    >
      <div className="onb-grid2">
        <div className="field">
          <span className="label">Client</span>
          <CompanyPicker
            value={company}
            allowNone={false}
            onChange={setCompany}
            trigger={(open) => (
              <button type="button" className="select" style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 8 }} onClick={open}>
                {companyObj ? <span className="trunc">{companyObj.name}</span> : <span className="faint">Choisir un client…</span>}
              </button>
            )}
          />
        </div>
        <div className="field">
          <label htmlFor="onb-contact">Contact destinataire</label>
          <select id="onb-contact" className="select" value={contact} disabled={!company} onChange={(e) => setContact(e.target.value)}>
            <option value="">Aucun (lien à copier)</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.first_name} ${c.last_name}`.trim() || c.email}
                {c.email ? ` · ${c.email}` : " · sans email"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <span className="label">Modèle</span>
        {templates === null ? (
          <span className="sk" style={{ height: 58, width: "100%" }} />
        ) : templates.length === 0 ? (
          <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
            Aucun modèle actif. <Link href={`${ws.base}/onboarding?tab=templates`} onClick={onClose} style={{ textDecoration: "underline" }}>Crée ou restaure un modèle</Link>.
          </p>
        ) : (
          <div className="onb-send-tpls" role="radiogroup" aria-label="Modèle">
            {templates.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={t.id === tplId} className={`onb-send-tpl${t.id === tplId ? " on" : ""}`} onClick={() => setTemplateId(t.id)}>
                <span className="obj-ic" style={{ ["--s" as string]: "26px", ["--c" as string]: "var(--accent)" }}>
                  <Icon name={t.icon} size={15} />
                </span>
                <span>
                  <strong>{t.name}</strong>
                  <span>
                    {t.sections.length} étapes · {questionCount(t.sections)} questions
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="onb-warn">
          <CircleAlert size={15} />
          <span>
            Ce modèle affiche au client {missing.map((m) => (/^[A-Z]{2}/.test(m.label) ? m.label : m.label[0].toLowerCase() + m.label.slice(1))).join(", ")}, pas encore renseigné{missing.length > 1 ? "s" : ""}.{" "}
            <Link href={`${ws.base}/onboarding?tab=settings`} onClick={onClose} style={{ textDecoration: "underline" }}>
              Compléter les réglages
            </Link>
          </span>
        </div>
      )}

      <div className="field">
        <label htmlFor="onb-intro">Message d&apos;accueil (facultatif)</label>
        <textarea
          id="onb-intro"
          className="textarea"
          rows={3}
          placeholder="Affiché en haut du formulaire et dans l'email. Vouvoie ton client."
          value={message}
          onChange={(e) => setIntro(e.target.value)}
        />
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}>
        <legend className="label" style={{ marginBottom: 8 }}>
          Quand le client a terminé
        </legend>
        <label className="onb-toggle-row">
          <input type="checkbox" className="toggle" checked={options.project} onChange={(e) => setOpts({ ...options, project: e.target.checked })} />
          <span>
            Créer le projet d&apos;onboarding et les tâches de vérification des accès
            <small>Modèle « Onboarding client » si le client n&apos;a aucun projet actif, sinon les tâches vont dans son projet en cours.</small>
          </span>
        </label>
        <label className="onb-toggle-row">
          <input type="checkbox" className="toggle" checked={options.kpis} onChange={(e) => setOpts({ ...options, kpis: e.target.checked })} />
          <span>
            Enregistrer les KPI cibles (CPA, ROAS) dans le reporting du client
          </span>
        </label>
        <label className="onb-toggle-row">
          <input type="checkbox" className="toggle" checked={options.company} onChange={(e) => setOpts({ ...options, company: e.target.checked })} />
          <span>Compléter le site web et le secteur de la fiche client s&apos;ils sont vides</span>
        </label>
      </fieldset>
    </Modal>
  );
}
