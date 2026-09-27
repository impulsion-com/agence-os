import "server-only";

// Signature électronique : accès service role, piste d'audit, instantané, PDF et emails.
// Toutes les écritures publiques passent par ici (routes /api/signature/*), jamais par le navigateur.
import { z } from "zod";

import { computeTotals } from "@/components/proposals/lib";
import type { Database, Json } from "@/lib/database.types";
import { emailEnabled, emailLayout, sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ProposalBlock } from "@/lib/types";
import { documentHash, ipHash, sha256, truncateIp } from "./crypto";
import { renderSignedPdf, type PdfEvent, type PdfSignatureInfo } from "./pdf";
import { amountsText, consentText, fmtParis, type PublicSignature, type SignatureMethod, type SignatureSnapshot, type SnapshotItem } from "./types";

type Admin = ReturnType<typeof supabaseAdmin>;
export type ProposalRow = Database["public"]["Tables"]["proposals"]["Row"];
export type SignatureRow = Database["public"]["Tables"]["proposal_signatures"]["Row"];
type EventKind = Database["public"]["Tables"]["proposal_signature_events"]["Row"]["kind"];

export const BUCKET = "signatures";
export const TOKEN_RE = /^[0-9a-f]{16,64}$/i;

/** Clé des HMAC (codes, IP) : SIGNATURE_SECRET, à défaut la clé service role. */
export function signatureSecret() {
  const s = process.env.SIGNATURE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("SIGNATURE_SECRET ou SUPABASE_SERVICE_ROLE_KEY manquant");
  return s;
}

export interface ClientInfo {
  ip_trunc: string | null;
  ip_hash: string | null;
  user_agent: string | null;
}

/** IP (tronquée + hachée, jamais en clair) et navigateur de la requête. */
export function clientInfo(h: Headers): ClientInfo {
  const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "").trim() || null;
  return { ip_trunc: truncateIp(ip), ip_hash: ipHash(signatureSecret(), ip), user_agent: h.get("user-agent")?.slice(0, 400) ?? null };
}

/** URL publique de l'app (liens des emails). */
export function appOrigin(h?: Headers) {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = h?.get("x-forwarded-host") || h?.get("host");
  return host ? `${h?.get("x-forwarded-proto") || "http"}://${host}` : "";
}

export async function proposalByToken(admin: Admin, token: string): Promise<ProposalRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await admin.from("proposals").select("*").eq("public_token", token).maybeSingle();
  return data;
}

export async function signatureOf(admin: Admin, proposalId: string): Promise<SignatureRow | null> {
  const { data } = await admin.from("proposal_signatures").select("*").eq("proposal_id", proposalId).maybeSingle();
  return data;
}

export async function logEvent(
  admin: Admin,
  p: Pick<ProposalRow, "id" | "workspace_id">,
  kind: EventKind,
  info?: Partial<ClientInfo> | null,
  meta: Record<string, unknown> = {},
) {
  await admin.from("proposal_signature_events").insert({
    proposal_id: p.id,
    workspace_id: p.workspace_id,
    kind,
    ip_trunc: info?.ip_trunc ?? null,
    ip_hash: info?.ip_hash ?? null,
    user_agent: info?.user_agent ?? null,
    meta: meta as Json,
  });
}

/** Ouverture de la page client : journalisée au plus une fois par demi-heure et par IP. */
export async function logOpened(admin: Admin, p: Pick<ProposalRow, "id" | "workspace_id">, info: ClientInfo) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  let q = admin.from("proposal_signature_events").select("id").eq("proposal_id", p.id).eq("kind", "opened").gte("at", since).limit(1);
  q = info.ip_hash ? q.eq("ip_hash", info.ip_hash) : q.is("ip_hash", null);
  const { data } = await q;
  if (!data?.length) await logEvent(admin, p, "opened", info);
}

