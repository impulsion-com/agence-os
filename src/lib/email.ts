import "server-only";

// Envoi d'emails transactionnels (signature, rendez-vous, onboarding…) via l'API Resend.
// Facultatif : sans RESEND_API_KEY, rien n'est envoyé et la fonction renvoie { sent: false }.
// Les fonctionnalités doivent toujours marcher sans email (liens à copier, notifications in-app).

export interface EmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  // Pièce jointe éventuelle (ex. invitation .ics), contenu en base64
  attachments?: { filename: string; content: string; contentType?: string }[];
}

export const emailEnabled = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

export async function sendEmail(input: EmailInput): Promise<{ sent: boolean; error?: string }> {
  if (!emailEnabled()) return { sent: false, error: "Envoi d'emails non configuré (RESEND_API_KEY, EMAIL_FROM)" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
        attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })),
      }),
    });
    if (!res.ok) return { sent: false, error: `Resend ${res.status} : ${(await res.text()).slice(0, 300)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Gabarit HTML sobre commun à tous les emails (nom de l'agence en en-tête)
export function emailLayout({ agency, title, body, cta }: { agency: string; title: string; body: string; cta?: { label: string; url: string } }) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1c1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:10px;border:1px solid #e9e7e2">
<tr><td style="padding:24px 28px 8px;font-size:13px;color:#6b6760;font-weight:600">${esc(agency)}</td></tr>
<tr><td style="padding:4px 28px 0;font-size:20px;font-weight:600">${esc(title)}</td></tr>
<tr><td style="padding:12px 28px 8px;font-size:15px;line-height:1.6;color:#3a3833">${body}</td></tr>
${cta ? `<tr><td style="padding:12px 28px 28px"><a href="${esc(cta.url)}" style="display:inline-block;background:#4b5bd6;color:#fff;text-decoration:none;padding:11px 18px;border-radius:7px;font-weight:600;font-size:14px">${esc(cta.label)}</a></td></tr>` : `<tr><td style="padding:0 0 20px"></td></tr>`}
</table></td></tr></table></body></html>`;
}
