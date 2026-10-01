"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { CalendarDays, CircleAlert, CircleCheck, Clock3, Lock, MessageSquareWarning } from "lucide-react";

import { diffDays, fmtDate, parseDay, relDate, today } from "@/lib/format";
import type { ClientReview } from "@/lib/portal/types";
import { PREVIEW_HINT } from "./context";

/** Rubrique non ouverte pour ce client (ou module désactivé dans l'espace). */
export function FeatureOff({ name }: { name: string }) {
  return (
    <div className="card ptl-empty" style={{ padding: "48px 24px" }}>
      <div className="ic">
        <Lock size={17} />
      </div>
      <b>{name} : rubrique non disponible</b>
      Cette rubrique n&apos;est pas ouverte sur votre espace client. Votre agence peut l&apos;activer à tout moment.
    </div>
  );
}

export function LoadError() {
  return (
    <div className="card ptl-empty" style={{ padding: "48px 24px" }}>
      <div className="ic">
        <CircleAlert size={17} />
      </div>
      <b>Chargement impossible</b>
      Rechargez la page. Si le problème persiste, contactez votre agence.
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="ptl-empty">
      <div className="ic">{icon}</div>
      <b>{title}</b>
      {children}
    </div>
  );
}

/** Mention affichée à la place d'une action désactivée en aperçu. */
export function PreviewLock({ children = PREVIEW_HINT }: { children?: ReactNode }) {
  return (
    <span className="ptl-lock">
      <Lock size={12} /> {children}
    </span>
  );
}

const subscribe = () => () => {};
/** true une fois côté navigateur : les heures dépendent du fuseau du visiteur, jamais de celui du serveur. */
export const useIsClient = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

const DT = { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" } as const;
const D = { weekday: "long", day: "numeric", month: "long" } as const;
const T = { hour: "2-digit", minute: "2-digit" } as const;

/** Date et heure dans le fuseau du visiteur (rendu après hydratation). */
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "day" | "time" }) {
  const client = useIsClient();
  if (!client) return <span className="sk" style={{ width: 90, height: 12 }} aria-hidden />;
  const d = new Date(iso);
  const text = new Intl.DateTimeFormat("fr-FR", mode === "day" ? D : mode === "time" ? T : DT).format(d);
  return <time dateTime={iso}>{text}</time>;
}

/** Échéance : rouge si dépassée (tâche non terminée), ambre si imminente. */
export function Due({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const n = diffDays(parseDay(date)!, today());
  const color = done ? undefined : n < 0 ? "var(--red)" : n <= 1 ? "var(--amber)" : undefined;
  return (
    <span style={{ color }} title={fmtDate(date, true)}>
      <CalendarDays size={12} />
      {relDate(date)}
    </span>
  );
}

export const REVIEW: Record<ClientReview, { name: string; short: string; long: string }> = {
  pending: { name: "À valider", short: "À valider", long: "En attente de votre validation" },
  approved: { name: "Approuvée", short: "Approuvée", long: "Vous avez approuvé cette créa" },
  changes: { name: "Modifications demandées", short: "À modifier", long: "Vous avez demandé des modifications" },
};

export function ReviewBadge({ review, short }: { review: ClientReview; short?: boolean }) {
  const I = review === "pending" ? Clock3 : review === "approved" ? CircleCheck : MessageSquareWarning;
  return (
    <span className={`ptl-st ${review}`} title={REVIEW[review].name}>
      <I size={13} strokeWidth={2.2} />
      {short ? REVIEW[review].short : REVIEW[review].name}
    </span>
  );
}

// ---------------------------------------------------------------------
// Texte rédigé par l'agence : paragraphes, listes à puces, titres, gras et liens. Jamais de HTML brut.
// ---------------------------------------------------------------------
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|https?:\/\/[^\s<>"')]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>);
    else
      out.push(
        <a key={m.index} href={tok} target="_blank" rel="noopener noreferrer nofollow">
          {tok.replace(/^https?:\/\//, "").slice(0, 60)}
        </a>,
      );
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function PortalText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((line, i) => {
    const l = line.trimEnd();
    if (/^\s*[-*•] /.test(l)) {
      list.push(<li key={i}>{inline(l.replace(/^\s*[-*•] /, ""))}</li>);
      return;
    }
    flush();
    if (/^#{1,3} /.test(l)) blocks.push(<h4 key={i}>{inline(l.replace(/^#{1,3} /, ""))}</h4>);
    else if (l.trim()) blocks.push(<p key={i}>{inline(l)}</p>);
  });
  flush();
  return <div className="ptl-text">{blocks}</div>;
}
