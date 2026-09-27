"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, MailCheck, ShieldCheck } from "lucide-react";

import { amountsText, consentText, MENTION, mentionOk, type PublicSignature } from "@/lib/signature/types";
import type { Totals } from "./lib";
import { SignaturePad, type SignatureValue } from "./signature-pad";

type Step = "identity" | "otp" | "sign";

export interface SignFlowProps {
  token: string;
  version: string;
  number: number;
  title: string;
  agency: string;
  currency: string;
  totals: Totals;
  selected: string[];
  defaultCompany: string;
  defaultName: { first: string; last: string };
  otpRequired: boolean;
  countersign: boolean;
  fontFamily: string;
  onCancel: () => void;
  onSigned: (s: PublicSignature) => void;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Une erreur est survenue, merci de réessayer.");
  return json;
}

/**
 * Parcours de signature : identité, vérification de l'email par code (si l'envoi
 * d'emails est configuré), mention « Bon pour accord », signature et consentement.
 */
export function SignFlow(props: SignFlowProps) {
  const { token, otpRequired } = props;
  const [step, setStep] = useState<Step>("identity");
  const [first, setFirst] = useState(props.defaultName.first);
  const [last, setLast] = useState(props.defaultName.last);
  const [role, setRole] = useState("");
  const [company, setCompany] = useState(props.defaultCompany);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [mention, setMention] = useState("");
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const steps: Step[] = otpRequired ? ["identity", "otp", "sign"] : ["identity", "sign"];
  const idx = steps.indexOf(step) + 1;
  const cleanEmail = email.trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
  const consentLabel = consentText({
    first_name: first,
    last_name: last,
    role,
    company,
    number: props.number,
    title: props.title,
    agency: props.agency,
    amounts: amountsText(props.totals, props.currency),
  });

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      await post(`/api/signature/${token}/otp`, { email: cleanEmail });
      setCooldown(30);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitIdentity() {
    setTried(true);
    setError(null);
    if (!first.trim() || !last.trim() || !emailValid) {
      setError(!emailValid ? "Merci d'indiquer une adresse email valide." : "Merci d'indiquer votre prénom et votre nom.");
      return;
    }
    if (!otpRequired || verifiedFor === cleanEmail) {
      setStep("sign");
      return;
    }
    setStep("otp");
    await sendCode();
  }

  async function verify() {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Le code comporte 6 chiffres.");
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ proof: string }>(`/api/signature/${token}/verify`, { email: cleanEmail, code: code.trim() });
      setProof(r.proof);
      setVerifiedFor(cleanEmail);
      setStep("sign");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    setTried(true);
    setError(null);
    if (!mentionOk(mention)) return setError(`Merci de recopier la mention « ${MENTION} ».`);
    if (!sig) return setError("Merci de signer dans le cadre prévu.");
    if (!consent) return setError("Merci de cocher la case de consentement.");
    setBusy(true);
    try {
      const r = await post<{ signed_at: string; document_hash: string; has_pdf: boolean }>(`/api/signature/${token}/sign`, {
        version: props.version,
        first_name: first.trim(),
        last_name: last.trim(),
        role: role.trim(),
        company: company.trim(),
        email: cleanEmail,
        mention: mention.trim(),
        consent: true,
        method: sig.method,
        image: sig.dataUrl,
        selected: props.selected,
        otp_proof: proof ?? undefined,
      });
      props.onSigned({
        signed_at: r.signed_at,
        signer_name: `${first.trim()} ${last.trim()}`,
        signer_role: role.trim(),
        signer_company: company.trim(),
        method: sig.method,
        document_hash: r.document_hash,
        email_verified: !!proof,
        countersign_required: props.countersign,
        countersigned_at: null,
        countersigner_name: null,
        countersigner_role: null,
        image: sig.dataUrl,
        agency_image: null,
        has_pdf: r.has_pdf,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const back = () => {
    setError(null);
    if (step === "identity") props.onCancel();
    else setStep(step === "sign" && otpRequired && verifiedFor !== cleanEmail ? "otp" : "identity");
  };

  return (
    <div className="sgf" aria-live="polite">
      <div className="sgf-steps" aria-label={`Étape ${idx} sur ${steps.length}`}>
        {steps.map((s, i) => (
          <span key={s} className={`sgf-step${i + 1 < idx ? " done" : i + 1 === idx ? " on" : ""}`}>
            <span className="sgf-dot">{i + 1}</span>
            <span className="sgf-step-l">{s === "identity" ? "Vos informations" : s === "otp" ? "Vérification" : "Signature"}</span>
          </span>
        ))}
      </div>

      {step === "identity" && (
        <form
          className="pp-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submitIdentity();
          }}
        >
          <div className="sgf-grid">
            <div className="field">
              <label htmlFor="sg-first">Prénom</label>
              <input id="sg-first" className="input lg" autoComplete="given-name" autoFocus value={first} onChange={(e) => setFirst(e.target.value)} aria-invalid={tried && !first.trim()} maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="sg-last">Nom</label>
              <input id="sg-last" className="input lg" autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} aria-invalid={tried && !last.trim()} maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="sg-role">Fonction</label>
              <input id="sg-role" className="input lg" autoComplete="organization-title" placeholder="Gérant, directrice marketing…" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="sg-company">Société</label>
              <input id="sg-company" className="input lg" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sg-email">Email professionnel</label>
            <input
              id="sg-email"
              className="input lg"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={tried && !emailValid}
              maxLength={200}
            />
            <span className="hint">
              {otpRequired
                ? "Nous allons vous envoyer un code à 6 chiffres pour vérifier cette adresse."
                : "Vous y recevrez le document signé si l'agence vous l'envoie. Elle figure dans le dossier de preuve comme adresse déclarée."}
            </span>
          </div>
          {error && (
            <p className="pp-err" role="alert">
              {error}
            </p>
          )}
          <div className="pp-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? <LoaderCircle size={16} className="pe-spin" /> : null}
              Continuer
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={back} disabled={busy}>
              Annuler
            </button>
          </div>
        </form>
      )}

      {step === "otp" && (
        <form
          className="pp-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <div className="sgf-note">
            <MailCheck size={18} />
            <span>
              Un code à 6 chiffres a été envoyé à <strong>{cleanEmail}</strong>. Il est valable 10 minutes.
            </span>
          </div>
          <div className="field">
            <label htmlFor="sg-code">Code de vérification</label>
            <input
              id="sg-code"
              className="input lg sgf-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
            />
          </div>
          {error && (
            <p className="pp-err" role="alert">
              {error}
            </p>
          )}
          <div className="pp-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy || code.length !== 6}>
              {busy ? <LoaderCircle size={16} className="pe-spin" /> : null}
              Vérifier
            </button>
            <button type="button" className="btn btn-lg" onClick={() => void sendCode()} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Renvoyer (${cooldown} s)` : "Renvoyer le code"}
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={back} disabled={busy}>
              <ArrowLeft size={15} /> Modifier l&apos;adresse
            </button>
          </div>
        </form>
      )}

      {step === "sign" && (
        <form
          className="pp-form sgf-sign"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void sign();
          }}
        >
          {verifiedFor === cleanEmail && proof && (
            <div className="sgf-note ok">
              <ShieldCheck size={18} />
              <span>
                Adresse <strong>{cleanEmail}</strong> vérifiée.
              </span>
            </div>
          )}
          <div className="field">
            <label htmlFor="sg-mention">
              Recopiez la mention « {MENTION} »
            </label>
            <input
              id="sg-mention"
              className="input lg"
              autoComplete="off"
              placeholder={MENTION}
              value={mention}
              onChange={(e) => setMention(e.target.value)}
              aria-invalid={tried && !mentionOk(mention)}
              maxLength={60}
            />
          </div>
          <SignaturePad onChange={setSig} defaultName={`${first.trim()} ${last.trim()}`.trim()} fontFamily={props.fontFamily} />
          <label className="pp-agree">
            <input type="checkbox" className="check" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{consentLabel}</span>
          </label>
          {error && (
            <p className="pp-err" role="alert">
              {error}
            </p>
          )}
          <div className="pp-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? <LoaderCircle size={16} className="pe-spin" /> : null}
              {busy ? "Signature en cours…" : "Signer la proposition"}
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={back} disabled={busy}>
              <ArrowLeft size={15} /> Retour
            </button>
          </div>
          <p className="sgf-legal faint">
            Signature électronique simple (règlement eIDAS). La date, l&apos;heure, votre adresse IP tronquée et l&apos;empreinte du document sont
            enregistrées dans un certificat joint au PDF signé.
          </p>
        </form>
      )}
    </div>
  );
}
