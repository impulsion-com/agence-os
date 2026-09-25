"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { CompanyPicker } from "@/components/pickers";
import { ConfirmModal, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Json } from "@/lib/database.types";
import { MODELS, WINDOWS, type ModelId } from "@/lib/tracking/attribution";
import { isDomain, normalizeDomain, type SiteSettings } from "@/lib/tracking/settings";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { SiteRow } from "@/lib/tracking/load";

/** Création ou modification d'un site suivi. */
export function SiteModal({ site, onClose }: { site?: SiteRow; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const mutate = useMutate();
  const [name, setName] = useState(site?.name ?? "");
  const [company, setCompany] = useState<string | null>(site?.company_id ?? null);
  const [domains, setDomains] = useState((site?.domains ?? []).join("\n"));
  const [s, setS] = useState<SiteSettings>(
    site?.settings ?? { window_days: 30, model: "last_click", auto_contacts: true, consent: "none", capture_forms: true },
  );
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const list = [...new Set(domains.split(/[\s,;]+/).map(normalizeDomain).filter(Boolean))];
  const bad = list.filter((d) => !isDomain(d));
  const valid = name.trim().length > 0 && !bad.length;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const row = { name: name.trim(), company_id: company, domains: list, settings: { ...s } as unknown as Json };
    try {
      const sb = supabaseBrowser();
      if (site) {
        must(await sb.from("tracking_sites").update(row).eq("id", site.id));
        toast("Site mis à jour");
        router.refresh();
        onClose();
      } else {
        const created = must(await sb.from("tracking_sites").insert({ ...row, workspace_id: ws.workspace.id }).select("id").single());
        toast("Site créé : installe maintenant le script");
        router.push(`${ws.base}/tracking/${created!.id}?tab=install`);
        onClose();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title={site ? "Réglages du site suivi" : "Nouveau site suivi"}
        onClose={onClose}
        size="lg"
        footer={
          <>
            {site && ws.canWrite && (
              <button className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--red)" }} onClick={() => setConfirm(true)}>
                <Trash2 size={14} /> Supprimer
              </button>
            )}
            <button className="btn" onClick={onClose}>Annuler</button>
            <button className="btn btn-primary" onClick={save} disabled={!valid || busy || !ws.canWrite}>
              {site ? "Enregistrer" : "Créer le site"}
            </button>
          </>
        }
      >
        <div className="trk-form">
          <div className="field">
            <label htmlFor="trk-name">Nom</label>
            <input id="trk-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Boutique Maison Lumen" />
          </div>
          <div className="field">
            <span className="label">Client</span>
            <div>
              <CompanyPicker
                value={company}
                onChange={setCompany}
                trigger={(open) => (
                  <button type="button" className="pill bordered" onClick={open}>
                    {ws.company(company)?.name ?? "Site de l'agence (aucun client)"}
                  </button>
                )}
              />
            </div>
            <span className="hint">
              {company
                ? "Les visiteurs identifiés restent des prospects du client : ils ne sont jamais ajoutés au CRM de l'agence."
                : "Sans client, c'est le site de ton agence : les deals gagnés du CRM comptent comme conversions."}
            </span>
          </div>
          <div className="field trk-span">
            <label htmlFor="trk-domains">Domaines</label>
            <textarea
              id="trk-domains"
              className="textarea"
              style={{ minHeight: 70 }}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder={"maisonlumen.fr\ncheckout.maisonlumen.fr"}
            />
            {bad.length ? (
              <span className="err">Domaine invalide : {bad.join(", ")}</span>
            ) : (
              <span className="hint">
                Un par ligne, sous-domaines inclus. Seuls ces domaines peuvent envoyer des données, et le visiteur est suivi de l&apos;un à l&apos;autre (site vitrine vers
                tunnel de paiement). Laisse vide pour accepter tous les domaines.
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="trk-model">Modèle d&apos;attribution par défaut</label>
            <select id="trk-model" className="select" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value as ModelId })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="trk-window">Fenêtre d&apos;attribution</label>
            <select id="trk-window" className="select" value={s.window_days} onChange={(e) => setS({ ...s, window_days: Number(e.target.value) })}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>{w} jour{w > 1 ? "s" : ""}</option>
              ))}
            </select>
          </div>
          <div className="field trk-span">
            <span className="label">Consentement (RGPD)</span>
            <div className="seg" role="group" aria-label="Consentement">
              <button type="button" className={s.consent === "none" ? "on" : ""} aria-pressed={s.consent === "none"} onClick={() => setS({ ...s, consent: "none" })}>
                Suivi immédiat
              </button>
              <button type="button" className={s.consent === "required" ? "on" : ""} aria-pressed={s.consent === "required"} onClick={() => setS({ ...s, consent: "required" })}>
                Après consentement
              </button>
            </div>
            <span className="hint">
              {s.consent === "required"
                ? "Rien n'est déposé ni envoyé tant que le bandeau cookies n'a pas appelé aos('consent', true). Recommandé en Europe."
                : "Le script démarre dès le chargement. À réserver aux sites sans bandeau ou exemptés."}
            </span>
          </div>
          <label className="trk-check trk-span">
            <input type="checkbox" className="toggle" checked={s.capture_forms} onChange={(e) => setS({ ...s, capture_forms: e.target.checked })} />
            <span>
              <b>Capturer les formulaires</b>
              <small>À la soumission d&apos;un formulaire avec un email, le visiteur est identifié (email, nom, téléphone). Jamais les mots de passe.</small>
            </span>
          </label>
          {!company && (
            <label className="trk-check trk-span">
              <input type="checkbox" className="toggle" checked={s.auto_contacts} onChange={(e) => setS({ ...s, auto_contacts: e.target.checked })} />
              <span>
                <b>Créer les contacts CRM</b>
                <small>Chaque visiteur identifié est relié à un contact du CRM (créé s&apos;il n&apos;existe pas).</small>
              </span>
            </label>
          )}
        </div>
      </Modal>
      {confirm && site && (
        <ConfirmModal
          title="Supprimer ce site suivi ?"
          text={`Tous les visiteurs, points de contact et conversions de « ${site.name} » seront définitivement effacés. Le script installé cessera d'envoyer des données.`}
          confirmLabel="Supprimer le site"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.from("tracking_sites").delete().eq("id", site.id)), { success: "Site supprimé", refresh: false });
            if (ok !== undefined) {
              onClose();
              router.push(`${ws.base}/tracking`);
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}
