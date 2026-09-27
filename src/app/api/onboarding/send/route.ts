import type { NextRequest } from "next/server";
import { z } from "zod";

import { emailEnabled } from "@/lib/email";
import { appOrigin, json, publicLink, sendInviteEmail } from "@/lib/onboarding/server";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ form_id: z.string().uuid(), reminder: z.boolean().optional() });

/**
 * POST /api/onboarding/send : envoie (ou relance) le lien du formulaire au contact par email.
 * Sans configuration Resend, renvoie { sent: false, url } : l'app propose de copier le lien.
 * Une relance est comptée même sans email (l'agence envoie alors le lien elle-même).
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requête invalide" }, 400);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "Connexion requise" }, 401);

  // Lecture et écriture avec les droits de l'utilisateur (RLS)
  const { data: form } = await sb
    .from("onboarding_forms")
    .select("id, workspace_id, token, title, intro, status, progress, contact_id")
    .eq("id", parsed.data.form_id)
    .maybeSingle();
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  const { data: canWrite } = await sb.rpc("can_write", { ws: form.workspace_id });
  if (!canWrite) return json({ error: "Les invités ne peuvent pas envoyer de formulaire" }, 403);
  if (form.status === "completed") return json({ error: "Ce formulaire est déjà terminé" }, 409);

  const url = publicLink(appOrigin(req), form.token);
  const reminder = !!parsed.data.reminder;
  const [{ data: ws }, { data: contact }, { data: me }] = await Promise.all([
    sb.from("workspaces").select("name").eq("id", form.workspace_id).single(),
    form.contact_id ? sb.from("contacts").select("first_name, email").eq("id", form.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("profiles").select("email").eq("id", auth.user.id).single(),
  ]);

  let sent = false;
  let error: string | undefined;
  if (emailEnabled() && contact?.email) {
    const r = await sendInviteEmail({
      to: contact.email,
      firstName: contact.first_name,
      agency: ws?.name ?? "",
      title: form.title,
      url,
      reminder,
      progress: form.progress,
      replyTo: me?.email,
      intro: form.intro,
    });
    sent = r.sent;
    error = r.error;
  } else if (emailEnabled()) {
    error = "Ce contact n'a pas d'adresse email";
  }

  const now = new Date().toISOString();
  if (reminder) {
    const { data: cur } = await sb.from("onboarding_forms").select("remind_count").eq("id", form.id).single();
    await sb.from("onboarding_forms").update({ reminded_at: now, remind_count: (cur?.remind_count ?? 0) + 1 }).eq("id", form.id);
  } else if (sent) {
    await sb.from("onboarding_forms").update({ email_sent_at: now }).eq("id", form.id);
  }
  return json({ sent, url, email: sent ? contact?.email : undefined, error, emailEnabled: emailEnabled() });
}
