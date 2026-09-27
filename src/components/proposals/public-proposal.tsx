"use client";

// Images de signature en data URL ou URL signée courte : next/image n'apporte rien ici.
/* eslint-disable @next/next/no-img-element */

import "@/styles/proposals.css";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Clock, Download, Eye, FileSignature, Hourglass, Mail, PenLine, ShieldCheck } from "lucide-react";

import { fmtDate, money } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtParis, type PublicSignature } from "@/lib/signature/types";
import type { Accent, Proposal, ProposalItem } from "@/lib/types";
import { ProposalDocument } from "./document";
import { computeTotals } from "./lib";
import { SignFlow } from "./sign-flow";

export interface PublicData {
  preview: boolean;
  expired: boolean;
  proposal: Omit<Proposal, "public_token" | "owner_id" | "deal_id" | "workspace_id" | "company_id" | "contact_id"> & { countersign?: boolean };
  items: Omit<ProposalItem, "proposal_id" | "service_id">[];
  workspace: { name: string; accent: Accent };
  company: { name: string } | null;
  contact: { first_name: string; last_name: string } | null;
  owner: { full_name: string; email: string; title: string } | null;
  /** Signature électronique : si présente, `proposal` et `items` viennent de l'instantané signé. */
  signature: PublicSignature | null;
  otpRequired: boolean;
}

type Step = "idle" | "sign" | "decline";

