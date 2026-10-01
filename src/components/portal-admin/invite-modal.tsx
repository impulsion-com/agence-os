"use client";

import { useState } from "react";
import { Check, CircleAlert, Copy, MailCheck } from "lucide-react";

import "@/styles/portal-admin.css";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { EMAIL_RE, PORTAL_FEATURE, sortFeatures } from "@/lib/portal-admin/features";
import type { Contact, PortalFeature } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

export interface InviteResult {
  sent: boolean;
  url: string;
  email?: string;
  error?: string;
  emailEnabled: boolean;
}

/** Lien d'invitation à transmettre : /invite/c/<token> (page gérée par le portail client) */
export const inviteUrl = (token: string) => `${(process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "")}/invite/c/${token}`;

/** Envoie (ou relance) l'invitation par email via la route serveur. Sans email configuré : { sent: false, url }. */
export async function sendInvite(invitationId: string, reminder = false): Promise<InviteResult> {
  const res = await fetch("/api/portal-admin/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitation_id: invitationId, reminder }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<InviteResult> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Envoi impossible");
  return body as InviteResult;
}

const name = (c: Pick<Contact, "first_name" | "last_name" | "email">) => [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email;

/**
 * Invitation d'une personne du client : email (ou contact existant) et fonctionnalités.
 * Crée la ligne client_invitations, tente l'envoi de l'email, puis affiche le lien à copier.
 */
export function PortalInviteModal({
  companyId, companyName, contacts, open, taken, emailOn, portalOn, onClose, onDone,
}: {
  companyId: string;
  companyName: string;
  contacts: Contact[];
  // fonctionnalités ouvertes au niveau du portail
  open: PortalFeature[];
  // emails ayant déjà un accès
  taken: string[];
  emailOn: boolean | null;
  portalOn: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const withMail = contacts.filter((c) => EMAIL_RE.test(c.email.trim()));
  const [email, setEmail] = useState("");
  const [contact, setContact] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [features, setFeatures] = useState<PortalFeature[]>(open);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; url: string; result: InviteResult | null; error?: string } | null>(null);

  const clean = email.trim().toLowerCase();
  const valid = EMAIL_RE.test(clean);
  const already = taken.includes(clean);
  const noFeature = custom && !features.length;

  const pick = (c: Contact) => {
    setContact(c.id);
    setEmail(c.email.trim());
  };

  const submit = async () => {
    if (!valid || already || noFeature || busy) return;
    setBusy(true);
    const match = contacts.find((c) => c.id === contact && c.email.trim().toLowerCase() === clean) ?? contacts.find((c) => c.email.trim().toLowerCase() === clean);
    const row = await mutate(
      async (sb) =>
        must(
          await sb
            .from("client_invitations")
            .upsert(
              {
                workspace_id: ws.workspace.id, company_id: companyId, email: clean, features: custom ? sortFeatures(features) : null,
                contact_id: match?.id ?? null, invited_by: ws.me.id, revoked_at: null, accepted_at: null,
              },
              { onConflict: "company_id,email" },
            )
            .select("id, email, token")
            .single(),
        ),
      { refresh: false },
    );
    if (!row) {
      setBusy(false);
      return;
    }
    let result: InviteResult | null = null;
    let error: string | undefined;
    try {
      result = await sendInvite(row.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    setBusy(false);
    setDone({ email: row.email, url: inviteUrl(row.token), result, error });
    onDone();
  };

  const copy = (url: string) => {
    void navigator.clipboard.writeText(url);
    toast("Lien copié");
  };

  if (done)
    return (
      <Modal title="Invitation créée" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Terminé</button>}>
        <div className="pa-done">
          {done.result?.sent ? (
            <div className="pa-note">
              <MailCheck size={15} style={{ color: "var(--green)" }} />
              <span>
                Email d&apos;invitation envoyé à <b>{done.email}</b>. Tu peux aussi lui transmettre le lien ci-dessous.
              </span>
            </div>
          ) : (
            <div className="pa-note warn">
              <CircleAlert size={15} />
              <span>
                {done.result?.emailEnabled === false
                  ? "L'envoi d'emails n'est pas configuré sur cet espace : copie le lien et envoie-le toi-même."
                  : `L'email n'a pas pu partir${done.error || done.result?.error ? ` (${done.error ?? done.result?.error})` : ""}. Copie le lien et envoie-le toi-même.`}
              </span>
            </div>
          )}
          <div className="field">
            <label htmlFor="pa-link">Lien d&apos;invitation pour {done.email}</label>
            <div className="pa-linkrow">
              <input id="pa-link" className="input mono" readOnly value={done.url} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn" onClick={() => copy(done.url)}>
                <Copy size={14} /> Copier
              </button>
            </div>
            <span className="hint">
              La personne crée son compte avec cette adresse, puis arrive sur le portail de {companyName}. Le lien ne fonctionne qu&apos;avec cette adresse email.
            </span>
          </div>
          {!portalOn && (
            <div className="pa-note warn">
              <CircleAlert size={15} />
              <span>Le portail de ce client est désactivé : la personne ne pourra pas se connecter tant que tu ne l&apos;as pas réactivé.</span>
            </div>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal
      title={`Inviter une personne de ${companyName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!valid || already || noFeature || busy} onClick={submit}>
            {emailOn ? "Inviter par email" : "Créer l'invitation"}
          </button>
        </>
      }
    >
      {withMail.length > 0 && (
        <div className="field">
          <span className="label">Choisir un contact</span>
          <div className="pa-contacts">
            {withMail.map((c) => {
              const has = taken.includes(c.email.trim().toLowerCase());
              return (
                <button key={c.id} type="button" className={`pa-contact${contact === c.id ? " on" : ""}`} disabled={has} onClick={() => pick(c)} title={has ? "Cette personne a déjà accès" : c.email}>
                  <span className="av" style={{ ["--s" as string]: "20px", ["--c" as string]: "var(--slate)" }}>
                    {((c.first_name[0] ?? "") + (c.last_name[0] ?? "")).toUpperCase() || "?"}
                  </span>
                  <span className="trunc">{name(c)}</span>
                  {has && <Check size={12} className="faint" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="pa-email">Adresse email</label>
        <input
          id="pa-email"
          className="input"
          type="email"
          autoFocus
          placeholder="claire@maisonlumen.fr"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setContact(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {already ? (
          <span className="err">Cette personne a déjà accès au portail.</span>
        ) : (
          <span className="hint">Elle créera son compte avec cette adresse et ne verra que {companyName}.</span>
        )}
      </div>
      <div className="field">
        <span className="label">Ce qu&apos;elle peut voir</span>
        <div className="seg" role="group" aria-label="Fonctionnalités de la personne" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={custom ? "" : "on"} onClick={() => setCustom(false)}>Tout ce que le portail ouvre</button>
          <button type="button" className={custom ? "on" : ""} onClick={() => setCustom(true)}>Choisir</button>
        </div>
        {custom ? (
          <div className="pa-checks">
            {open.map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  className="check"
                  checked={features.includes(f)}
                  onChange={(e) => setFeatures((l) => (e.target.checked ? [...l, f] : l.filter((x) => x !== f)))}
                />
                {PORTAL_FEATURE[f].name}
              </label>
            ))}
          </div>
        ) : (
          <span className="hint">{open.length ? open.map((f) => PORTAL_FEATURE[f].name).join(", ") : "Aucune fonctionnalité n'est ouverte sur ce portail."}</span>
        )}
        {noFeature && <span className="err">Coche au moins une fonctionnalité.</span>}
      </div>
    </Modal>
  );
}
