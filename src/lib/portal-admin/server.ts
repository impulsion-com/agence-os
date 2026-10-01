import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { emailLayout, sendEmail } from "@/lib/email";
import type { PortalFeature } from "@/lib/types";
import { PORTAL_FEATURE, portalPath, sortFeatures } from "./features";

// Emails envoyés aux clients par l'agence (invitation au portail, éléments à valider, rapport publié).
// Tout ce que lit le client est au vouvoiement.

type DB = SupabaseClient<Database>;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Origine publique de l'app (liens envoyés aux clients) */
export function appOrigin(req: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, "");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface Recipient {
  email: string;
  firstName: string;
}

/**
 * Personnes d'un client à prévenir pour une fonctionnalité : portail activé, fonctionnalité ouverte
 * au niveau du portail et de la personne. Lecture avec les droits du membre connecté (RLS).
 */
export async function portalRecipients(sb: DB, companyId: string, feature: PortalFeature): Promise<Recipient[]> {
  const [{ data: portal }, { data: users }] = await Promise.all([
    sb.from("client_portals").select("enabled, features").eq("company_id", companyId).maybeSingle(),
    sb.from("client_users").select("features, profile:profiles(email, full_name)").eq("company_id", companyId),
  ]);
  if (!portal?.enabled || !portal.features.includes(feature)) return [];
  const out: Recipient[] = [];
  for (const u of users ?? []) {
    const p = u.profile as unknown as { email: string; full_name: string } | null;
    if (!p?.email || (u.features && !u.features.includes(feature))) continue;
    out.push({ email: p.email, firstName: (p.full_name ?? "").trim().split(/\s+/)[0] ?? "" });
  }
  return out;
}

const hello = (firstName: string) => `<p>Bonjour${firstName ? ` ${esc(firstName)}` : ""},</p>`;

/** Invitation (ou relance) à rejoindre le portail */
export function sendPortalInvite(opt: {
  to: string;
  firstName: string;
  agency: string;
  company: string;
  features: readonly string[];
  url: string;
  welcome?: string;
  reminder?: boolean;
  replyTo?: string;
}) {
  const list = sortFeatures(opt.features)
    .map((f) => `<li>${esc(PORTAL_FEATURE[f].name)}</li>`)
    .join("");
  const body =
    hello(opt.firstName) +
    (opt.reminder
      ? `<p>Votre espace client chez <b>${esc(opt.agency)}</b> vous attend toujours. Il vous suffit de créer votre compte pour y accéder.</p>`
      : `<p><b>${esc(opt.agency)}</b> vous ouvre un espace client pour <b>${esc(opt.company)}</b>.</p>`) +
    (opt.welcome && !opt.reminder ? `<p>${esc(opt.welcome).replace(/\n/g, "<br>")}</p>` : "") +
    (list ? `<p>Vous y retrouverez :</p><ul style="margin:0 0 12px;padding-left:20px">${list}</ul>` : "") +
    `<p>Créez votre compte avec l'adresse <b>${esc(opt.to)}</b> : l'invitation est rattachée à cette adresse.</p>` +
    `<p style="font-size:13px;color:#6b6760">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${esc(opt.url)}</p>`;
  return sendEmail({
    to: opt.to,
    replyTo: opt.replyTo,
    subject: opt.reminder ? `Rappel : votre espace client ${opt.agency} vous attend` : `${opt.agency} vous invite dans votre espace client`,
    html: emailLayout({ agency: opt.agency, title: "Votre espace client est prêt", body, cta: { label: "Accéder à mon espace", url: opt.url } }),
    text: `${opt.agency} vous ouvre un espace client pour ${opt.company}. Créez votre compte avec l'adresse ${opt.to} : ${opt.url}`,
  });
}

export interface ClientNotice {
  subject: string;
  title: string;
  // phrase d'introduction (texte brut)
  intro: string;
  // éléments concernés (titres)
  items: string[];
  cta: { label: string; link: string };
}

/** Email récapitulatif vers les personnes d'un client, avec un lien vers le portail */
export async function sendClientNotice(opt: { to: Recipient[]; agency: string; origin: string; slug: string; companyId: string; notice: ClientNotice; replyTo?: string }) {
  const url = opt.origin + portalPath(opt.slug, opt.companyId, opt.notice.cta.link);
  const list = opt.notice.items.length
    ? `<ul style="margin:0 0 12px;padding-left:20px">${opt.notice.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
    : "";
  let sent = 0;
  let error: string | undefined;
  for (const r of opt.to) {
    const res = await sendEmail({
      to: r.email,
      replyTo: opt.replyTo,
      subject: opt.notice.subject,
      html: emailLayout({
        agency: opt.agency,
        title: opt.notice.title,
        body: hello(r.firstName) + `<p>${esc(opt.notice.intro)}</p>` + list,
        cta: { label: opt.notice.cta.label, url },
      }),
      text: `${opt.notice.intro}\n${opt.notice.items.map((t) => `- ${t}`).join("\n")}\n\n${url}`,
    });
    if (res.sent) sent++;
    else error = res.error;
  }
  return { sent, error };
}