/** Parties du document : agence, client, contact, responsable. */
export async function partiesOf(admin: Admin, p: ProposalRow) {
  const [ws, company, contact, owner] = await Promise.all([
    admin.from("workspaces").select("name").eq("id", p.workspace_id).single(),
    p.company_id ? admin.from("companies").select("name").eq("id", p.company_id).maybeSingle() : Promise.resolve({ data: null }),
    p.contact_id ? admin.from("contacts").select("first_name, last_name, email").eq("id", p.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    p.owner_id ? admin.from("profiles").select("full_name, email, title").eq("id", p.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    agency: ws.data?.name ?? "",
    client: company.data?.name ?? null,
    contact: contact.data ? `${contact.data.first_name} ${contact.data.last_name}`.trim() : null,
    contactEmail: (contact.data as { email?: string | null } | null)?.email ?? null,
    owner: owner.data ? { full_name: owner.data.full_name, email: owner.data.email, title: owner.data.title ?? "" } : null,
  };
}

export interface SignerInput {
  first_name: string;
  last_name: string;
  role: string;
  company: string;
  email: string;
  email_verified_at: string | null;
}

/** Construit l'instantané figé (options retenues appliquées) et le texte de consentement. */
export async function buildSnapshot(
  admin: Admin,
  p: ProposalRow,
  selected: Set<string>,
  signer: SignerInput,
  sig: { method: SignatureMethod; image_sha256: string; mention: string; signed_at: string },
): Promise<SignatureSnapshot> {
  const [{ data: rows }, parties] = await Promise.all([
    admin.from("proposal_items").select("*").eq("proposal_id", p.id).order("position"),
    partiesOf(admin, p),
  ]);
  const items: SnapshotItem[] = (rows ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    quantity: Number(i.quantity),
    unit_price: Number(i.unit_price),
    billing: i.billing as SnapshotItem["billing"],
    optional: i.optional,
    selected: !i.optional || selected.has(i.id),
    position: i.position,
  }));
  const t = computeTotals(items, Number(p.discount_pct), Number(p.tax_pct));
  const totals = { monthly: t.monthly, one_off: t.one_off };
  const document = {
    number: p.number,
    title: p.title,
    currency: p.currency,
    discount_pct: Number(p.discount_pct),
    tax_pct: Number(p.tax_pct),
    valid_until: p.valid_until,
    date: (p.sent_at ?? p.created_at).slice(0, 10),
    blocks: (Array.isArray(p.blocks) ? p.blocks : []) as unknown as ProposalBlock[],
  };
  const consent = consentText({
    first_name: signer.first_name,
    last_name: signer.last_name,
    role: signer.role,
    company: signer.company,
    number: p.number,
    title: p.title,
    agency: parties.agency,
    amounts: amountsText(totals, p.currency),
  });
  return {
    v: 1,
    proposal_id: p.id,
    document,
    items,
    totals,
    parties: { agency: parties.agency, client: parties.client, contact: parties.contact, owner: parties.owner },
    signer: {
      first_name: signer.first_name,
      last_name: signer.last_name,
      role: signer.role,
      company: signer.company,
      email: signer.email,
      email_verified: !!signer.email_verified_at,
      email_verified_at: signer.email_verified_at,
    },
    signature: { method: sig.method, image_sha256: sig.image_sha256 },
    mention: sig.mention,
    consent,
    signed_at: sig.signed_at,
  };
}

/** L'instantané stocké correspond-il toujours à l'empreinte enregistrée ? */
export const integrityOk = (sig: Pick<SignatureRow, "snapshot" | "document_hash">) => documentHash(sig.snapshot) === sig.document_hash;

export async function download(admin: Admin, path: string | null): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data } = await admin.storage.from(BUCKET).download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

const dataUrl = (bytes: Uint8Array | null, type = "image/png") => (bytes ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null);

/** Signature telle que la page publique peut l'afficher (images en data URL, sans IP). */
export async function publicSignature(admin: Admin, sig: SignatureRow): Promise<PublicSignature> {
  const [img, agency] = await Promise.all([download(admin, sig.signature_path), download(admin, sig.countersign_path)]);
  return {
    signed_at: sig.signed_at,
    signer_name: `${sig.signer_first_name} ${sig.signer_last_name}`.trim(),
    signer_role: sig.signer_role,
    signer_company: sig.signer_company,
    method: sig.signature_method as SignatureMethod,
    document_hash: sig.document_hash,
    email_verified: sig.email_verified,
    countersign_required: sig.countersign_required,
    countersigned_at: sig.countersigned_at,
    countersigner_name: sig.countersigner_name,
    countersigner_role: sig.countersigner_role,
    image: dataUrl(img),
    agency_image: dataUrl(agency),
    has_pdf: !!sig.pdf_path,
  };
}

