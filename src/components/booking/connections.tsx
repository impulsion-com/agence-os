"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Eye, EyeOff, Info, Link2, RefreshCw, Unplug, Webhook } from "lucide-react";

import { ConfirmModal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import type { BookingProfile } from "@/lib/booking/shared";
import { ago } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { CopyButton, postJson, publicBase } from "./common";

interface CalendarItem {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

// ---------------------------------------------------------------------
// Google Agenda
// ---------------------------------------------------------------------
export function GoogleCalendar({
  profile,
  isSelf,
  google,
  configured,
  appUrl,
}: {
  profile: BookingProfile;
  isSelf: boolean;
  google: { email: string | null; last_error: string | null; created_at: string | null } | null;
  configured: boolean;
  appUrl: string;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const toast = useToast();
  const [cals, setCals] = useState<CalendarItem[] | null>(null);
  const [calError, setCalError] = useState<string | null>(null);
  const [busyCals, setBusyCals] = useState<string[]>(profile.busy_calendars);
  const [eventCal, setEventCal] = useState(profile.event_calendar);
  const [confirm, setConfirm] = useState(false);
  const base = publicBase(appUrl);

  useEffect(() => {
    if (!google || !isSelf) return;
    let alive = true;
    fetch(`/api/booking/google/calendars?ws=${ws.workspace.id}`)
      .then(async (r) => {
        const j = (await r.json()) as { calendars?: CalendarItem[]; error?: string };
        if (!alive) return;
        if (!r.ok) setCalError(j.error ?? "Agendas indisponibles");
        else setCals(j.calendars ?? []);
      })
      .catch(() => alive && setCalError("Agendas indisponibles"));
    return () => {
      alive = false;
    };
  }, [google, isSelf, ws.workspace.id]);

  // « primary » désigne l'agenda principal : on l'affiche sous son vrai identifiant
  const primaryId = cals?.find((c) => c.primary)?.id;
  const norm = (id: string) => (id === "primary" && primaryId ? primaryId : id);
  const busySet = new Set(busyCals.map(norm));
  const dirty = JSON.stringify([...busySet].sort()) !== JSON.stringify([...new Set(profile.busy_calendars.map(norm))].sort()) || norm(eventCal) !== norm(profile.event_calendar);

  const saveCals = () =>
    mutate(async (sb) => must(await sb.from("booking_profiles").update({ busy_calendars: [...busySet], event_calendar: norm(eventCal) }).eq("id", profile.id)), {
      success: "Agendas enregistrés",
    });

  if (!configured)
    return (
      <section className="bk-sec">
        <h2>
          <CalendarDays size={16} /> Google Agenda
        </h2>
        <div className="bk-callout warn">
          <AlertTriangle size={15} />
          <div>
            La connexion Google n&apos;est pas configurée sur ce serveur. Renseigne <code>GOOGLE_CLIENT_ID</code> et <code>GOOGLE_CLIENT_SECRET</code> (les mêmes que pour Google Ads), active
            l&apos;API Google Calendar dans la console Google Cloud et ajoute l&apos;URL de redirection <code>{base}/api/booking/google/callback</code>.
            <br />
            En attendant, les rendez-vous fonctionnent sans agenda : créneaux calculés sur tes disponibilités, invitation .ics dans l&apos;email de confirmation.
          </div>
        </div>
      </section>
    );

  return (
    <section className="bk-sec">
      <h2>
        <CalendarDays size={16} /> Google Agenda
      </h2>
      <p className="lead">
        Ton agenda bloque les créneaux déjà pris, et chaque réservation y crée un évènement avec un lien Google Meet et l&apos;invitation du prospect. Les annulations et reports sont répercutés.
      </p>

      {!google ? (
        <div className="bk-conn">
          <span className="ic">
            <CalendarDays size={17} />
          </span>
          <span className="tx">
            <b>Aucun agenda connecté</b>
            <span>Sans agenda, les créneaux suivent seulement tes disponibilités.</span>
          </span>
          {isSelf ? (
            <a className="btn btn-primary" href={`/api/booking/google/start?ws=${ws.workspace.slug}`}>
              Connecter Google Agenda
            </a>
          ) : (
            <span className="bk-note">Seul ce membre peut connecter son agenda.</span>
          )}
        </div>
      ) : (
        <>
          <div className="bk-conn">
            <span className="ic">
              <CalendarDays size={17} />
            </span>
            <span className="tx">
              <b>{google.email || "Compte Google"}</b>
              <span>Connecté {google.created_at ? ago(google.created_at) : ""}</span>
            </span>
            {isSelf && (
              <>
                <a className="btn btn-sm" href={`/api/booking/google/start?ws=${ws.workspace.slug}`}>
                  <RefreshCw size={13} /> Reconnecter
                </a>
                <button className="btn btn-sm" onClick={() => setConfirm(true)}>
                  <Unplug size={13} /> Déconnecter
                </button>
              </>
            )}
          </div>
          {google.last_error && (
            <div className="bk-callout bad">
              <AlertTriangle size={15} />
              <span>Dernière erreur : {google.last_error}</span>
            </div>
          )}
          {isSelf && (
            <>
              {calError && (
                <div className="bk-callout bad">
                  <AlertTriangle size={15} />
                  <span>{calError}</span>
                </div>
              )}
              {cals === null && !calError && <span className="sk" style={{ height: 80, width: "100%" }} />}
              {cals && (
                <div className="bk-g2">
                  <div className="field">
                    <label>Agendas qui bloquent tes créneaux</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {cals.map((c) => (
                        <label key={c.id} className="bk-inline" style={{ fontSize: "var(--fs)" }}>
                          <input
                            type="checkbox"
                            className="check"
                            checked={busySet.has(c.id)}
                            onChange={(e) => setBusyCals(e.target.checked ? [...busySet, c.id] : [...busySet].filter((x) => x !== c.id))}
                          />
                          <span className="trunc">{c.summary}</span>
                          {c.primary && <span className="chip">Principal</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="bk-evcal">Agenda où créer les rendez-vous</label>
                    <select id="bk-evcal" className="select" value={norm(eventCal)} onChange={(e) => setEventCal(e.target.value)}>
                      {cals
                        .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (principal)" : ""}</option>
                        ))}
                    </select>
                    <span className="hint">Le prospect reçoit l&apos;invitation Google de cet agenda.</span>
                  </div>
                </div>
              )}
              {cals && (
                <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} disabled={!dirty} onClick={saveCals}>
                  Enregistrer
                </button>
              )}
            </>
          )}
        </>
      )}

      {confirm && (
        <ConfirmModal
          title="Déconnecter Google Agenda ?"
          text="Les prochains rendez-vous ne seront plus ajoutés à ton agenda et tes évènements ne bloqueront plus tes créneaux. Les évènements déjà créés restent en place."
          confirmLabel="Déconnecter"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              await postJson("/api/booking/google/disconnect", { ws: ws.workspace.id });
              toast("Agenda déconnecté");
              router.refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : "Déconnexion impossible", { error: true });
            }
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Cal.com
// ---------------------------------------------------------------------
export function CalcomConnector({
  settings,
  count,
  appUrl,
}: {
  settings: { calcom_secret: string; calcom_user_id: string | null; calcom_last_at: string | null } | null;
  count: number;
  appUrl: string;
}) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const base = publicBase(appUrl);
  if (!ws.isAdmin || !settings)
    return (
      <section className="bk-sec">
        <h2>
          <Webhook size={16} /> Cal.com
        </h2>
        <div className="bk-callout">
          <Info size={15} />
          <span>Le connecteur Cal.com se règle par un admin de l&apos;espace.</span>
        </div>
      </section>
    );
  const url = `${base}/api/booking/calcom?ws=${ws.workspace.id}`;
  const rotate = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return mutate(async (sb) => must(await sb.from("booking_settings").update({ calcom_secret: secret }).eq("workspace_id", ws.workspace.id)), {
      success: "Nouveau secret généré : colle-le dans Cal.com",
    });
  };
  return (
    <section className="bk-sec">
      <h2>
        <Webhook size={16} /> Cal.com
        {settings.calcom_last_at && <span className="aside chip">Dernier évènement reçu {ago(settings.calcom_last_at)}</span>}
      </h2>
      <p className="lead">
        Tu restes sur Cal.com (cloud ou auto-hébergé) ? Ses réservations arrivent quand même au CRM : contact, entreprise, deal « Appel découverte », activité et notification. Les annulations et
        reports suivent, et la fin d&apos;une visio Cal.com marque le rendez-vous honoré.
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, listStyle: "decimal", display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs)", color: "var(--text-2)" }}>
        <li>Dans Cal.com : Paramètres, Développeur, Webhooks, puis « Nouveau ».</li>
        <li>Colle l&apos;URL et le secret ci-dessous.</li>
        <li>
          Coche les évènements <b>Réservation créée</b>, <b>Réservation reportée</b>, <b>Réservation annulée</b> et <b>Réunion terminée</b>, puis enregistre (le bouton « Ping » teste la connexion).
        </li>
      </ol>
      <div className="field">
        <label>URL de l&apos;abonné</label>
        <div className="bk-inline">
          <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
          <CopyButton text={url} label="Copier" />
        </div>
      </div>
      <div className="field">
        <label>Secret</label>
        <div className="bk-inline">
          <input className="input mono" readOnly type={show ? "text" : "password"} value={settings.calcom_secret} onFocus={(e) => e.target.select()} />
          <button className="btn btn-icon" aria-label={show ? "Masquer" : "Afficher"} onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <CopyButton text={settings.calcom_secret} label="Copier" msg="Secret copié" />
          <button className="btn" onClick={() => setConfirm(true)}>
            <RefreshCw size={13} /> Régénérer
          </button>
        </div>
        <span className="hint">Chaque requête est vérifiée avec ce secret (signature x-cal-signature-256). Sans lui, rien n&apos;est enregistré.</span>
      </div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="bk-calowner">Membre qui reçoit les rendez-vous</label>
        <select
          id="bk-calowner"
          className="select"
          value={settings.calcom_user_id ?? ""}
          onChange={(e) =>
            mutate(async (sb) => must(await sb.from("booking_settings").update({ calcom_user_id: e.target.value || null }).eq("workspace_id", ws.workspace.id)), { success: "Enregistré" })
          }
        >
          <option value="">Selon l&apos;organisateur Cal.com (sinon le propriétaire)</option>
          {ws.members
            .filter((m) => m.role !== "guest")
            .map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.profile.full_name || m.profile.email}</option>
            ))}
        </select>
        <span className="hint">L&apos;organisateur Cal.com est reconnu par son email s&apos;il est membre de l&apos;espace.</span>
      </div>
      <div className="bk-callout">
        <Link2 size={15} />
        <span>
          {count ? `${count} rendez-vous reçus de Cal.com.` : "Aucun rendez-vous reçu de Cal.com pour l'instant."} Les UTM transmis par Cal.com (paramètres de la page de réservation) deviennent la source du
          deal.
        </span>
      </div>
      {confirm && (
        <ConfirmModal
          title="Régénérer le secret ?"
          text="L'ancien secret cessera de fonctionner : Cal.com sera refusé tant que tu n'y auras pas collé le nouveau."
          confirmLabel="Régénérer"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await rotate();
          }}
        />
      )}
    </section>
  );
}
