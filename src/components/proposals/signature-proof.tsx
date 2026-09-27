"use client";

// Images de signature en data URL : next/image n'apporte rien ici.
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, Hourglass, MailCheck, MailWarning, PenLine, ShieldAlert, ShieldCheck } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { EVENT_LABEL, fmtParis } from "@/lib/signature/types";
import { useWorkspace } from "@/lib/workspace/context";
import { SignaturePad, type SignatureValue } from "./signature-pad";

export interface SignatureInfo {
  signed_at: string;
  document_hash: string;
  signer_first_name: string;
  signer_last_name: string;
  signer_role: string;
  signer_company: string;
  signer_email: string;
  email_verified: boolean;
  email_verified_at: string | null;
  mention: string;
  consent_text: string;
  signature_method: string;
  signature_hash: string;
  ip_trunc: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  pdf_path: string | null;
  pdf_hash: string | null;
  pdf_generated_at: string | null;
  countersign_required: boolean;
  countersigned_at: string | null;
  countersigner_name: string | null;
  countersigner_role: string | null;
  countersign_method: string | null;
  countersign_ip_trunc: string | null;
}

export interface SignatureEvent {
  id: number;
  kind: string;
  at: string;
  ip_trunc: string | null;
  user_agent: string | null;
  meta: Record<string, unknown> | null;
}

export interface ProofData {
  signature: SignatureInfo;
  events: SignatureEvent[];
  images: { client: string | null; agency: string | null };
  integrity: boolean;
}