const pdfInfo = (s: SignatureRow): PdfSignatureInfo => ({
  document_hash: s.document_hash,
  signed_at: s.signed_at,
  signer_email: s.signer_email,
  email_verified: s.email_verified,
  email_verified_at: s.email_verified_at,
  mention: s.mention,
  consent_text: s.consent_text,
  signature_method: s.signature_method as SignatureMethod,
  signature_hash: s.signature_hash,
  ip_trunc: s.ip_trunc,
  ip_hash: s.ip_hash,
  user_agent: s.user_agent,
  countersign_required: s.countersign_required,
  countersigned_at: s.countersigned_at,
  countersigner_name: s.countersigner_name,
  countersigner_role: s.countersigner_role,
  countersign_method: s.countersign_method as SignatureMethod | null,
  countersign_hash: s.countersign_hash,
  countersign_ip_trunc: s.countersign_ip_trunc,
  countersign_user_agent: s.countersign_user_agent,
});

export const pdfPath = (s: Pick<SignatureRow, "workspace_id" | "proposal_id">) => `${s.workspace_id}/${s.proposal_id}/proposition-signee.pdf`;
export const pdfFilename = (number: number) => `proposition-${number}-signee.pdf`;

/**
 * Génère le PDF signé (document + signatures + certificat), le range dans le bucket
 * privé et enregistre son empreinte. Renvoie les octets.
 */
export async function generatePdf(admin: Admin, sig: SignatureRow): Promise<Uint8Array> {
  const [{ data: events }, clientPng, agencyPng] = await Promise.all([
    admin.from("proposal_signature_events").select("kind, at, ip_trunc, user_agent, meta").eq("proposal_id", sig.proposal_id).order("at"),
    download(admin, sig.signature_path),
    download(admin, sig.countersign_path),
  ]);
  if (!clientPng) throw new Error("Image de signature introuvable");
  const bytes = await renderSignedPdf({
    snapshot: sig.snapshot as unknown as SignatureSnapshot,
    sig: pdfInfo(sig),
    events: (events ?? []) as PdfEvent[],
    clientPng,
    agencyPng,
  });
  const path = pdfPath(sig);
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`Stockage du PDF impossible : ${up.error.message}`);
  const at = new Date().toISOString();
  const hash = sha256(bytes);
  await admin.from("proposal_signatures").update({ pdf_path: path, pdf_hash: hash, pdf_generated_at: at }).eq("id", sig.id);
  await logEvent(admin, { id: sig.proposal_id, workspace_id: sig.workspace_id }, "pdf_generated", null, { sha256: hash });
  return bytes;
}

// ---------------------------------------------------------------------
// Emails (facultatifs : sans configuration, rien n'est envoyé)
// ---------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function otpEmail(agency: string, title: string, code: string) {
  return {
    subject: `${code} : votre code de signature`,
    html: emailLayout({
      agency,
      title: "Votre code de vérification",
      body:
        `<p>Pour signer la proposition « ${esc(title)} », saisissez ce code sur la page de signature :</p>` +
        `<p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:18px 0;font-family:Menlo,Consolas,monospace">${code}</p>` +
        `<p style="color:#6b6760;font-size:13px">Il est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
    }),
    text: `Votre code de signature : ${code} (valable 10 minutes).`,
  };
}

/** Confirmation au client et au responsable, avec le PDF signé en pièce jointe. */
export async function sendSignedEmails(admin: Admin, sig: SignatureRow, pdf: Uint8Array | null, origin: string, token: string, kind: "signed" | "countersigned") {
  if (!emailEnabled()) return;
  const s = sig.snapshot as unknown as SignatureSnapshot;
  const url = `${origin}/p/${token}`;
  const attachments = pdf ? [{ filename: pdfFilename(s.document.number), content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf" }] : undefined;
  const who = `${sig.signer_first_name} ${sig.signer_last_name}`.trim();
  const sent: string[] = [];

  const clientBody =
    kind === "signed"
      ? `<p>Bonjour ${esc(sig.signer_first_name)},</p><p>Votre signature de la proposition « ${esc(s.document.title)} » a bien été enregistrée le ${esc(fmtParis(sig.signed_at))}.</p>` +
        (sig.countersign_required ? `<p>${esc(s.parties.agency)} va la contre-signer : vous recevrez alors la version finale.</p>` : "") +
        `<p>Vous trouverez en pièce jointe le document signé et son certificat de signature.</p>`
      : `<p>Bonjour ${esc(sig.signer_first_name)},</p><p>${esc(s.parties.agency)} a contre-signé la proposition « ${esc(s.document.title)} ». Elle est désormais signée par les deux parties.</p><p>Vous trouverez en pièce jointe la version finale et son certificat de signature.</p>`;
  const r1 = await sendEmail({
    to: sig.signer_email,
    subject: kind === "signed" ? `Proposition signée : ${s.document.title}` : `Proposition signée par les deux parties : ${s.document.title}`,
    html: emailLayout({ agency: s.parties.agency, title: kind === "signed" ? "Signature enregistrée" : "Signée par les deux parties", body: clientBody, cta: { label: "Revoir la proposition", url } }),
    replyTo: s.parties.owner?.email,
    attachments,
  });
  if (r1.sent) sent.push(sig.signer_email);

  if (kind === "signed" && s.parties.owner?.email) {
    const r2 = await sendEmail({
      to: s.parties.owner.email,
      subject: `${who} a signé « ${s.document.title} »`,
      html: emailLayout({
        agency: s.parties.agency,
        title: "Proposition signée",
        body:
          `<p>${esc(who)}${sig.signer_company ? ` (${esc(sig.signer_company)})` : ""} a signé la proposition n° ${s.document.number} « ${esc(s.document.title)} » le ${esc(fmtParis(sig.signed_at))}.</p>` +
          (sig.countersign_required ? `<p><strong>Ta contre-signature est attendue</strong> : ouvre la proposition dans l'app, onglet « Preuve de signature ».</p>` : "") +
          `<p>Le PDF signé et son certificat sont en pièce jointe.</p>`,
      }),
      attachments,
    });
    if (r2.sent) sent.push(s.parties.owner.email);
  }
  if (sent.length) await logEvent(admin, { id: sig.proposal_id, workspace_id: sig.workspace_id }, "emails_sent", null, { to: sent.join(", "), kind });
}

