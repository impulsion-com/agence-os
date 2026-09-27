"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowLeft, CalendarCheck, CalendarPlus, ChevronLeft, ChevronRight, Clock, Globe, MapPin, Phone, Video,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { addDaysStr, dayIn, isoWeekday, tzLabel } from "@/lib/booking/engine";
import { durationLabel, fmtDay, fmtTime, fmtWhen, googleCalendarLink, type LocationKind, type Question } from "@/lib/booking/shared";
import { colorOf } from "@/lib/constants";
import { useNow } from "./common";

export interface BookerProps {
  profile: { slug: string; name: string; headline: string; color: string; timezone: string };
  type: { slug: string; name: string; description: string; duration_min: number; location_kind: string; location_value: string; questions: Question[]; color: string };
  emailOn: boolean;
  reschedule: { token: string; start: string; end: string; name: string; email: string } | null;
  backHref: string | null;
}

type Step = "pick" | "form" | "done";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WD = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

export function LocationLine({ kind, value, meet }: { kind: string; value: string; meet?: string | null }) {
  if (meet)
    return (
      <div>
        <Video size={16} />
        <a href={meet} target="_blank" rel="noreferrer">{meet.replace(/^https?:\/\//, "")}</a>
      </div>
    );
  switch (kind as LocationKind) {
    case "phone":
      return (
        <div>
          <Phone size={16} />
          <span>Par téléphone{value ? ` (${value})` : ", nous vous appelons"}</span>
        </div>
      );
    case "address":
      return (
        <div>
          <MapPin size={16} />
          <span>{value || "En présentiel"}</span>
        </div>
      );
    case "video":
      return (
        <div>
          <Video size={16} />
          <span>Visio{value ? "" : ", lien envoyé par email"}</span>
        </div>
      );
    default:
      return (
        <div>
          <Video size={16} />
          <span>Google Meet, lien envoyé à la réservation</span>
        </div>
      );
  }
}

export function PublicBooker({ profile, type, emailOn, reschedule, backHref }: BookerProps) {
  const now = useNow();
  const [tz, setTz] = useState(profile.timezone);
  const [zones, setZones] = useState<string[]>([]);
  const [slots, setSlots] = useState<number[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [values, setValues] = useState<Record<string, string>>(() => ({ name: reschedule?.name ?? "", email: reschedule?.email ?? "" }));
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; start: string; end: string; meet: string | null } | null>(null);

  // Fuseau du visiteur (détecté après le premier rendu pour éviter un écart d'hydratation)
  useEffect(() => {
    try {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
      const list = [...new Set([...all, profile.timezone, guess].filter(Boolean))].sort();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique de l'environnement du navigateur
      setZones(list);
      if (guess) setTz(guess);
    } catch {
      /* fuseau du membre par défaut */
    }
  }, [profile.timezone]);

  const load = useCallback(async () => {
    setLoadError(null);
    const q = new URLSearchParams({ u: profile.slug, t: type.slug });
    if (reschedule) q.set("reschedule", reschedule.token);
    try {
      const res = await fetch(`/api/booking/slots?${q}`, { cache: "no-store" });
      const json = (await res.json()) as { slots?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Chargement impossible");
      setSlots((json.slots ?? []).map((s) => Date.parse(s)));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Chargement impossible");
      setSlots([]);
    }
  }, [profile.slug, type.slug, reschedule]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial des créneaux
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const t of slots ?? []) {
      const d = dayIn(t, tz);
      const arr = m.get(d);
      if (arr) arr.push(t);
      else m.set(d, [t]);
    }
    return m;
  }, [slots, tz]);
  const days = useMemo(() => [...byDay.keys()].sort(), [byDay]);

  // Premier jour disponible sélectionné par défaut, et après un changement de fuseau
  const activeDay = day && byDay.has(day) ? day : (days[0] ?? null);
  const todayStr = dayIn(now, tz);
  const activeMonth = month ?? (activeDay ? activeDay.slice(0, 7) : todayStr.slice(0, 7));
  const minMonth = todayStr.slice(0, 7);
  const maxMonth = days.length ? days[days.length - 1].slice(0, 7) : minMonth;

  const shiftMonth = (n: number) => {
    const [y, m] = activeMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    const next = d.toISOString().slice(0, 7);
    setMonth(next);
    const first = days.find((x) => x.startsWith(next));
    if (first) setDay(first);
  };

  const cells = useMemo(() => {
    const first = `${activeMonth}-01`;
    const lead = isoWeekday(first) - 1;
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = first; d.startsWith(activeMonth); d = addDaysStr(d, 1)) out.push(d);
    return out;
  }, [activeMonth]);

  const questions = useMemo(() => {
    const qs = [...type.questions];
    if (type.location_kind === "phone" && !qs.some((q) => q.key === "phone")) qs.unshift({ key: "phone", label: "Téléphone", type: "phone", required: true });
    return qs.map((q) => (q.key === "phone" && type.location_kind === "phone" ? { ...q, required: true } : q));
  }, [type]);

  const pick = (t: number) => {
    setSlot(t);
    setError(null);
    setStep("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    setError(null);
    setBusy(true);
    const sp = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const [k, v] of sp) if (/^utm_|^(gclid|fbclid|ttclid|msclkid)$/.test(k)) utm[k] = v;
    const ref = sp.get("ref");
    const answers: Record<string, string> = {};
    for (const q of questions) if (values[q.key]?.trim()) answers[q.key] = values[q.key].trim();
    try {
      const res = await fetch("/api/booking/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: profile.slug,
          type: type.slug,
          start: new Date(slot).toISOString(),
          tz,
          name: values.name ?? "",
          email: values.email ?? "",
          answers,
          utm,
          aos_id: sp.get("_aos_id") || undefined,
          page_url: (ref || window.location.href).slice(0, 2000),
          referrer: (ref ? "" : document.referrer).slice(0, 2000),
          reschedule: reschedule?.token,
          website_url: hp || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; token?: string; start?: string; end?: string; meet?: string | null };
      if (!res.ok || !json.token) {
        setError(json.error || "La réservation a échoué, merci de réessayer.");
        if (res.status === 409) {
          setStep("pick");
          setSlot(null);
          void load();
        }
        return;
      }
      setDone({ token: json.token, start: json.start!, end: json.end!, meet: json.meet ?? null });
      setStep("done");
      if (window.parent !== window) window.parent.postMessage({ type: "aos-booking:booked", start: json.start }, "*");
    } catch {
      setError("Connexion impossible, merci de réessayer.");
    } finally {
      setBusy(false);
    }
  }

  const color = colorOf(type.color);
  const zoneLabel = tzLabel(tz, slot ?? now);

  // ---------- Confirmation ----------
  if (step === "done" && done) {
    const title = `${type.name} avec ${profile.name}`;
    return (
      <div className="bk-card one">
        <div className="bk-done">
          <span className="ok">
            <CalendarCheck size={26} />
          </span>
          <h1>{reschedule ? "Rendez-vous déplacé" : "Rendez-vous confirmé"}</h1>
          <p>
            {emailOn
              ? `Un email de confirmation vient d'être envoyé à ${values.email}.`
              : "Ajoutez-le à votre agenda pour ne pas l'oublier."}
          </p>
          <div className="bk-recap">
            <div>
              <CalendarCheck size={16} />
              <span>
                <b>{type.name}</b> avec {profile.name}
              </span>
            </div>
            <div>
              <Clock size={16} />
              <span>
                {fmtWhen(done.start, done.end, tz)}
                <br />
                <span className="faint">{tzLabel(tz, Date.parse(done.start))}</span>
              </span>
            </div>
            <LocationLine kind={type.location_kind} value={type.location_kind === "phone" ? values.phone ?? "" : type.location_value} meet={done.meet} />
          </div>
          <div className="bk-actions">
            <a className="btn" href={`/api/booking/ics?token=${done.token}`}>
              <CalendarPlus size={15} /> Ajouter à mon agenda (.ics)
            </a>
            <a
              className="btn"
              target="_blank"
              rel="noreferrer"
              href={googleCalendarLink({ title, start: done.start, end: done.end, details: `Déplacer ou annuler : ${window.location.origin}/b/r/${done.token}`, location: done.meet ?? type.location_value })}
            >
              Google Agenda
            </a>
          </div>
          <p className="bk-legal" style={{ marginTop: 8 }}>
            Un empêchement ? <Link href={`/b/r/${done.token}`} style={{ color: "var(--accent)" }}>Déplacer ou annuler le rendez-vous</Link>
          </p>
        </div>
      </div>
    );
  }

  const info = (
    <aside className="bk-info">
      {backHref && step === "pick" && (
        <Link className="bk-back" href={backHref}>
          <ArrowLeft size={14} /> Tous les rendez-vous
        </Link>
      )}
      {step === "form" && (
        <button type="button" className="bk-back" onClick={() => setStep("pick")}>
          <ArrowLeft size={14} /> Changer de créneau
        </button>
      )}
      <div className="bk-host">
        <Avatar profile={{ full_name: profile.name, color: profile.color }} size={36} title={false} />
        <span>
          {profile.name}
          {profile.headline && (
            <>
              <br />
              <span className="faint" style={{ fontWeight: 400, fontSize: "var(--fs-xs)" }}>{profile.headline}</span>
            </>
          )}
        </span>
      </div>
      <h1 style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>{type.name}</h1>
      <div className="bk-meta">
        <div>
          <Clock size={16} />
          <span>{durationLabel(type.duration_min)}</span>
        </div>
        <LocationLine kind={type.location_kind} value={type.location_kind === "address" ? type.location_value : ""} />
        {slot && step === "form" && (
          <div>
            <CalendarCheck size={16} />
            <b>{fmtWhen(slot, slot + type.duration_min * 60000, tz)}</b>
          </div>
        )}
        <div>
          <Globe size={16} />
          <span>{zoneLabel}</span>
        </div>
      </div>
      {reschedule && (
        <div className="bk-resched">
          Vous déplacez le rendez-vous du <b>{fmtWhen(reschedule.start, reschedule.end, tz)}</b>.
        </div>
      )}
      {type.description && <p className="bk-desc">{type.description}</p>}
    </aside>
  );

  // ---------- Formulaire ----------
  if (step === "form" && slot) {
    return (
      <div className="bk-card two">
        {info}
        <form className="bk-form" onSubmit={submit} noValidate={false}>
          <h2>Vos coordonnées</h2>
          {error && (
            <div className="bk-err" role="alert">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="bk-name">
              Nom et prénom<span className="req">*</span>
            </label>
            <input id="bk-name" className="input" required autoComplete="name" value={values.name ?? ""} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="bk-email">
              Email<span className="req">*</span>
            </label>
            <input id="bk-email" className="input" type="email" required autoComplete="email" value={values.email ?? ""} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} />
          </div>
          {questions.map((q) => {
            const id = `bk-q-${q.key}`;
            const set = (val: string) => setValues((v) => ({ ...v, [q.key]: val }));
            const common = { id, required: q.required, value: values[q.key] ?? "" };
            return (
              <div className="field" key={q.key}>
                <label htmlFor={id}>
                  {q.label}
                  {q.required && <span className="req">*</span>}
                </label>
                {q.type === "textarea" ? (
                  <textarea {...common} className="textarea" rows={4} onChange={(e) => set(e.target.value)} />
                ) : q.type === "select" ? (
                  <select {...common} className="select" onChange={(e) => set(e.target.value)}>
                    <option value="">Choisir…</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    className="input"
                    type={q.type === "phone" ? "tel" : q.type === "url" ? "text" : "text"}
                    inputMode={q.type === "url" ? "url" : undefined}
                    autoComplete={q.type === "phone" ? "tel" : q.key === "company" ? "organization" : q.type === "url" ? "url" : undefined}
                    placeholder={q.type === "url" ? "exemple.fr" : undefined}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </div>
            );
          })}
          <div className="bk-hp" aria-hidden>
            <label>
              Ne pas remplir
              <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
            </label>
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? "Réservation…" : reschedule ? "Confirmer le nouveau créneau" : "Confirmer le rendez-vous"}
          </button>
          <p className="bk-legal">
            Vos informations servent uniquement à organiser ce rendez-vous et à vous recontacter à son sujet.
          </p>
        </form>
      </div>
    );
  }

  // ---------- Choix du créneau ----------
  const daySlots = activeDay ? (byDay.get(activeDay) ?? []) : [];
  const [yy, mm] = activeMonth.split("-").map(Number);
  return (
    <div className="bk-card">
      {info}
      <section className="bk-cal" aria-label="Choisir une date">
        <h2>Choisissez une date</h2>
        {error && (
          <div className="bk-err" role="alert" style={{ marginBottom: 12 }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}
        <div className="bk-month">
          <b>
            {MONTHS[mm - 1]} {yy}
          </b>
          <span className="nav">
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Mois précédent" disabled={activeMonth <= minMonth} onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Mois suivant" disabled={activeMonth >= maxMonth} onClick={() => shiftMonth(1)}>
              <ChevronRight size={16} />
            </button>
          </span>
        </div>
        <div className="bk-grid" role="grid">
          {WD.map((w) => (
            <span key={w} className="bk-wd">{w}</span>
          ))}
          {cells.map((d, i) =>
            d ? (
              byDay.has(d) ? (
                <button
                  key={d}
                  type="button"
                  className={`bk-day av${d === activeDay ? " sel" : ""}${d === todayStr ? " today" : ""}`}
                  aria-pressed={d === activeDay}
                  aria-label={`${fmtDay(byDay.get(d)![0], tz)}, ${byDay.get(d)!.length} créneaux`}
                  onClick={() => {
                    setDay(d);
                    setError(null);
                  }}
                >
                  {Number(d.slice(8))}
                </button>
              ) : (
                <span key={d} className={`bk-day${d === todayStr ? " today" : ""}`} aria-disabled>
                  {Number(d.slice(8))}
                </span>
              )
            ) : (
              <span key={`e${i}`} />
            ),
          )}
        </div>
        <div className="bk-tz">
          <label htmlFor="bk-tz">
            <Globe size={13} /> Fuseau horaire
          </label>
          <select id="bk-tz" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
            {(zones.length ? zones : [tz]).map((z) => (
              <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </section>
      <section className="bk-times" aria-label="Choisir un horaire">
        <h2>{activeDay && daySlots.length ? fmtDay(daySlots[0], tz) : "Horaires"}</h2>
        <div className="bk-slots">
          {slots === null ? (
            Array.from({ length: 6 }, (_, i) => <span key={i} className="sk" style={{ height: 42, borderRadius: 9 }} />)
          ) : loadError ? (
            <p className="bk-none">{loadError}</p>
          ) : !days.length ? (
            <p className="bk-none">Aucun créneau disponible pour le moment. Revenez un peu plus tard.</p>
          ) : (
            daySlots.map((t) => (
              <button key={t} type="button" className={`bk-slot${t === slot ? " sel" : ""}`} onClick={() => pick(t)}>
                {fmtTime(t, tz)}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
