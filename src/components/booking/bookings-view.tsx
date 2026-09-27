"use client";

import "@/styles/booking.css";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Building2, CalendarCheck, CalendarClock, CalendarX, Contact as ContactIcon, ExternalLink, Handshake, Settings, UserX,
} from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Drawer, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { dayIn } from "@/lib/booking/engine";
import type { BookingRow } from "@/lib/booking/load";
import { LOCATION, STATUS, durationLabel, fmtDay, fmtTime, fmtWhen, type BookingProfile, type BookingStatus, type BookingType, type LocationKind } from "@/lib/booking/shared";
import { colorOf } from "@/lib/constants";
import { ago } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import { CopyButton, postJson, publicBase, useNow } from "./common";

type Tab = "upcoming" | "past" | "cancelled";
type TypeLite = Pick<BookingType, "id" | "profile_id" | "slug" | "name" | "color" | "duration_min" | "active" | "position">;

interface Props {
  myProfileId: string | null;
  bookings: BookingRow[];
  profiles: BookingProfile[];
  types: TypeLite[];
  appUrl: string;
  tracking: boolean;
}

const MON = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function BookingsView({ myProfileId, bookings, profiles, types, appUrl, tracking }: Props) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [who, setWho] = useState<"me" | "all">("all");
  const openId = sp.get("b");

  const me = profiles.find((p) => p.id === myProfileId) ?? null;
  const tz = me?.timezone || "Europe/Paris";
  const typeOf = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const profileOf = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const base = publicBase(appUrl);
  const myLink = me ? `${base}/b/${me.slug}` : "";
  const multi = profiles.length > 1;

  const now = useNow();
  const rows = bookings.filter((b) => who === "all" || b.owner_id === ws.me.id);
  const upcoming = rows.filter((b) => b.status === "confirmed" && Date.parse(b.end_at) >= now);
  const past = rows.filter((b) => b.status !== "cancelled" && Date.parse(b.end_at) < now).reverse();
  const cancelled = rows.filter((b) => b.status === "cancelled").sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at));
  const list = tab === "upcoming" ? upcoming : tab === "past" ? past : cancelled;

  // Indicateurs sur 90 jours
  const since = now - 90 * 864e5;
  const recent = rows.filter((b) => Date.parse(b.start_at) >= since && Date.parse(b.start_at) < now);
  const honored = recent.filter((b) => b.status === "completed").length;
  const noShow = recent.filter((b) => b.status === "no_show").length;
  const weekEnd = now + 7 * 864e5;
  const thisWeek = upcoming.filter((b) => Date.parse(b.start_at) < weekEnd).length;
  const created30 = rows.filter((b) => Date.parse(b.created_at) >= now - 30 * 864e5).length;

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: BookingRow[] }[] = [];
    const today = dayIn(now, tz);
    const tomorrow = dayIn(now + 864e5, tz);
    const yesterday = dayIn(now - 864e5, tz);
    for (const b of list) {
      const d = dayIn(Date.parse(b.start_at), tz);
      const label = d === today ? "Aujourd'hui" : d === tomorrow ? "Demain" : d === yesterday ? "Hier" : fmtDay(b.start_at, tz, d.slice(0, 4) !== today.slice(0, 4));
      const last = out[out.length - 1];
      if (last?.key === d) last.items.push(b);
      else out.push({ key: d, label, items: [b] });
    }
    return out;
  }, [list, now, tz]);

  const open = (id: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (id) q.set("b", id);
    else q.delete("b");
    router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false });
  };
  const current = openId ? bookings.find((b) => b.id === openId) ?? null : null;

  return (
    <div className="page">
      <SetCrumbs items={[{ label: "Rendez-vous" }]} />
      <PageHeader title="Rendez-vous" sub="Tes appels découverte et points clients réservés en ligne. Chaque réservation arrive au CRM avec son contact et son deal.">
        <Link href={`${ws.base}/booking/settings`} className="btn">
          <Settings size={14} /> Réglages
        </Link>
      </PageHeader>

      {me && (
        <div className="bk-bar">
          <span className="bk-link" title={myLink}>
            <span className="trunc">{myLink.replace(/^https?:\/\//, "")}</span>
          </span>
          <CopyButton text={myLink} label="Copier mon lien" msg="Lien de réservation copié" />
          <a className="btn" href={myLink} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Voir ma page
          </a>
        </div>
      )}

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="k">
            <CalendarClock size={14} /> À venir
          </div>
          <div className="v">{upcoming.length}</div>
          <div className="d">dont {thisWeek} dans les 7 jours</div>
        </div>
        <div className="stat">
          <div className="k">
            <CalendarCheck size={14} /> Réservés (30 j)
          </div>
          <div className="v">{created30}</div>
          <div className="d">nouvelles réservations</div>
        </div>
        <div className="stat">
          <div className="k">
            <UserX size={14} /> Taux de présence (90 j)
          </div>
          <div className="v">{honored + noShow ? `${Math.round((honored / (honored + noShow)) * 100)} %` : "–"}</div>
          <div className="d">
            {honored} honoré{honored > 1 ? "s" : ""}, {noShow} absent{noShow > 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="bk-bar">
        <div className="seg" role="tablist">
          {([
            ["upcoming", `À venir (${upcoming.length})`],
            ["past", `Passés (${past.length})`],
            ["cancelled", `Annulés (${cancelled.length})`],
          ] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {multi && (
          <div className="seg">
            <button type="button" className={who === "all" ? "on" : ""} onClick={() => setWho("all")}>
              Toute l&apos;équipe
            </button>
            <button type="button" className={who === "me" ? "on" : ""} onClick={() => setWho("me")}>
              Les miens
            </button>
          </div>
        )}
      </div>

      {!list.length ? (
        <div className="card">
          {bookings.length === 0 ? (
            <EmptyState icon="calendar" title="Aucun rendez-vous pour l'instant" text="Partage ton lien de réservation (email, signature, landing page, publicité) : chaque réservation crée le contact et le deal au CRM.">
              {me && <CopyButton text={myLink} label="Copier mon lien" primary />}
            </EmptyState>
          ) : (
            <EmptyState icon="calendar" title={tab === "upcoming" ? "Rien de prévu" : tab === "past" ? "Aucun rendez-vous passé" : "Aucune annulation"} />
          )}
        </div>
      ) : (
        <div>
          {groups.map((g) => (
            <div key={g.key} className="bk-gwrap">
              <div className="bk-group">{g.label}</div>
              <div className="rows">
                {g.items.map((b) => (
                  <BookingLine key={b.id} b={b} type={b.type_id ? typeOf.get(b.type_id) : undefined} tz={tz} multi={multi} host={b.profile_id ? profileOf.get(b.profile_id) : undefined} onOpen={() => open(b.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!tracking && bookings.some((b) => Object.keys((b.utm ?? {}) as object).length) && (
        <p className="bk-note" style={{ marginTop: 14 }}>
          Astuce : ajoute le site de ton agence dans Attribution pour que ces rendez-vous comptent comme conversions « booking ».
        </p>
      )}

      {current && <BookingDrawer b={current} type={current.type_id ? typeOf.get(current.type_id) : undefined} tz={profileOf.get(current.profile_id ?? "")?.timezone || tz} base={base} onClose={() => open(null)} />}
    </div>
  );
}

function BookingLine({ b, type, tz, multi, host, onOpen }: { b: BookingRow; type?: TypeLite; tz: string; multi: boolean; host?: BookingProfile; onOpen: () => void }) {
  const ws = useWorkspace();
  const st = STATUS[b.status as BookingStatus];
  const [, m, dd] = dayIn(Date.parse(b.start_at), tz).split("-").map(Number);
  const utm = (b.utm ?? {}) as Record<string, string>;
  const member = ws.member(b.owner_id);
  return (
    <div className={`bk-row${b.status === "cancelled" ? " off" : ""}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="bk-date">
        <div className="dd">{dd}</div>
        <div className="mm">{MON[m - 1]}</div>
      </div>
      <div className="tm">
        {fmtTime(b.start_at, tz)} à {fmtTime(b.end_at, tz)}
        <span>{durationLabel(Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000))}</span>
      </div>
      <div className="who">
        <b className="trunc">{b.name || b.email}</b>
        <span className="s trunc">
          {b.company_name ? (
            <>
              <Building2 size={11} /> {b.company_name}
            </>
          ) : (
            b.email
          )}
        </span>
      </div>
      <span className="ty" style={{ ["--c" as string]: colorOf(type?.color ?? "gray") }}>
        <i />
        <span className="trunc">{type?.name ?? b.title}</span>
      </span>
      {multi && member && (
        <span title={host?.display_name || member.profile.full_name}>
          <Avatar profile={member.profile} size={22} />
        </span>
      )}
      <span className="src">
        {b.source === "calcom" ? <span className="chip">Cal.com</span> : utm.utm_source ? <span className="chip trunc" style={{ maxWidth: 70 }}>{utm.utm_source}</span> : null}
      </span>
      <Badge color={st?.color ?? "var(--gray)"}>{st?.name ?? b.status}</Badge>
    </div>
  );
}

function BookingDrawer({ b, type, tz, base, onClose }: { b: BookingRow; type?: TypeLite; tz: string; base: string; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const st = STATUS[b.status as BookingStatus];
  const answers = (b.answers ?? {}) as Record<string, string>;
  const utm = (b.utm ?? {}) as Record<string, string>;
  const now = useNow();
  const past = Date.parse(b.start_at) < now;
  const manageUrl = `${base}/b/r/${b.token}`;
  const guestTz = b.timezone && b.timezone !== tz ? b.timezone : null;

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await postJson<{ ok: boolean; movedTo?: string | null }>("/api/booking/manage", { id: b.id, action, ...extra });
      toast(
        action === "cancel"
          ? "Rendez-vous annulé"
          : action === "completed"
            ? r.movedTo
              ? `Rendez-vous honoré, deal passé à « ${r.movedTo} »`
              : "Rendez-vous marqué honoré"
            : action === "no_show"
              ? "Absence notée, une relance est ajoutée au CRM"
              : "Rendez-vous remis à confirmé",
      );
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action impossible", { error: true });
    } finally {
      setBusy(false);
    }
  };

  const labels: Record<string, string> = { phone: "Téléphone", company: "Entreprise", website: "Site web", budget: "Budget pub mensuel", message: "Message" };
  const kind = b.location_kind as LocationKind;

  return (
    <Drawer
      onClose={onClose}
      header={
        <>
          <Badge color={st?.color ?? "var(--gray)"}>{st?.name ?? b.status}</Badge>
          {b.source === "calcom" && <span className="chip">Cal.com</span>}
        </>
      }
    >
      <div className="bk-dt">
        <div>
          <h2>{b.name || b.email}</h2>
          <p className="sub">
            {type?.name ?? b.title} · {fmtWhen(b.start_at, b.end_at, tz)}
          </p>
          {guestTz && <p className="bk-note" style={{ marginTop: 4 }}>Pour le prospect : {fmtWhen(b.start_at, b.end_at, guestTz)} ({guestTz.replace(/_/g, " ")})</p>}
        </div>

        {ws.canWrite && (
          <div className="acts">
            {b.status === "confirmed" && past && (
              <>
                <button className="btn btn-primary" disabled={busy} onClick={() => act("completed")}>
                  <CalendarCheck size={14} /> Honoré
                </button>
                <button className="btn" disabled={busy} onClick={() => act("no_show")}>
                  <UserX size={14} /> Absent
                </button>
              </>
            )}
            {b.status === "confirmed" && !past && (
              <>
                {b.meet_url && (
                  <a className="btn btn-primary" href={b.meet_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Rejoindre la visio
                  </a>
                )}
                <button className="btn" disabled={busy} onClick={() => act("completed")}>
                  <CalendarCheck size={14} /> Honoré
                </button>
              </>
            )}
            {(b.status === "completed" || b.status === "no_show") && (
              <button className="btn" disabled={busy} onClick={() => act("confirmed")}>
                Remettre à confirmé
              </button>
            )}
            {b.status === "confirmed" && (
              <button className="btn" disabled={busy} onClick={() => setCancelOpen(true)}>
                <CalendarX size={14} /> Annuler
              </button>
            )}
          </div>
        )}

        <div>
          <h3>CRM</h3>
          <div className="acts">
            {b.deal_id ? (
              <Link className="btn btn-sm" href={`${ws.base}/crm/deals/${b.deal_id}`}>
                <Handshake size={13} /> Voir le deal
              </Link>
            ) : null}
            {b.contact_id ? (
              <Link className="btn btn-sm" href={`${ws.base}/crm/contacts/${b.contact_id}`}>
                <ContactIcon size={13} /> Voir le contact
              </Link>
            ) : null}
            {b.company_id ? (
              <Link className="btn btn-sm" href={`${ws.base}/crm/companies/${b.company_id}`}>
                <Building2 size={13} /> Voir l&apos;entreprise
              </Link>
            ) : null}
            {!b.deal_id && !b.contact_id && <span className="bk-note">Pas encore relié au CRM.</span>}
          </div>
        </div>

        <div>
          <h3>Détails</h3>
          <dl className="bk-kv">
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${b.email}`}>{b.email}</a>
            </dd>
            {b.phone && (
              <>
                <dt>Téléphone</dt>
                <dd>
                  <a href={`tel:${b.phone.replace(/\s/g, "")}`}>{b.phone}</a>
                </dd>
              </>
            )}
            {b.company_name && (
              <>
                <dt>Entreprise</dt>
                <dd>{b.company_name}</dd>
              </>
            )}
            <dt>Lieu</dt>
            <dd>
              {b.meet_url ? (
                <a href={b.meet_url} target="_blank" rel="noreferrer">
                  {b.meet_url.replace(/^https?:\/\//, "")}
                </a>
              ) : kind === "phone" ? (
                `Téléphone${b.phone ? ` : ${b.phone}` : ""}`
              ) : (
                b.location || LOCATION[kind]?.name || "Non précisé"
              )}
            </dd>
            {Object.entries(answers)
              .filter(([k]) => k !== "phone" && k !== "company")
              .map(([k, v]) => (
                <FragmentKV key={k} k={labels[k] ?? k} v={v} />
              ))}
            {Object.keys(utm).length > 0 && <FragmentKV k="Source" v={Object.entries(utm).map(([k, v]) => `${k} = ${v}`).join("\n")} />}
            <dt>Réservé</dt>
            <dd>{ago(b.created_at)}{b.reschedule_count ? `, déplacé ${b.reschedule_count} fois` : ""}</dd>
            {b.status === "cancelled" && (
              <>
                <dt>Annulation</dt>
                <dd>
                  {b.cancelled_by === "host" ? "Par l'équipe" : b.cancelled_by === "calcom" ? "Depuis Cal.com" : "Par le prospect"}
                  {b.cancel_reason ? ` : « ${b.cancel_reason} »` : ""}
                </dd>
              </>
            )}
            {b.google_event_id && (
              <>
                <dt>Google Agenda</dt>
                <dd>Évènement créé, invitation envoyée</dd>
              </>
            )}
          </dl>
        </div>

        {b.source === "native" && b.status === "confirmed" && !past && (
          <div>
            <h3>Lien du prospect pour déplacer ou annuler</h3>
            <div className="bk-inline">
              <input className="input mono" readOnly value={manageUrl} onFocus={(e) => e.target.select()} />
              <CopyButton text={manageUrl} small label="Copier" />
            </div>
          </div>
        )}
      </div>

      {cancelOpen && (
        <Modal
          title="Annuler ce rendez-vous ?"
          onClose={() => setCancelOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCancelOpen(false)}>
                Garder
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  await act("cancel", { reason });
                  setCancelOpen(false);
                }}
              >
                Annuler le rendez-vous
              </button>
            </>
          }
        >
          <p className="muted">
            {b.name} est prévenu par email{b.google_event_id ? " et l'évènement est retiré de ton Google Agenda" : ""}. L&apos;annulation est notée au CRM.
          </p>
          <div className="field">
            <label htmlFor="bk-cancel-reason">Message pour le prospect (facultatif)</label>
            <textarea id="bk-cancel-reason" className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Un imprévu de mon côté, je vous propose de choisir un autre créneau." />
          </div>
        </Modal>
      )}
    </Drawer>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