export function PublicProposal({ token, data, signatureFont }: { token: string; data: PublicData; signatureFont: string }) {
  const router = useRouter();
  const p = data.proposal;
  const [status, setStatus] = useState(p.status);
  const [localSig, setLocalSig] = useState<PublicSignature | null>(null);
  const sig = data.signature ?? localSig;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(data.items.filter((i) => i.optional && i.selected).map((i) => i.id)));
  const [step, setStep] = useState<Step>("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respondRef = useRef<HTMLElement>(null);

  const signed = !!sig;
  const legacyAccepted = status === "accepted" && !signed;
  const answered = signed || status === "accepted" || status === "declined";
  const canRespond = !data.preview && !answered && !data.expired && (status === "sent" || status === "viewed");
  const contactName = data.contact ? `${data.contact.first_name} ${data.contact.last_name}`.trim() : null;
  const isSelected = (i: { id: string; optional: boolean }) => !i.optional || selected.has(i.id);
  const totals = computeTotals(data.items, p.discount_pct, p.tax_pct, isSelected);
  const toggle =
    canRespond && step !== "decline"
      ? (id: string) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
      : undefined;
  const pdfUrl = `/api/signature/${token}/pdf`;
  const bothSigned = !!sig?.countersigned_at;
  const waitingAgency = !!sig && sig.countersign_required && !sig.countersigned_at;

  const scrollToRespond = (block: ScrollLogicalPosition = "start") =>
    requestAnimationFrame(() => respondRef.current?.scrollIntoView({ behavior: "smooth", block }));

  async function decline() {
    setError(null);
    setBusy(true);
    const { error: err } = await supabaseBrowser().rpc("respond_proposal", {
      p_token: token,
      p_accept: false,
      p_name: "",
      p_reason: reason.trim(),
      p_selected: [],
    });
    setBusy(false);
    if (err) {
      setError(err.message || "Une erreur est survenue, merci de réessayer.");
      return;
    }
    setStatus("declined");
    setStep("idle");
    scrollToRespond("center");
  }

  const mainTotal = totals.monthly.count ? totals.monthly : totals.one_off;
  const mainLabel = totals.monthly.count ? "HT / mois" : "HT";
  const names = (contactName ?? "").split(" ");

  return (
    <div className="pp" data-accent={data.workspace.accent}>
      <div className="pp-top">
        <div className="pp-top-in">
          <span className="pp-brand">
            <span className="pd-mark" aria-hidden>
              {data.workspace.name.slice(0, 1).toUpperCase()}
            </span>
            {data.workspace.name}
          </span>
          {signed ? (
            <a className="btn btn-sm" href={pdfUrl}>
              <Download size={14} />
              <span className="pp-hide-xs">Télécharger le PDF signé</span>
              <span className="pp-show-xs">PDF signé</span>
            </a>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => window.print()}>
              <Download size={14} />
              <span className="pp-hide-xs">Télécharger en PDF</span>
              <span className="pp-show-xs">PDF</span>
            </button>
          )}
        </div>
      </div>

      {data.preview && (
        <div className="pp-preview" role="status">
          <Eye size={14} />
          <span>
            Aperçu {p.status === "draft" ? "d'un brouillon " : ""}: vous êtes connecté à l&apos;espace, cette visite ne compte pas comme une ouverture et la signature est désactivée.
          </span>
        </div>
      )}

      <main className="pp-main">
        {signed && (
          <div className="pp-state ok" role="status">
            <ShieldCheck size={18} />
            <div>
              <strong>{bothSigned ? "Signée par les deux parties" : "Proposition signée"}</strong>
              <span>
                par {sig.signer_name} le {fmtParis(sig.signed_at)}
                {bothSigned && sig.countersigned_at && <>, contre-signée par {sig.countersigner_name} le {fmtParis(sig.countersigned_at)}</>}.
                {waitingAgency && <> En attente de la contre-signature de {data.workspace.name}.</>} Vous consultez la version signée, qui ne peut plus être modifiée.
              </span>
            </div>
          </div>
        )}
        {legacyAccepted && (
          <div className="pp-state ok" role="status">
            <CircleCheck size={18} />
            <div>
              <strong>Proposition acceptée</strong>
              <span>
                par {p.accepted_name ?? "le client"}
                {p.accepted_at && <> le {fmtDate(p.accepted_at.slice(0, 10), true)}</>}. Merci pour votre confiance.
              </span>
            </div>
          </div>
        )}
        {status === "declined" && (
          <div className="pp-state bad" role="status">
            <CircleX size={18} />
            <div>
              <strong>Proposition déclinée</strong>
              <span>Merci d&apos;avoir pris le temps de nous répondre.</span>
            </div>
          </div>
        )}
        {!answered && data.expired && (
          <div className="pp-state warn" role="status">
            <Clock size={18} />
            <div>
              <strong>Cette proposition a expiré</strong>
              <span>
                Elle était valable jusqu&apos;au {fmtDate(p.valid_until, true)}.
                {data.owner && <> Contactez {data.owner.full_name} pour en recevoir une version à jour.</>}
              </span>
            </div>
          </div>
        )}

        <div className="pp-paper">
          <ProposalDocument
            data={p}
            items={data.items}
            agency={data.workspace.name}
            client={data.company?.name}
            contact={contactName}
            selected={selected}
            onToggle={toggle}
          />

          <section className="pp-respond" ref={respondRef} id="reponse" aria-labelledby="pp-respond-h">
            {signed ? (
              <div className="pp-done">
                <span className="pp-done-ic ok">
                  <FileSignature size={22} />
                </span>
                <h2 id="pp-respond-h">{bothSigned ? "Signée par les deux parties" : "C'est signé, merci !"}</h2>
                <p>
                  {waitingAgency
                    ? `${data.workspace.name} va contre-signer la proposition. `
                    : data.owner
                      ? `${data.owner.full_name} revient vers vous très rapidement pour organiser le démarrage. `
                      : "Nous revenons vers vous très rapidement pour organiser le démarrage. "}
                  Conservez le PDF signé : il contient le document, les signatures et le certificat de signature.
                </p>
                <div className="sgd">
                  <div className="sgd-sig">
                    <span className="sgd-k">Le client</span>
                    {sig.image && <img src={sig.image} alt={`Signature de ${sig.signer_name}`} />}
                    <strong>{sig.signer_name}</strong>
                    {(sig.signer_role || sig.signer_company) && <span className="faint">{[sig.signer_role, sig.signer_company].filter(Boolean).join(", ")}</span>}
                    <span className="faint">{fmtParis(sig.signed_at)}</span>
                  </div>
                  {(sig.countersign_required || sig.countersigned_at) && (
                    <div className="sgd-sig">
                      <span className="sgd-k">{data.workspace.name}</span>
                      {sig.agency_image ? (
                        <img src={sig.agency_image} alt={`Signature de ${sig.countersigner_name ?? "l'agence"}`} />
                      ) : (
                        <span className="sgd-wait">
                          <Hourglass size={14} /> En attente
                        </span>
                      )}
                      {sig.countersigned_at && (
                        <>
                          <strong>{sig.countersigner_name}</strong>
                          {sig.countersigner_role && <span className="faint">{sig.countersigner_role}</span>}
                          <span className="faint">{fmtParis(sig.countersigned_at)}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <a className="btn btn-primary btn-lg" href={pdfUrl}>
                  <Download size={16} />
                  Télécharger le PDF signé
                </a>
                <p className="pp-sign faint mono" title={sig.document_hash}>
                  Empreinte SHA-256 : {sig.document_hash.slice(0, 16)}…{sig.document_hash.slice(-8)}
                </p>
              </div>
            ) : legacyAccepted ? (
              <div className="pp-done">
                <span className="pp-done-ic ok">
                  <CircleCheck size={22} />
                </span>
                <h2 id="pp-respond-h">C&apos;est validé, merci !</h2>
                <p>Acceptée en ligne par {p.accepted_name}. Vous pouvez télécharger cette proposition en PDF pour vos archives.</p>
              </div>
            ) : status === "declined" ? (
              <div className="pp-done">
                <span className="pp-done-ic">
                  <CircleX size={22} />
                </span>
                <h2 id="pp-respond-h">Réponse enregistrée</h2>
                <p>
                  Nous avons bien noté que cette proposition ne vous convient pas.
                  {data.owner && <> Si vous souhaitez en discuter, {data.owner.full_name} reste à votre disposition.</>}
                </p>
              </div>
            ) : (
              <>
                <h2 id="pp-respond-h" className="pp-respond-h">
                  {step === "sign" ? "Signer la proposition" : "Votre réponse"}
                </h2>
                <p className="pp-recap">
                  {totals.monthly.count > 0 && (
                    <span>
                      <strong className="num">{money(totals.monthly.net, p.currency)}</strong> HT par mois
                    </span>
                  )}
                  {totals.one_off.count > 0 && (
                    <span>
                      <strong className="num">{money(totals.one_off.net, p.currency)}</strong> HT en une fois
                    </span>
                  )}
                  <span className="faint">
                    soit{" "}
                    {[
                      totals.monthly.count ? `${money(totals.monthly.total, p.currency, 2)} TTC / mois` : "",
                      totals.one_off.count ? `${money(totals.one_off.total, p.currency, 2)} TTC ponctuel` : "",
                    ]
                      .filter(Boolean)
                      .join(" et ")}
                    {selected.size > 0 && `, options choisies incluses`}
                  </span>
                </p>

                {step === "idle" && (
                  <>
                    <div className="pp-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        disabled={!canRespond}
                        onClick={() => {
                          setStep("sign");
                          scrollToRespond();
                        }}
                      >
                        <PenLine size={16} />
                        Signer la proposition
                      </button>
                      <button type="button" className="btn btn-ghost btn-lg" disabled={!canRespond} onClick={() => setStep("decline")}>
                        Décliner
                      </button>
                    </div>
                    {canRespond && (
                      <p className="sgf-legal faint">
                        Signature électronique en quelques minutes, sans compte : vos informations, {data.otpRequired ? "un code reçu par email, " : ""}
                        la mention « Bon pour accord » et votre signature.
                      </p>
                    )}
                  </>
                )}

                {step === "sign" && (
                  <SignFlow
                    token={token}
                    version={p.updated_at}
                    number={p.number}
                    title={p.title}
                    agency={data.workspace.name}
                    currency={p.currency}
                    totals={totals}
                    selected={[...selected]}
                    defaultCompany={data.company?.name ?? ""}
                    defaultName={{ first: names[0] ?? "", last: names.slice(1).join(" ") }}
                    otpRequired={data.otpRequired}
                    countersign={!!p.countersign}
                    fontFamily={signatureFont}
                    onCancel={() => setStep("idle")}
                    onSigned={(s) => {
                      setLocalSig(s);
                      setStatus("accepted");
                      setStep("idle");
                      scrollToRespond("center");
                      router.refresh();
                    }}
                  />
                )}

                {step === "decline" && (
                  <form
                    className="pp-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decline();
                    }}
                  >
                    <div className="field">
                      <label htmlFor="pp-reason">Pouvez-vous nous dire pourquoi ? (facultatif)</label>
                      <textarea
                        id="pp-reason"
                        className="textarea"
                        autoFocus
                        rows={3}
                        placeholder="Budget, calendrier, périmètre…"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                      />
                    </div>
                    {error && (
                      <p className="pp-err" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="pp-actions">
                      <button type="submit" className="btn btn-danger btn-lg" disabled={busy}>
                        {busy ? "Envoi…" : "Confirmer le refus"}
                      </button>
                      <button type="button" className="btn btn-ghost btn-lg" onClick={() => setStep("idle")} disabled={busy}>
                        Annuler
                      </button>
                    </div>
                  </form>
                )}
                {!canRespond && !data.preview && data.expired && <p className="pp-err">La date de validité est dépassée : la signature en ligne n&apos;est plus possible.</p>}
              </>
            )}
          </section>
        </div>

        {data.owner && (
          <aside className="pp-owner">
            <div>
              <strong>Une question ?</strong>
              <span className="faint">
                {data.owner.full_name}
                {data.owner.title && <>, {data.owner.title}</>}
              </span>
            </div>
            <a className="btn" href={`mailto:${data.owner.email}?subject=${encodeURIComponent(`Question : ${p.title}`)}`}>
              <Mail size={14} />
              Écrire à {data.owner.full_name.split(" ")[0]}
            </a>
          </aside>
        )}
        <p className="pp-foot fainter">Proposition n° {p.number} · {data.workspace.name}</p>
      </main>

      {canRespond && step === "idle" && (
        <div className="pp-sticky">
          <div>
            <strong className="num">{money(mainTotal.net, p.currency)}</strong> <span className="faint">{mainLabel}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setStep("sign");
              scrollToRespond();
            }}
          >
            <PenLine size={15} />
            Signer
          </button>
        </div>
      )}
    </div>
  );
}
