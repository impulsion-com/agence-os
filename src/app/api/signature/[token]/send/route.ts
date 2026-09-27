import type { NextRequest } from "next/server";
import { z } from "zod";

import { emailEnabled, sendEmail } from "@/lib/email";
import { appOrigin, fail, logEvent, partiesOf, proposalByToken, proposalEmail, signatureOf, FR } from "@/lib/signature/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const Body = z.object({
  to: z.email("Adresse email invalide").max(200),
  message: z.string().max(2000).default(""),
  reminder: z.boolean().default(false),
});

/**
 * Envoi (ou relance) de la proposition au client par email, depuis l'éditeur.
 * Le passage en « Envoyée » reste fait par l'éditeur ; cette route n'expédie que l'email.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signature/[token]/send">) {
  const { token } = await ctx.params;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return fail("Non authentifié.", 401);
  if (!emailEnabled()) return fail("L'envoi d'emails n'est pas configuré (RESEND_API_KEY, EMAIL_FROM).", 400);

  const parsed = Body.safeParse(await req.json().catch(() => null), FR);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides.");

  const admin = supabaseAdmin();
  const p = await proposalByToken(admin, token);
  if (!p) return fail("Proposition introuvable.", 404);
  const { data: canWrite } = await sb.rpc("can_write", { ws: p.workspace_id });
  if (!canWrite) return fail("Tu n'as pas les droits d'envoi dans cet espace.", 403);
  if (p.status === "draft") return fail("Passe d'abord la proposition en « Envoyée ».", 409);
  if (await signatureOf(admin, p.id)) return fail("Cette proposition est déjà signée.", 409);

  const [parties, me] = await Promise.all([
    partiesOf(admin, p),
    admin.from("profiles").select("full_name, email").eq("id", auth.user.id).maybeSingle(),
  ]);
  const first = parties.contact?.split(" ")[0] ?? null;
  const mail = proposalEmail({
    agency: parties.agency,
    title: p.title,
    number: p.number,
    url: `${appOrigin(req.headers)}/p/${token}`,
    first: parties.contactEmail?.toLowerCase() === parsed.data.to.toLowerCase() ? first : null,
    message: parsed.data.message,
    reminder: parsed.data.reminder,
    validUntil: p.valid_until,
    sender: me.data?.full_name ?? parties.agency,
  });
  const res = await sendEmail({ to: parsed.data.to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: me.data?.email ?? undefined });
  if (!res.sent) return fail(res.error ?? "Envoi impossible.", 502);
  await logEvent(admin, p, parsed.data.reminder ? "reminder_sent" : "email_sent", null, { to: parsed.data.to, by: auth.user.id });
  return Response.json({ ok: true });
}