// ---------------------------------------------------------------------
// Aides des routes
// ---------------------------------------------------------------------
export const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** Messages de validation zod en français (les messages personnalisés des schémas restent prioritaires). */
export const FR = { error: z.locales.fr().localeError };

/** Proposition ouverte à la signature : envoyée ou vue, non expirée, pas encore signée. */
export async function signable(admin: Admin, token: string): Promise<{ p: ProposalRow } | { error: Response }> {
  const p = await proposalByToken(admin, token);
  if (!p || p.status === "draft") return { error: fail("Proposition introuvable.", 404) };
  if (await signatureOf(admin, p.id)) return { error: fail("Cette proposition est déjà signée.", 409) };
  if (p.status !== "sent" && p.status !== "viewed") return { error: fail("Cette proposition n'est plus disponible à la signature.", 409) };
  if (p.valid_until && p.valid_until < new Date().toISOString().slice(0, 10)) return { error: fail("Cette proposition a expiré.", 410) };
  return { p };
}

/** Image de signature : PNG en data URL, taille et dimensions raisonnables. */
export function parsePng(url: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  const b = new Uint8Array(Buffer.from(m[1], "base64"));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 200 || b.length > 600_000 || sig.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  if (!w || !h || w > 2400 || h > 1200) return null;
  return b;
}

/** Envoi de la proposition (ou relance) au client par email. */
export function proposalEmail(o: { agency: string; title: string; number: number; url: string; first?: string | null; message?: string; reminder?: boolean; validUntil?: string | null; sender: string }) {
  const hello = `<p>Bonjour${o.first ? " " + esc(o.first) : ""},</p>`;
  const msg = o.message?.trim() ? `<p>${esc(o.message.trim()).replace(/\n/g, "<br>")}</p>` : "";
  const intro = o.reminder
    ? `<p>Je me permets de revenir vers vous au sujet de notre proposition « ${esc(o.title)} ».</p>`
    : `<p>Suite à notre échange, voici notre proposition « ${esc(o.title)} ».</p>`;
  const until = o.validUntil ? `<p style="color:#6b6760;font-size:13px">Elle est valable jusqu'au ${esc(new Date(o.validUntil + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }))}.</p>` : "";
  return {
    subject: o.reminder ? `Rappel : ${o.title}` : `Proposition : ${o.title}`,
    html: emailLayout({
      agency: o.agency,
      title: o.reminder ? "Votre proposition vous attend" : `Proposition n° ${o.number}`,
      body:
        hello +
        intro +
        msg +
        `<p>Vous pouvez la consulter, choisir les options qui vous intéressent et la signer en ligne en quelques minutes, sans créer de compte.</p>` +
        until +
        `<p>Bien cordialement,<br>${esc(o.sender)}<br>${esc(o.agency)}</p>`,
      cta: { label: "Consulter et signer", url: o.url },
    }),
    text: `${o.reminder ? "Rappel" : "Proposition"} : ${o.title}\n\nConsulter et signer : ${o.url}`,
  };
}
