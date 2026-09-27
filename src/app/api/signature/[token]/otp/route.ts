import type { NextRequest } from "next/server";
import { z } from "zod";

import { emailEnabled, sendEmail } from "@/lib/email";
import { OTP_MAX_SENDS_PER_HOUR, OTP_TTL_MS, newOtpCode, otpHash } from "@/lib/signature/crypto";
import { clientInfo, fail, logEvent, otpEmail, partiesOf, signable, signatureSecret, FR } from "@/lib/signature/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const Body = z.object({ email: z.email().max(200) });

/** Envoie un code à 6 chiffres à l'adresse du signataire (valable 10 minutes). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signature/[token]/otp">) {
  const { token } = await ctx.params;
  if (!emailEnabled()) return fail("La vérification par email n'est pas disponible sur cette instance.", 400);
  const parsed = Body.safeParse(await req.json().catch(() => null), FR);
  if (!parsed.success) return fail("Adresse email invalide.");
  const email = parsed.data.email.trim().toLowerCase();

  const admin = supabaseAdmin();
  const r = await signable(admin, token);
  if ("error" in r) return r.error;
  const { p } = r;

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("proposal_otps").select("id", { count: "exact", head: true }).eq("proposal_id", p.id).gte("created_at", since);
  if ((count ?? 0) >= OTP_MAX_SENDS_PER_HOUR) return fail("Trop de codes demandés. Réessayez dans une heure.", 429);

  const code = newOtpCode();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const { data: row, error } = await admin
    .from("proposal_otps")
    .insert({ proposal_id: p.id, email, code_hash: otpHash(signatureSecret(), p.id, email, code), expires_at: expires })
    .select("id")
    .single();
  if (error) return fail("Impossible de préparer le code, réessayez.", 500);

  const parties = await partiesOf(admin, p);
  const mail = otpEmail(parties.agency, p.title, code);
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  if (!sent.sent) {
    await admin.from("proposal_otps").delete().eq("id", row.id);
    return fail("L'email n'a pas pu être envoyé. Vérifiez l'adresse ou réessayez.", 502);
  }
  await logEvent(admin, p, "otp_sent", clientInfo(req.headers), { email });
  return Response.json({ ok: true, expires_at: expires });
}
