"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AssigneePicker } from "@/components/pickers";
import { Modal } from "@/components/ui/overlay";
import { COLORS, INDUSTRIES } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Company } from "@/lib/types";
import { COMPANY_STATUSES, colorForName } from "./lib";

// Création (ou édition) d'une entreprise : client, prospect ou ancien client.
export function CompanyFormModal({ company, onClose, onSaved }: { company?: Company; onClose: () => void; onSaved?: (id: string) => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const router = useRouter();
  const [name, setName] = useState(company?.name ?? "");
  const [website, setWebsite] = useState(company?.website ?? "");
  const [industry, setIndustry] = useState(company?.industry ?? "");
  const [status, setStatus] = useState<Company["status"]>(company?.status ?? "lead");
  const [owner, setOwner] = useState<string | null>(company?.owner_id ?? ws.me.id);
  const [retainer, setRetainer] = useState(company?.monthly_retainer ? String(company.monthly_retainer) : "");
  const [color, setColor] = useState<string | null>(company?.color ?? null);
  const [busy, setBusy] = useState(false);
  const shownColor = color ?? colorForName(name || "A");

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const row = {
      name: name.trim(),
      website: website.trim(),
      industry,
      status,
      owner_id: owner,
      monthly_retainer: retainer ? Number(retainer.replace(",", ".")) || null : null,
      color: shownColor,
    };
    const res = await mutate(
      async (sb) =>
        company
          ? must(await sb.from("companies").update(row).eq("id", company.id).select("id").single())
          : must(await sb.from("companies").insert({ ...row, workspace_id: ws.workspace.id }).select("id").single()),
      { success: company ? "Entreprise mise à jour" : `${name.trim()} ajouté` },
    );
    setBusy(false);
    if (res) {
      onClose();
      if (onSaved) onSaved(res.id);
      else if (!company) router.push(`${ws.base}/crm/companies/${res.id}`);
    }
  };

  return (
    <Modal
      title={company ? "Modifier l'entreprise" : "Nouvelle entreprise"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={submit}>
            {company ? "Enregistrer" : "Créer"}
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
        <div className="field">
          <label htmlFor="co-name">Nom</label>
          <input id="co-name" className="input" autoFocus value={name} placeholder="Ex. Maison Lumen" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="crm-form-grid">
          <div className="field">
            <label htmlFor="co-site">Site web</label>
            <input id="co-site" className="input" value={website} placeholder="maisonlumen.fr" onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="co-industry">Secteur</label>
            <select id="co-industry" className="select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">Non renseigné</option>
              {[...INDUSTRIES, ...(industry && !INDUSTRIES.includes(industry) ? [industry] : [])].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="label">Statut</span>
            <div className="seg" role="radiogroup" aria-label="Statut">
              {COMPANY_STATUSES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={status === s.id} className={status === s.id ? "on" : ""} onClick={() => setStatus(s.id)}>
                  <i className="crm-dot" style={{ ["--c" as string]: s.color }} /> {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="co-ret">Retainer mensuel</label>
            <input id="co-ret" className="input num" inputMode="decimal" value={retainer} placeholder="0" onChange={(e) => setRetainer(e.target.value.replace(/[^\d.,]/g, ""))} />
          </div>
          <div className="field">
            <span className="label">Responsable</span>
            <div><AssigneePicker value={owner} onChange={setOwner} /></div>
          </div>
          <div className="field">
            <span className="label">Couleur</span>
            <div className="crm-colors" role="radiogroup" aria-label="Couleur">
              {Object.values(COLORS).slice(0, 10).map((h) => (
                <button
                  key={h}
                  type="button"
                  role="radio"
                  aria-checked={shownColor.toLowerCase() === h.toLowerCase()}
                  aria-label={`Couleur ${h}`}
                  className={`crm-swatch${shownColor.toLowerCase() === h.toLowerCase() ? " on" : ""}`}
                  style={{ ["--c" as string]: h, width: 22, height: 22, borderRadius: 6 }}
                  onClick={() => setColor(h)}
                />
              ))}
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