/** Résumé lisible d'un user-agent (navigateur et système). */
export function uaLabel(ua: string | null) {
  if (!ua) return "Inconnu";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} sur ${os}` : browser;
}

export function SignatureProof({ proof, token, onCountersign }: { proof: ProofData; token: string; onCountersign: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const s = proof.signature;
  const pdfUrl = `/api/signature/${token}/pdf`;
  const name = `${s.signer_first_name} ${s.signer_last_name}`.trim();
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié");
    } catch {
      toast("Copie impossible", { error: true });
    }
  };

  return (
    <div className="sp">
      <div className={`sp-integrity${proof.integrity ? " ok" : " bad"}`} role="status">
        {proof.integrity ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
        <div>
          <strong>{proof.integrity ? "Intégrité vérifiée" : "Intégrité non confirmée"}</strong>
          <span>
            {proof.integrity
              ? "L'empreinte SHA-256 recalculée à l'instant correspond à celle enregistrée à la signature : le contenu signé n'a pas été modifié."
              : "L'empreinte recalculée ne correspond pas à celle enregistrée. Conserve le PDF signé d'origine et contacte l'administrateur de l'instance."}
          </span>
        </div>
      </div>

      <div className="sp-grid">
        <section className="sp-card">
          <h3>Signataire</h3>
          <div className="sp-sigimg">
            {proof.images.client ? <img src={proof.images.client} alt={`Signature de ${name}`} /> : <span className="faint">Image indisponible</span>}
          </div>
          <dl className="sp-dl">
            <dt>Nom</dt>
            <dd>{name}</dd>
            {s.signer_role && (
              <>
                <dt>Fonction</dt>
                <dd>{s.signer_role}</dd>
              </>
            )}
            {s.signer_company && (
              <>
                <dt>Société</dt>
                <dd>{s.signer_company}</dd>
              </>
            )}
            <dt>Email</dt>
            <dd>
              {s.signer_email}
              {s.email_verified ? (
                <span className="sp-tag ok">
                  <MailCheck size={12} /> vérifié par code
                </span>
              ) : (
                <span className="sp-tag warn" title="L'envoi d'emails n'était pas configuré : l'adresse est déclarée par le signataire.">
                  <MailWarning size={12} /> déclaré, non vérifié
                </span>
              )}
            </dd>
            <dt>Signée le</dt>
            <dd>{fmtParis(s.signed_at)}</dd>
            <dt>Signature</dt>
            <dd>{s.signature_method === "drawn" ? "Tracée à l'écran" : "Nom tapé en écriture manuscrite"}</dd>
            <dt>Mention</dt>
            <dd>« {s.mention} »</dd>
            <dt>Adresse IP</dt>
            <dd className="mono">{s.ip_trunc ?? "Inconnue"}</dd>
            <dt>Navigateur</dt>
            <dd title={s.user_agent ?? ""}>{uaLabel(s.user_agent)}</dd>
          </dl>
          <details className="sp-consent">
            <summary>Consentement exprimé</summary>
            <p>{s.consent_text}</p>
          </details>
        </section>

        <section className="sp-card">
          <h3>Document signé</h3>
          <dl className="sp-dl">
            <dt>Empreinte</dt>
            <dd className="sp-hash">
              <code>{s.document_hash}</code>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => void copy(s.document_hash)} aria-label="Copier l'empreinte">
                <Copy size={13} />
              </button>
            </dd>
            <dt>PDF</dt>
            <dd>
              {s.pdf_generated_at ? <>Généré le {fmtParis(s.pdf_generated_at)}</> : "Généré à la première demande"}
              {s.pdf_hash && <code className="sp-small">SHA-256 {s.pdf_hash.slice(0, 16)}…</code>}
            </dd>
          </dl>
          <div className="sp-actions">
            <a className="btn btn-primary btn-sm" href={pdfUrl}>
              <Download size={13} /> Télécharger le PDF signé
            </a>
            <a className="btn btn-sm" href={`${pdfUrl}?inline=1`} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Ouvrir
            </a>
          </div>

          <h3 className="sp-h2">Contre-signature de l&apos;agence</h3>
          {s.countersigned_at ? (
            <>
              <div className="sp-sigimg">{proof.images.agency && <img src={proof.images.agency} alt={`Signature de ${s.countersigner_name}`} />}</div>
              <dl className="sp-dl">
                <dt>Par</dt>
                <dd>{[s.countersigner_name, s.countersigner_role].filter(Boolean).join(", ")}</dd>
                <dt>Le</dt>
                <dd>{fmtParis(s.countersigned_at)}</dd>
                <dt>Adresse IP</dt>
                <dd className="mono">{s.countersign_ip_trunc ?? "Inconnue"}</dd>
              </dl>
            </>
          ) : (
            <div className="sp-counter">
              <p className="faint">
                {s.countersign_required
                  ? "Le client a signé : ta contre-signature est attendue pour que la proposition soit signée par les deux parties."
                  : "Facultative : tu peux contre-signer pour que le PDF porte aussi la signature de l'agence."}
              </p>
              {ws.canWrite && (
                <button className={`btn btn-sm${s.countersign_required ? " btn-primary" : ""}`} onClick={onCountersign}>
                  <PenLine size={13} /> Contre-signer
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="sp-card">
        <h3>Piste d&apos;audit</h3>
        <ol className="sp-events">
          {proof.events.map((e) => {
            const detail = [
              typeof e.meta?.email === "string" ? e.meta.email : typeof e.meta?.to === "string" ? e.meta.to : null,
              e.ip_trunc ? `IP ${e.ip_trunc}` : null,
              e.user_agent ? uaLabel(e.user_agent) : null,
            ].filter(Boolean);
            return (
              <li key={e.id} className={`sp-ev k-${e.kind}`}>
                <span className="sp-ev-dot" aria-hidden />
                <div>
                  <strong>{EVENT_LABEL[e.kind] ?? e.kind}</strong>
                  {detail.length > 0 && <span className="faint"> · {detail.join(" · ")}</span>}
                </div>
                <time className="faint num" dateTime={e.at}>
                  {fmtParis(e.at)}
                </time>
              </li>
            );
          })}
        </ol>
        <p className="pe-hint">Heures de Paris. Les adresses IP sont tronquées et hachées : l&apos;adresse complète n&apos;est jamais conservée.</p>
      </section>
    </div>
  );
}

/** Contre-signature par un membre de l'agence. */
export function CountersignModal({ token, fontFamily, onClose }: { token: string; fontFamily: string; onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(ws.me.full_name ?? "");
  const [role, setRole] = useState(ws.me.title ?? "");
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError("Indique ton nom.");
    if (!sig) return setError("Signe dans le cadre.");
    if (!agree) return setError("Coche la case de confirmation.");
    setBusy(true);
    const res = await fetch(`/api/signature/${token}/countersign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), role: role.trim(), method: sig.method, image: sig.dataUrl }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Contre-signature impossible.");
    toast("Proposition contre-signée : elle est signée par les deux parties");
    onClose();
    router.refresh();
  };

  return (
    <Modal
      title="Contre-signer la proposition"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            <PenLine size={14} />
            {busy ? "Signature…" : "Contre-signer"}
          </button>
        </>
      }
    >
      <div className="sp-modal">
        <div className="sgf-grid">
          <div className="field">
            <label htmlFor="cs-name">Nom</label>
            <input id="cs-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="cs-role">Fonction</label>
            <input id="cs-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} placeholder="Gérant, fondatrice…" />
          </div>
        </div>
        <SignaturePad onChange={setSig} defaultName={name} fontFamily={fontFamily} label="Ta signature" />
        <label className="pp-agree">
          <input type="checkbox" className="check" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>Je contre-signe cette proposition au nom de {ws.workspace.name} et j&apos;accepte que cette signature électronique engage l&apos;agence.</span>
        </label>
        {error && (
          <p className="pp-err" role="alert">
            {error}
          </p>
        )}
        <p className="pe-hint">
          <Hourglass size={12} /> Le PDF signé est régénéré avec ta signature, et le client en reçoit la version finale si l&apos;envoi d&apos;emails est configuré.
        </p>
      </div>
    </Modal>
  );
}
