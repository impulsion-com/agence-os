"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, CalendarX, ChevronRight, Clock, Globe, Video } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { tzLabel } from "@/lib/booking/engine";
import { durationLabel, fmtWhen, LOCATION, type LocationKind } from "@/lib/booking/shared";
import { colorOf } from "@/lib/constants";
import { LocationLine } from "./public-booker";
import { useNow } from "./common";
import { carryParams } from "./public-shell";

// ---------------------------------------------------------------------
// /b/<membre> : liste des types de rendez-vous
// ---------------------------------------------------------------------
export function PublicProfile({
  profile,
  types,
}: {
  profile: { slug: string; name: string; headline: string; welcome: string; color: string };
  types: { slug: string; name: string; description: string; duration_min: number; location_kind: string; color: string }[];
}) {
  const [qs, setQs] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- paramètres de l'URL, lus une fois côté navigateur
    setQs(carryParams(window.location.search));
  }, []);
  return (
    <div className="bk-prof">
      <div className="bk-prof-h">
        <Avatar profile={{ full_name: profile.name, color: profile.color }} size={64} title={false} />
        <h1>{profile.name}</h1>
        {profile.headline && <p style={{ fontWeight: 500 }}>{profile.headline}</p>}
        {profile.welcome && <p>{profile.welcome}</p>}
      </div>
      {types.length ? (
        <div className="bk-types">
          {types.map((t) => (
            <Link key={t.slug} href={`/b/${profile.slug}/${t.slug}${qs}`} className="bk-type" style={{ ["--c" as string]: colorOf(t.color) }}>
              <span className="bar" />
              <span className="tx">
                <b>{t.name}</b>
                {t.description && <span className="d">{t.description}</span>}
                <span className="m">
                  <span>
                    <Clock size={12} /> {durationLabel(t.duration_min)}
                  </span>
                  <span>
                    <Video size={12} /> {LOCATION[t.location_kind as LocationKind]?.name}
                  </span>
                </span>
              </span>
              <ChevronRight size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="bk-card one">
          <div className="bk-done">
            <span className="ko">
              <CalendarX size={24} />
            </span>
            <p>Aucun rendez-vous n&apos;est proposé pour le moment.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// /b/r/<jeton> : déplacer ou annuler un rendez-vous
// ---------------------------------------------------------------------
export interface ManageData {
  token: string;
  status: string;
  start: string;
  end: string;
  tz: string;
  name: string;
  typeName: string;
  host: string;
  locationKind: string;
  location: string;
  meet: string;
  rescheduleHref: string | null;
  bookAgainHref: string | null;
  cancelReason: string;
}

export function PublicManage({ d }: { d: ManageData }) {
  const [tz, setTz] = useState(d.tz);
  const [status, setStatus] = useState(d.status);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fuseau du navigateur
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || d.tz);
    } catch {
      /* fuseau enregistré */
    }
  }, [d.tz]);

  const now = useNow();
  const past = Date.parse(d.end) < now;
  const active = status === "confirmed" && !past;

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/booking/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: d.token, reason }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "L'annulation a échoué, merci de réessayer.");
      return;
    }
    setStatus("cancelled");
    setCancelOpen(false);
  }

  return (
    <div className="bk-card one">
      <div className="bk-done">
        <span className={status === "cancelled" ? "ko" : "ok"}>{status === "cancelled" ? <CalendarX size={24} /> : <CalendarClock size={24} />}</span>
        <h1>{status === "cancelled" ? "Rendez-vous annulé" : past ? "Rendez-vous passé" : "Votre rendez-vous"}</h1>
        {status === "cancelled" && <p>Ce rendez-vous a été annulé{d.cancelReason && status === d.status ? ` : « ${d.cancelReason} »` : "."}</p>}
        <div className="bk-recap">
          <div>
            <CalendarClock size={16} />
            <span>
              <b>{d.typeName}</b> avec {d.host}
            </span>
          </div>
          <div>
            <Clock size={16} />
            <span style={status === "cancelled" ? { textDecoration: "line-through", color: "var(--text-3)" } : undefined}>{fmtWhen(d.start, d.end, tz)}</span>
          </div>
          <div>
            <Globe size={16} />
            <span>{tzLabel(tz, Date.parse(d.start))}</span>
          </div>
          {status !== "cancelled" && <LocationLine kind={d.locationKind} value={d.location} meet={d.meet || null} />}
        </div>

        {error && (
          <div className="bk-err" role="alert" style={{ maxWidth: 440, width: "100%" }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {active && !cancelOpen && (
          <div className="bk-actions">
            {d.rescheduleHref && (
              <Link className="btn btn-primary" href={d.rescheduleHref}>
                <CalendarClock size={15} /> Déplacer
              </Link>
            )}
            <button type="button" className="btn" onClick={() => setCancelOpen(true)}>
              <CalendarX size={15} /> Annuler
            </button>
          </div>
        )}
        {active && cancelOpen && (
          <div className="bk-cancel">
            <div className="field">
              <label htmlFor="bk-reason">Motif de l&apos;annulation (facultatif)</label>
              <textarea id="bk-reason" className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Un empêchement, un autre créneau à proposer…" />
            </div>
            <div className="bk-actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={cancel}>
                {busy ? "Annulation…" : "Confirmer l'annulation"}
              </button>
              <button type="button" className="btn" onClick={() => setCancelOpen(false)}>
                Garder le rendez-vous
              </button>
            </div>
          </div>
        )}
        {!active && d.bookAgainHref && (
          <div className="bk-actions">
            <Link className="btn btn-primary" href={d.bookAgainHref}>
              Réserver un autre créneau
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
