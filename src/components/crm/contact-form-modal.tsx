"use client";

import { useState } from "react";

import { CompanyPicker } from "@/components/pickers";
import { Modal } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Contact } from "@/lib/types";

// Création ou édition d'un contact
export function ContactFormModal({
  contact,
  companyId,
  onClose,
  onSaved,
}: {
  contact?: Contact;
  companyId?: string | null;
  onClose: () => void;
  onSaved?: (c: Contact) => void;
}) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [f, setF] = useState({
    first_name: contact?.first_name ?? "",
    last_name: contact?.last_name ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    job_title: contact?.job_title ?? "",
    notes: contact?.notes ?? "",
    company_id: contact?.company_id ?? companyId ?? null,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const ok = !!(f.first_name.trim() || f.last_name.trim());
  const emailBad = !!f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());

  const submit = async () => {
    if (!ok || busy || emailBad) return;
    setBusy(true);
    const row = { ...f, first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim(), phone: f.phone.trim(), job_title: f.job_title.trim() };
    const res = await mutate(
      async (sb) =>
        contact
          ? must(await sb.from("contacts").update(row).eq("id", contact.id).select("*").single())
          : must(await sb.from("contacts").insert({ ...row, workspace_id: ws.workspace.id }).select("*").single()),
      { success: contact ? "Contact mis à jour" : "Contact ajouté" },
    );
    setBusy(false);
    if (res) {
      onSaved?.(res as Contact);
      onClose();
    }
  };

  return (
    <Modal
      title={contact ? "Modifier le contact" : "Nouveau contact"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!ok || busy || emailBad} onClick={submit}>
            {contact ? "Enregistrer" : "Ajouter"}
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
      >
        <div className="crm-form-grid">
          <div className="field">
            <label htmlFor="ct-first">Prénom</label>
            <input id="ct-first" className="input" autoFocus value={f.first_name} onChange={set("first_name")} />
          </div>
          <div className="field">
            <label htmlFor="ct-last">Nom</label>
            <input id="ct-last" className="input" value={f.last_name} onChange={set("last_name")} />
          </div>
          <div className="field">
            <label htmlFor="ct-email">Email</label>
            <input id="ct-email" className="input" type="email" value={f.email} onChange={set("email")} placeholder="prenom@entreprise.fr" />
            {emailBad && <span className="err">Cet email ne semble pas valide.</span>}
          </div>
          <div className="field">
            <label htmlFor="ct-phone">Téléphone</label>
            <input id="ct-phone" className="input" type="tel" value={f.phone} onChange={set("phone")} placeholder="06 12 34 56 78" />
          </div>
          <div className="field">
            <label htmlFor="ct-job">Poste</label>
            <input id="ct-job" className="input" value={f.job_title} onChange={set("job_title")} placeholder="Ex. Responsable marketing" />
          </div>
          <div className="field">
            <span className="label">Entreprise</span>
            <div>
              <CompanyPicker value={f.company_id} onChange={(company_id) => setF({ ...f, company_id })} />
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ct-notes">Notes</label>
          <textarea id="ct-notes" className="textarea" rows={3} value={f.notes} onChange={set("notes")} placeholder="Comment tu l'as rencontré, ce qui compte pour lui…" />
        </div>
      </form>
    </Modal>
  );
}
