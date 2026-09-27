import "server-only";

import { emailLayout } from "@/lib/email";
import { LOCATION, fmtWhen, type LocationKind } from "./shared";
import { tzLabel } from "./engine";

// Contenu des emails de la prise de rendez-vous. Vouvoiement côté prospect,
// tutoiement côté membre. Tout texte saisi est échappé.

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface MailCtx {
  agency: string;
  host: { name: string; email: string };
  typeName: string;
  guest: { name: string; email: string; tz: string };
  start: string;
  end: string;
  hostTz: string;
  locationKind: LocationKind | string;
  location: string;
  meetUrl: string;
  manageUrl: string;
  appUrl?: string;
  answers?: { label: string; value: string }[];
  reason?: string;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

function whereHtml(c: MailCtx) {
  if (c.meetUrl) return `Visio : <a href="${esc(c.meetUrl)}">${esc(c.meetUrl)}</a>`;
  if (c.locationKind === "phone") return `Par téléphone${c.location ? ` au ${esc(c.location)}` : ""}`;
  if (c.locationKind === "address" && c.location) return `Adresse : ${esc(c.location)}`;
  if (c.locationKind === "video" && c.location) return `Visio : <a href="${esc(c.location)}">${esc(c.location)}</a>`;
  if (c.locationKind === "google_meet") return "Le lien de la visio vous sera communiqué avant le rendez-vous.";
  return esc(LOCATION[c.locationKind as LocationKind]?.name ?? "");
}

const whenGuest = (c: MailCtx) => `<b>${esc(fmtWhen(c.start, c.end, c.guest.tz))}</b> <span style="color:#6b6760">(${esc(tzLabel(c.guest.tz, Date.parse(c.start)))})</span>`;
const whenHost = (c: MailCtx) => `<b>${esc(fmtWhen(c.start, c.end, c.hostTz))}</b>`;
const manageLinks = (c: MailCtx) =>
  `<p style="margin-top:14px;font-size:13px;color:#6b6760">Un empêchement ? <a href="${esc(c.manageUrl)}">Déplacer ou annuler le rendez-vous</a>.</p>`;

function answersHtml(c: MailCtx) {
  if (!c.answers?.length) return "";
  return `<table role="presentation" style="margin-top:12px;font-size:14px;border-collapse:collapse">${c.answers
    .map((a) => `<tr><td style="padding:3px 12px 3px 0;color:#6b6760;vertical-align:top">${esc(a.label)}</td><td style="padding:3px 0">${esc(a.value).replace(/\n/g, "<br>")}</td></tr>`)
    .join("")}</table>`;
}

export function guestConfirmed(c: MailCtx, rescheduled = false) {
  const title = rescheduled ? "Votre rendez-vous a été déplacé" : "Votre rendez-vous est confirmé";
  const body = `<p>Bonjour ${esc(firstName(c.guest.name))},</p>
<p style="margin-top:10px">Votre ${esc(c.typeName.toLowerCase())} avec ${esc(c.host.name)} ${rescheduled ? "a lieu désormais" : "est bien réservé"} :<br>${whenGuest(c)}</p>
<p style="margin-top:10px">${whereHtml(c)}</p>${manageLinks(c)}`;
  return {
    subject: `${rescheduled ? "Rendez-vous déplacé" : "Rendez-vous confirmé"} : ${c.typeName} avec ${c.host.name}`,
    html: emailLayout({ agency: c.agency, title, body, cta: c.meetUrl ? { label: "Rejoindre la visio", url: c.meetUrl } : { label: "Voir le rendez-vous", url: c.manageUrl } }),
  };
}

export function guestCancelled(c: MailCtx, byHost: boolean) {
  const body = `<p>Bonjour ${esc(firstName(c.guest.name))},</p>
<p style="margin-top:10px">${byHost ? `${esc(c.host.name)} a dû annuler votre rendez-vous` : "Votre rendez-vous a bien été annulé"} :<br>${whenGuest(c)}</p>
${c.reason ? `<p style="margin-top:10px;color:#57544e">« ${esc(c.reason)} »</p>` : ""}`;
  return {
    subject: `Rendez-vous annulé : ${c.typeName} avec ${c.host.name}`,
    html: emailLayout({ agency: c.agency, title: "Rendez-vous annulé", body, cta: c.appUrl ? { label: "Choisir un autre créneau", url: c.appUrl } : undefined }),
  };
}

export function guestReminder(c: MailCtx, soon: boolean) {
  const body = `<p>Bonjour ${esc(firstName(c.guest.name))},</p>
<p style="margin-top:10px">Petit rappel : votre ${esc(c.typeName.toLowerCase())} avec ${esc(c.host.name)} a lieu ${soon ? "dans une heure" : "demain"} :<br>${whenGuest(c)}</p>
<p style="margin-top:10px">${whereHtml(c)}</p>${manageLinks(c)}`;
  return {
    subject: `Rappel : ${c.typeName} ${soon ? "dans une heure" : "demain"} avec ${c.host.name}`,
    html: emailLayout({ agency: c.agency, title: soon ? "C'est dans une heure" : "C'est demain", body, cta: c.meetUrl ? { label: "Rejoindre la visio", url: c.meetUrl } : { label: "Voir le rendez-vous", url: c.manageUrl } }),
  };
}

export function hostBooked(c: MailCtx, rescheduled = false) {
  const body = `<p>${esc(c.guest.name)} (${esc(c.guest.email)}) ${rescheduled ? "a déplacé son" : "a réservé un"} ${esc(c.typeName.toLowerCase())} :<br>${whenHost(c)}</p>
<p style="margin-top:10px">${whereHtml(c)}</p>${answersHtml(c)}
<p style="margin-top:12px;font-size:13px;color:#6b6760">Le contact et le deal sont à jour dans le CRM.</p>`;
  return {
    subject: `${rescheduled ? "Rendez-vous déplacé" : "Nouveau rendez-vous"} : ${c.guest.name} (${c.typeName})`,
    html: emailLayout({ agency: c.agency, title: rescheduled ? "Rendez-vous déplacé" : "Nouveau rendez-vous", body, cta: c.appUrl ? { label: "Ouvrir dans Agence OS", url: c.appUrl } : undefined }),
  };
}

export function hostCancelled(c: MailCtx) {
  const body = `<p>${esc(c.guest.name)} (${esc(c.guest.email)}) a annulé son ${esc(c.typeName.toLowerCase())} :<br>${whenHost(c)}</p>
${c.reason ? `<p style="margin-top:10px;color:#57544e">« ${esc(c.reason)} »</p>` : ""}`;
  return {
    subject: `Rendez-vous annulé : ${c.guest.name} (${c.typeName})`,
    html: emailLayout({ agency: c.agency, title: "Rendez-vous annulé", body, cta: c.appUrl ? { label: "Ouvrir dans Agence OS", url: c.appUrl } : undefined }),
  };
}
