"use client";

import "@/styles/proposals.css";

import { useRef, useState } from "react";
import { CircleCheck, CircleX, Clock, Download, Eye, Mail } from "lucide-react";

import { fmtDate, money } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Accent, Proposal, ProposalItem } from "@/lib/types";
import { ProposalDocument } from "./document";
import { computeTotals } from "./lib";

export interface PublicData {
  preview: boolean;
  expired: boolean;
  proposal: Omit<Proposal, "public_token" | "owner_id" | "deal_id" | "workspace_id" | "company_id" | "contact_id">;
  items: Omit<ProposalItem, "proposal_id" | "service_id">[];
  workspace: { name: string; accent: Accent };
  company: { name: string } | null;
  contact: { first_name: string; last_name: string } | null;
  owner: { full_name: string; email: string; title: string } | null;
}

type Step = "idle" | "accept" | "decline";

export function PublicProposal({ token, data }: { token: string; data: PublicData }) {
  const p = data.proposal;
  const [status, setStatus] = useState(p.status);
  const [acceptedName, setAcceptedName] = useState(p.accepted_name);
  const [acceptedAt, setAcceptedAt] = useState(p.accepted_at);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(data.items.filter((i) => i.optional && i.selected).map((i) => i.id)));
  const [step, setStep] = useState<Step>("idle");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respondRef = useRef<HTMLElement>(null);

  const answered = status === "accepted" || status === "declined";
  const canRespond = !data.preview && !answered && !data.expired && (status === "sent" || status === "viewed");
  const contactName = data.contact ? `${data.contact.first_name} ${data.contact.last_name}`.trim() : null;
  const isSelected = (i: { id: string; optional: boolean }) => !i.optional || selected.has(i.id);
  const totals = computeTotals(data.items, p.discount_pct, p.tax_pct, isSelected);
  const toggle = canRespond
    ? (id: string) =>
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        })
    : undefined;

  async function respond(accept: boolean) {
    setError(null);
    if (accept && (name.trim().length < 2 || !agree)) {
      setError(name.trim().length < 2 ? "Merci d'indiquer votre nom complet." : "Merci de cocher la case d'acceptation des conditions.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabaseBrowser().rpc("respond_proposal", {
      p_token: token,
      p_accept: accept,
      p_name: accept ? name.trim() : "",
      p_reason: accept ? "" : reason.trim(),
      p_selected: [...selected],
    });
    setBusy(false);
    if (err) {
      setError(err.message || "Une erreur est survenue, merci de réessayer.");
      return;
    }
    setStatus(accept ? "accepted" : "declined");
    if (accept) {
      setAcceptedName(name.trim());
      setAcceptedAt(new Date().toISOString());
    }
    setStep("idle");
    requestAnimationFrame(() => respondRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const mainTotal = totals.monthly.count ? totals.monthly : totals.one_off;
  const mainLabel = totals.monthly.count ? "HT / mois" : "HT";

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
          <button type="button" className="btn btn-sm" onClick={() => window.print()}>
            <Download size={14} />
            <span className="pp-hide-xs">Télécharger en PDF</span>
            <span className="pp-show-xs">PDF</span>
          </button>
        </div>
      </div>

      {data.preview && (
        <div className="pp-preview" role="status">
          <Eye size={14} />
          <span>
            Aperçu {p.status === "draft" ? "d'un brouillon " : ""}: vous êtes connecté à l&apos;espace, cette visite ne compte pas comme une ouverture et les boutons de réponse sont désactivés.
          </span>
        </div>
      )}

      <main className="pp-main">
        {status === "accepted" && (
          <div className="pp-state ok" role="status">
            <CircleCheck size={18} />
            <div>
              <strong>Proposition acceptée</strong>
              <span>
                par {acceptedName ?? "le client"}
                {acceptedAt && <> le {fmtDate(acceptedAt.slice(0, 10), true)}</>}. Merci pour votre confiance.
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
            {status === "accepted" ? (
              <div className="pp-done">
                <span className="pp-done-ic ok">
                  <CircleCheck size={22} />
                </span>
                <h2 id="pp-respond-h">C&apos;est validé, merci !</h2>
                <p>
                  {data.owner ? `${data.owner.full_name} revient vers vous` : "Nous revenons vers vous"} très rapidement pour organiser le démarrage.
                  Vous pouvez télécharger cette proposition en PDF pour vos archives.
                </p>
                <p className="pp-sign faint">
                  Acceptée électroniquement par {acceptedName}
                  {acceptedAt && <> le {new Date(acceptedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}</>}
                </p>
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
                  Votre réponse
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
                  <div className="pp-actions">
                    <button type="button" className="btn btn-primary btn-lg" disabled={!canRespond} onClick={() => setStep("accept")}>
                      <CircleCheck size={16} />
                      Accepter la proposition
                    </button>
                    <button type="button" className="btn btn-ghost btn-lg" disabled={!canRespond} onClick={() => setStep("decline")}>
                      Décliner
                    </button>
                  </div>
                )}

                {step === "accept" && (
                  <form
                    className="pp-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void respond(true);
                    }}
                  >
                    <div className="field">
                      <label htmlFor="pp-name">Votre nom complet</label>
                      <input
                        id="pp-name"
                        className="input lg"
                        autoFocus
                        autoComplete="name"
                        placeholder="Prénom Nom"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <span className="hint">Il tient lieu de signature électronique.</span>
                    </div>
                    <label className="pp-agree">
                      <input type="checkbox" className="check" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                      <span>
                        J&apos;accepte les conditions de cette proposition
                        {totals.monthly.count > 0 && <>, soit {money(totals.monthly.total, p.currency, 2)} TTC par mois</>}
                        {totals.monthly.count > 0 && totals.one_off.count > 0 && " et"}
                        {totals.one_off.count > 0 && <> {money(totals.one_off.total, p.currency, 2)} TTC en une fois</>}.
                      </span>
                    </label>
                    {error && (
                      <p className="pp-err" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="pp-actions">
                      <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                        {busy ? "Validation…" : "Confirmer mon accord"}
                      </button>
                      <button type="button" className="btn btn-ghost btn-lg" onClick={() => setStep("idle")} disabled={busy}>
                        Annuler
                      </button>
                    </div>
                  </form>
                )}

                {step === "decline" && (
                  <form
                    className="pp-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void respond(false);
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
                {!canRespond && !data.preview && data.expired && <p className="pp-err">La date de validité est dépassée : la réponse en ligne n&apos;est plus possible.</p>}
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
        <div className="pp-sticky" aria-hidden={false}>
          <div>
            <strong className="num">{money(mainTotal.net, p.currency)}</strong> <span className="faint">{mainLabel}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setStep("accept");
              requestAnimationFrame(() => respondRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
          >
            Accepter
          </button>
        </div>
      )}
    </div>
  );
}
