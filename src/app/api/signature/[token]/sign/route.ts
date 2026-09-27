import { after, type NextRequest } from "next/server";
import { z } from "zod";

import type { Json } from "@/lib/database.types";
import { emailEnabled } from "@/lib/email";
import { OTP_PROOF_TTL_MS, documentHash, sha256 } from "@/lib/signature/crypto";
import {
  BUCKET, appOrigin, buildSnapshot, clientInfo, fail, generatePdf, parsePng, sendSignedEmails, signable, signatureOf, FR } from "@/lib/signature/server";
import { mentionOk } from "@/lib/signature/types";
import { supabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 30;

const name = (max: number) => z.string().trim().min(1, "Champ obligatoire").max(max);
const Body = z.object({
  version: z.string().min(10).max(40),
  first_name: name(80),
  last_name: name(80),
  role: z.string().trim().max(120).default(""),
  company: z.string().trim().max(160).default(""),
  email: z.email("Adresse email invalide").max(200),
  mention: z.string().trim().max(60),
  consent: z.literal(true, "Le consentement est obligatoire."),
  method: z.enum(["drawn", "typed"]),
  image: z.string().max(900_000),
  selected: z.array(z.uuid()).max(200).default([]),
  otp_proof: z.string().regex(/^[0-9a-f]{48}$/).optional(),
});

/**
 * Signature par le client : contrôles, instantané figé + empreinte, image stockée,
 * enregistrement atomique (RPC), PDF signé, puis emails de confirmation.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signature/[token]/sign">) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null), FR);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides.");
  const b = parsed.data;
  if (!mentionOk(b.mention)) return fail("Merci de recopier la mention « Bon pour accord ».");
  const png = parsePng(b.image);
  if (!png) return fail("La signature n'est pas lisible, merci de la refaire.");

  const admin = supabaseAdmin();
  const r = await signable(admin, token);
  if ("error" in r) return r.error;
  const { p } = r;
  const email = b.email.trim().toLowerCase();

  // Vérification de l'email obligatoire quand l'envoi d'emails est configuré
  let verifiedAt: string | null = null;
  if (emailEnabled()) {
    if (!b.otp_proof) return fail("Merci de vérifier votre adresse email avant de signer.");
    const { data: otp } = await admin
      .from("proposal_otps")
      .select("id, verified_at")
      .eq("proposal_id", p.id)
      .eq("email", email)
      .eq("proof_hash", sha256(b.otp_proof))
      .not("verified_at", "is", null)
      .maybeSingle();
    if (!otp?.verified_at || Date.now() - new Date(otp.verified_at).getTime() > OTP_PROOF_TTL_MS) {
      return fail("La vérification de votre email a expiré : demandez un nouveau code.");
    }
    verifiedAt = otp.verified_at;
  }

  // Le client signe la version qu'il a relue
  if (new Date(b.version).getTime() !== new Date(p.updated_at).getTime()) {
    return fail("La proposition a été mise à jour depuis votre ouverture. Rechargez la page pour relire la dernière version avant de signer.", 409);
  }

  const { data: items } = await admin.from("proposal_items").select("id, optional").eq("proposal_id", p.id);
  const optionIds = new Set((items ?? []).filter((i) => i.optional).map((i) => i.id));
  const selected = new Set(b.selected.filter((id) => optionIds.has(id)));

  const signedAt = new Date().toISOString();
  const imageHash = sha256(png);
  const snapshot = await buildSnapshot(
    admin,
    p,
    selected,
    { first_name: b.first_name, last_name: b.last_name, role: b.role, company: b.company, email, email_verified_at: verifiedAt },
    { method: b.method, image_sha256: imageHash, mention: b.mention, signed_at: signedAt },
  );
  const hash = documentHash(snapshot);

  const path = `${p.workspace_id}/${p.id}/signature-client.png`;
  const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
  if (up.error) return fail("Enregistrement de la signature impossible, réessayez.", 500);

  const info = clientInfo(req.headers);
  const { error } = await admin.rpc("sign_proposal_commit", {
    p_proposal: p.id,
    p_version: p.updated_at,
    p_selected: [...selected],
    p_sig: {
      snapshot: snapshot as unknown as Json,
      document_hash: hash,
      signed_at: signedAt,
      signer_first_name: b.first_name,
      signer_last_name: b.last_name,
      signer_role: b.role,
      signer_company: b.company,
      signer_email: email,
      email_verified: !!verifiedAt,
      email_verified_at: verifiedAt,
      mention: b.mention,
      consent_text: snapshot.consent,
      signature_method: b.method,
      signature_path: path,
      signature_hash: imageHash,
      ...info,
    },
    p_event: { ...info },
  });
  if (error) {
    const msg = error.message.replace(/^VERSION: /, "");
    return fail(
      error.message.startsWith("VERSION") ? `${msg} Rechargez la page pour relire la dernière version avant de signer.` : msg,
      409,
    );
  }

  const sig = await signatureOf(admin, p.id);
  let pdf: Uint8Array | null = null;
  if (sig) {
    try {
      pdf = await generatePdf(admin, sig);
    } catch (e) {
      console.error("[signature] PDF", e);
    }
    const origin = appOrigin(req.headers);
    const fresh = pdf ? ((await signatureOf(admin, p.id)) ?? sig) : sig;
    after(() => sendSignedEmails(admin, fresh, pdf, origin, token, "signed").catch((e) => console.error("[signature] emails", e)));
  }
  return Response.json({ ok: true, signed_at: signedAt, document_hash: hash, has_pdf: !!pdf });
}
