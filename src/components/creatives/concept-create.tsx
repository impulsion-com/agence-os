"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CompanyPicker } from "@/components/pickers";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useWorkspace } from "@/lib/workspace/context";
import { AWARENESS, FORMATS, STATUSES, type Awareness, type ConceptFormat, type ConceptStatus } from "@/lib/creatives/constants";

export interface ConceptDefaults {
  company_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  status?: ConceptStatus;
  title?: string;
}

/** Création d'un concept, puis ouverture de sa fiche. */
export function ConceptCreateModal({ onClose, defaults, angles = [] }: { onClose: () => void; defaults?: ConceptDefaults; angles?: string[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [company, setCompany] = useState<string | null>(defaults?.company_id ?? ws.project(defaults?.project_id)?.company_id ?? null);
  const [format, setFormat] = useState<ConceptFormat>("ugc");
  const [angle, setAngle] = useState("");
  const [hook, setHook] = useState("");
  const [awareness, setAwareness] = useState<Awareness | "">("");
  const [status, setStatus] = useState<ConceptStatus>(defaults?.status ?? "idea");
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const row = must(
        await sb
          .from("creative_concepts")
          .insert({
            workspace_id: ws.workspace.id,
            title: title.trim(),
            company_id: company,
            project_id: defaults?.project_id ?? null,
            task_id: defaults?.task_id ?? null,
            format,
            angle: angle.trim(),
            hook: hook.trim(),
            awareness: awareness || null,
            status,
            platforms: ["meta"],
            owner_id: ws.me.id,
            position: Date.now() / 1000,
          })
          .select("id")
          .single(),
      );
      toast("Concept créé");
      onClose();
      router.push(`${ws.base}/creatives/${row!.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { error: true });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouveau concept créatif"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={!title.trim() || busy} onClick={() => submit()}>
            Créer le concept
          </button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="field">
          <label htmlFor="crv-new-title">Titre</label>
          <input id="crv-new-title" className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Routine du soir en 3 gestes" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <span className="label">Client</span>
            <CompanyPicker value={company} onChange={setCompany} trigger={(open) => (
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={open}>
                <span className="trunc">{ws.company(company)?.name ?? "Choisir un client"}</span>
              </button>
            )} />
          </div>
          <div className="field">
            <label htmlFor="crv-new-format">Format</label>
            <select id="crv-new-format" className="select" value={format} onChange={(e) => setFormat(e.target.value as ConceptFormat)}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="crv-new-angle">Angle</label>
          <input id="crv-new-angle" className="input" list="crv-angles" value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Ex. Routine simplifiée, preuve sociale, cadeau…" />
          <datalist id="crv-angles">{angles.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="crv-new-hook">Hook</label>
          <textarea id="crv-new-hook" className="textarea" rows={2} style={{ minHeight: 0 }} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="La phrase ou l'image des 3 premières secondes" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor="crv-new-aw">Niveau de conscience</label>
            <select id="crv-new-aw" className="select" value={awareness} onChange={(e) => setAwareness(e.target.value as Awareness | "")}>
              <option value="">Non renseigné</option>
              {AWARENESS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="crv-new-status">Statut</label>
            <select id="crv-new-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ConceptStatus)}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" className="sr" tabIndex={-1}>Créer</button>
      </form>
    </Modal>
  );
}
