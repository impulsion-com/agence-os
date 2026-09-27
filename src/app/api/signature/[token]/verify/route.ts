import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkOtp, newProof, otpHash, sha256 } from "@/lib/signature/crypto";
import { clientInfo, fail, logEvent, signable, signatureSecret, FR } from "@/lib/signature/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const Body = z.object({ email: z.email().max(200), code: z.string().trim().regex(/^\d{6}$/, "Le code comporte 6 chiffres.") });

/** Vérifie le code (5 essais, 10 minutes) et remet une preuve à usage unique exigée à la signature. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signature/[token]/verify">) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null), FR);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide.");
  const email = parsed.data.email.trim().toLowerCase();

  const admin = supabaseAdmin();
  const r = await signable(admin, token);
  if ("error" in r) return r.error;
  const { p } = r;

  const { data: row } = await admin
    .from("proposal_otps")
    .select("*")
    .eq("proposal_id", p.id)
    .eq("email", email)
    .is("verified_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return fail("Aucun code en cours pour cette adresse : demandez un nouveau code.");

  const info = clientInfo(req.headers);
  const res = checkOtp(row, parsed.data.code, otpHash(signatureSecret(), p.id, email, parsed.data.code));
  if (!res.ok) {
    if (res.reason === "wrong") {
      await admin.from("proposal_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      await logEvent(admin, p, "otp_failed", info, { email });
      return fail(res.left ? `Code incorrect. Il vous reste ${res.left} essai${res.left > 1 ? "s" : ""}.` : "Code incorrect. Demandez un nouveau code.");
    }
    return fail(res.reason === "expired" ? "Ce code a expiré : demandez-en un nouveau." : "Trop d'essais : demandez un nouveau code.", res.reason === "locked" ? 429 : 400);
  }

  const proof = newProof();
  const at = new Date().toISOString();
  await admin.from("proposal_otps").update({ verified_at: at, proof_hash: sha256(proof), attempts: row.attempts + 1 }).eq("id", row.id);
  await logEvent(admin, p, "otp_verified", info, { email });
  return Response.json({ ok: true, proof, verified_at: at });
}
