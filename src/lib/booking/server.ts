import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";

import { appUrl } from "@/lib/ads/config";
import { emailEnabled, sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase/server";
import { classify } from "@/lib/tracking/channels";
import { recordConversion, type Site } from "@/lib/tracking/ingest";
import { readSettings } from "@/lib/tracking/settings";
import { computeSlots, dayIn, isValidTz, type Existing, type Override, type SlotInput } from "./engine";
import { guestCancelled, guestConfirmed, hostBooked, hostCancelled, type MailCtx } from "./emails";
import { CalendarError, createEvent, deleteEvent, freeBusy, getConnection, moveEvent } from "./google";
import { buildIcs } from "./ics";
import { LOCATION, fmtWhen, readQuestions, readWeekly, UTM_KEYS, type Booking, type BookingType, type LocationKind } from "./shared";

// =====================================================================
// Prise de rendez-vous côté serveur (service role). Utilisé par la page
// publique, les routes /api/booking/*, le webhook Cal.com et le cron.
// =====================================================================

const db = () => supabaseAdmin();
const MIN = 60_000;
const DAY = 864e5;

export class BookingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

// ---------------------------------------------------------------------
// Chargement de la page publique d'un membre
// ---------------------------------------------------------------------
export interface PublicProfile {
  id: string;
  slug: string;
  workspace_id: string;
  user_id: string;
  display_name: string;
  headline: string;
  welcome: string;
  timezone: string;
  weekly: unknown;
  busy_calendars: string[];
  event_calendar: string;
  host: { name: string; email: string; color: string; title: string };
  workspace: { id: string; name: string; slug: string; accent: string };
  types: BookingType[];
}

export async function loadPublicProfile(slug: string, withInactiveTypes = false): Promise<PublicProfile | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return null;
  const sb = db();
  const { data: p } = await sb
    .from("booking_profiles")
    .select("id, slug, workspace_id, user_id, display_name, headline, welcome, timezone, weekly, busy_calendars, event_calendar, active")
    .eq("slug", slug)
    .maybeSingle();
  if (!p || !p.active) return null;
  const [host, ws, member, types] = await Promise.all([
    sb.from("profiles").select("full_name, email, color, title").eq("id", p.user_id).maybeSingle(),
    sb.from("workspaces").select("id, name, slug, accent").eq("id", p.workspace_id).maybeSingle(),
    sb.from("workspace_members").select("role").eq("workspace_id", p.workspace_id).eq("user_id", p.user_id).maybeSingle(),
    (() => {
      let q = sb.from("booking_types").select("*").eq("profile_id", p.id).order("position").order("created_at");
      if (!withInactiveTypes) q = q.eq("active", true);
      return q;
    })(),
  ]);
  if (!host.data || !ws.data || !member.data || member.data.role === "guest") return null;
  return {
    ...p,
    timezone: isValidTz(p.timezone) ? p.timezone : "Europe/Paris",
    host: { name: p.display_name || host.data.full_name || host.data.email, email: host.data.email, color: host.data.color, title: host.data.title },
    workspace: ws.data,
    types: types.data ?? [],
  };
}

// ---------------------------------------------------------------------
// Créneaux disponibles
// ---------------------------------------------------------------------
export async function getSlots(pp: PublicProfile, type: BookingType, opts: { exclude?: Booking | null; days?: string[] } = {}) {
  const now = Date.now();
  const until = now + (type.horizon_days + 2) * DAY;
  const sb = db();
  const [bk, ov] = await Promise.all([
    sb
      .from("bookings")
      .select("id, type_id, start_at, end_at, buffer_before_min, buffer_after_min")
      .eq("profile_id", pp.id)
      .eq("status", "confirmed")
      .gte("end_at", new Date(now - DAY).toISOString())
      .lte("start_at", new Date(until).toISOString())
      .limit(2000),
    sb.from("booking_overrides").select("day_start, day_end, ranges").eq("profile_id", pp.id).gte("day_end", new Date(now - DAY).toISOString().slice(0, 10)),
  ]);
  const bookings: Existing[] = (bk.data ?? [])
    .filter((b) => b.id !== opts.exclude?.id)
    .map((b) => ({
      start: Date.parse(b.start_at),
      end: Date.parse(b.end_at),
      bufferBefore: b.buffer_before_min,
      bufferAfter: b.buffer_after_min,
      sameType: b.type_id === type.id,
    }));

  let busy: { start: number; end: number }[] = [];
  let calendar: "none" | "ok" | "error" = "none";
  const conn = await getConnection(pp.workspace_id, pp.user_id);
  if (conn) {
    try {
      busy = await freeBusy(conn, pp.busy_calendars, now, until);
      // Report : l'évènement Google du rendez-vous déplacé ne bloque pas son propre créneau
      if (opts.exclude) {
        const s = Date.parse(opts.exclude.start_at);
        const e = Date.parse(opts.exclude.end_at);
        busy = busy.filter((b) => !(b.start >= s && b.end <= e));
      }
      calendar = "ok";
    } catch (e) {
      // Agenda indisponible : les créneaux restent calculés sur les disponibilités (erreur visible dans les réglages)
      console.error("[booking] freeBusy", e instanceof Error ? e.message : e);
      calendar = "error";
    }
  }

  const input: SlotInput = {
    tz: pp.timezone,
    weekly: readWeekly(pp.weekly),
    overrides: (ov.data ?? []) as unknown as Override[],
    rules: {
      duration: type.duration_min,
      interval: type.slot_interval_min,
      bufferBefore: type.buffer_before_min,
      bufferAfter: type.buffer_after_min,
      minNotice: type.min_notice_min,
      horizonDays: type.horizon_days,
      dailyLimit: type.daily_limit,
    },
    bookings,
    busy,
    now,
    days: opts.days,
  };
  return { slots: computeSlots(input), calendar };
}

// ---------------------------------------------------------------------
// Réservation publique
// ---------------------------------------------------------------------
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const BookSchema = z.object({
  profile: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  type: z.string().regex(SLUG),
  start: z.iso.datetime({ offset: true }),
  tz: z.string().max(64).refine(isValidTz, "Fuseau horaire inconnu"),
  name: z.string().trim().min(2, "Merci d'indiquer votre nom").max(120),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email("Adresse email invalide").max(254)),
  answers: z.record(z.string().max(40), z.string().max(3000)).default({}),
  utm: z.record(z.string().max(40), z.string().max(300)).default({}),
  aos_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  page_url: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
  reschedule: z.string().regex(/^[a-f0-9]{36}$/).optional(),
  // Pot de miel anti-robots : doit rester vide
  website_url: z.string().max(0).optional(),
});
export type BookInput = z.infer<typeof BookSchema>;

const cleanUtm = (u: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) if (u[k]?.trim()) out[k] = u[k].trim().slice(0, 200);
  return out;
};

export async function bookingByToken(token: string) {
  if (!/^[a-f0-9]{36}$/.test(token)) return null;
  const { data } = await db().from("bookings").select("*").eq("token", token).maybeSingle();
  return data;
}

/** Rendez-vous à venir de ce membre, que le prospect peut encore déplacer */
export async function reschedulable(token: string, profileId: string) {
  const b = await bookingByToken(token);
  return b && b.profile_id === profileId && b.status === "confirmed" && Date.parse(b.start_at) > Date.now() ? b : null;
}

export async function book(input: BookInput) {
  const pp = await loadPublicProfile(input.profile);
  const type = pp?.types.find((t) => t.slug === input.type);
  if (!pp || !type) throw new BookingError("Ce type de rendez-vous n'est plus disponible.", 404);

  const start = Date.parse(input.start);
  const end = start + type.duration_min * MIN;
  if (!Number.isFinite(start)) throw new BookingError("Créneau invalide");

  // Questions obligatoires et valeurs connues
  const questions = readQuestions(type.questions);
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const v = (input.answers[q.key] ?? "").trim();
    const required = q.required || (q.key === "phone" && type.location_kind === "phone");
    if (required && !v) throw new BookingError(`Le champ « ${q.label} » est obligatoire.`);
    if (v && q.type === "select" && q.options?.length && !q.options.includes(v)) throw new BookingError(`Valeur invalide pour « ${q.label} ».`);
    if (v) answers[q.key] = v.slice(0, q.type === "textarea" ? 3000 : 300);
  }
  if (type.location_kind === "phone" && !questions.some((q) => q.key === "phone")) {
    const v = (input.answers.phone ?? "").trim();
    if (!v) throw new BookingError("Merci d'indiquer votre numéro de téléphone.");
    answers.phone = v.slice(0, 40);
  }

  // Report d'un rendez-vous existant
  let previous: Booking | null = null;
  if (input.reschedule) {
    previous = await bookingByToken(input.reschedule);
    if (!previous || previous.profile_id !== pp.id || previous.status !== "confirmed")
      throw new BookingError("Ce rendez-vous ne peut plus être déplacé (annulé ou déjà passé).", 409);
    if (Date.parse(previous.start_at) < Date.now()) throw new BookingError("Ce rendez-vous est déjà passé.", 409);
  }

  const { slots } = await getSlots(pp, type, { exclude: previous, days: [dayIn(start, pp.timezone)] });
  if (!slots.includes(start)) throw new BookingError("Ce créneau n'est plus disponible. Merci d'en choisir un autre.", 409);

  if (previous) return reschedule(pp, type, previous, start, end, input.tz);

  const utm = cleanUtm(input.utm);
  const kind = type.location_kind as LocationKind;
  const location = kind === "phone" ? answers.phone ?? "" : kind === "video" || kind === "address" ? type.location_value : "";
  const sb = db();
  const { data: row, error } = await sb
    .from("bookings")
    .insert({
      workspace_id: pp.workspace_id,
      profile_id: pp.id,
      type_id: type.id,
      owner_id: pp.user_id,
      source: "native",
      title: type.name,
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      buffer_before_min: type.buffer_before_min,
      buffer_after_min: type.buffer_after_min,
      timezone: input.tz,
      name: input.name.trim(),
      email: input.email,
      phone: answers.phone ?? "",
      company_name: answers.company ?? "",
      answers,
      location_kind: kind,
      location,
      utm,
      page_url: (input.page_url ?? "").slice(0, 2000),
    })
    .select("*")
    .single();
  if (error?.code === "23P01") throw new BookingError("Ce créneau vient d'être réservé. Merci d'en choisir un autre.", 409);
  if (error || !row) throw new BookingError("La réservation a échoué, merci de réessayer.", 500);

  let b: Booking = row;

  // CRM : contact, entreprise, deal, activité
  try {
    const crm = await syncCrm(b, type, pp);
    b = { ...b, ...crm };
    await sb.from("bookings").update(crm).eq("id", b.id);
  } catch (e) {
    console.error("[booking] CRM", e instanceof Error ? e.message : e);
  }

  // Google Agenda : évènement + Meet + invitation
  b = await pushGoogle(b, pp, type);

  await Promise.allSettled([
    notifyHost(b, `Nouveau rendez-vous : ${b.name}, ${type.name.toLowerCase()} le ${fmtWhen(b.start_at, b.end_at, pp.timezone).replace(/^./, (c) => c.toLowerCase())}`),
    mailBooked(b, pp, type, false),
    trackBooking(b, pp, type, input),
  ]);
  return b;
}

async function reschedule(pp: PublicProfile, type: BookingType, prev: Booking, start: number, end: number, tz: string) {
  const sb = db();
  const { data: row, error } = await sb
    .from("bookings")
    .update({
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      timezone: tz,
      buffer_before_min: type.buffer_before_min,
      buffer_after_min: type.buffer_after_min,
      reschedule_count: prev.reschedule_count + 1,
      reminded_24h_at: null,
      reminded_1h_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prev.id)
    .eq("status", "confirmed")
    .select("*")
    .single();
  if (error?.code === "23P01") throw new BookingError("Ce créneau vient d'être réservé. Merci d'en choisir un autre.", 409);
  if (error || !row) throw new BookingError("Le report a échoué, merci de réessayer.", 500);

  const when = fmtWhen(row.start_at, row.end_at, pp.timezone);
  if (row.activity_id) await sb.from("crm_activities").update({ due_at: row.start_at }).eq("id", row.activity_id);
  await addActivity(row, "note", `Rendez-vous « ${type.name} » déplacé par ${row.name} : ${when.charAt(0).toLowerCase() + when.slice(1)}.`, true);

  if (row.google_event_id && row.google_calendar_id) {
    const conn = await getConnection(pp.workspace_id, pp.user_id);
    if (conn) {
      try {
        await moveEvent(conn, row.google_calendar_id, row.google_event_id, row.start_at, row.end_at, pp.timezone);
      } catch (e) {
        console.error("[booking] moveEvent", e instanceof Error ? e.message : e);
      }
    }
  }
  await Promise.allSettled([notifyHost(row, `Rendez-vous déplacé : ${row.name}, ${when.charAt(0).toLowerCase() + when.slice(1)}`), mailBooked(row, pp, type, true)]);
  return row;
}

// ---------------------------------------------------------------------
// CRM automatique
// ---------------------------------------------------------------------
const FREE_MAIL =
  /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|laposte|orange|wanadoo|free|sfr|neuf|bbox|numericable|club-internet|aliceadsl|yandex|mail|zoho|hey|tutanota|skynet|bluewin|videotron)\./i;
const like = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export function proDomain(email: string) {
  const d = email.split("@")[1]?.toLowerCase().trim() ?? "";
  return d && !FREE_MAIL.test(d) ? d : "";
}
const hostOfUrl = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface CrmLink {
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  activity_id: string | null;
}

/** Contact (par email), entreprise (domaine pro ou champ société), deal et activité « meeting » */
export async function syncCrm(
  b: Pick<Booking, "id" | "workspace_id" | "owner_id" | "name" | "email" | "phone" | "company_name" | "answers" | "utm" | "start_at" | "end_at" | "title" | "timezone">,
  type: { name: string; create_deal: boolean; questions: unknown } | null,
  pp: { timezone: string } | null,
): Promise<CrmLink> {
  const sb = db();
  const ws = b.workspace_id;
  const answers = (b.answers ?? {}) as Record<string, string>;
  const website = answers.website ?? "";

  // Entreprise
  let company_id: string | null = null;
  const companyName = (b.company_name || answers.company || "").trim();
  const domain = proDomain(b.email) || (website ? hostOfUrl(website) : "");
  if (companyName) {
    const { data } = await sb.from("companies").select("id").eq("workspace_id", ws).ilike("name", like(companyName)).limit(1).maybeSingle();
    company_id = data?.id ?? null;
  }
  if (!company_id && domain) {
    const { data } = await sb.from("companies").select("id").eq("workspace_id", ws).ilike("website", `%${like(domain)}%`).limit(1).maybeSingle();
    company_id = data?.id ?? null;
  }
  if (!company_id && (companyName || domain)) {
    const { data } = await sb
      .from("companies")
      .insert({
        workspace_id: ws,
        name: companyName || titleCase(domain.split(".")[0]),
        website: website ? hostOfUrl(website) : domain,
        status: "lead",
        owner_id: b.owner_id,
        notes: "Créée par une prise de rendez-vous.",
      })
      .select("id")
      .single();
    company_id = data?.id ?? null;
  }

  // Contact
  let contact_id: string | null = null;
  const { data: found } = await sb.from("contacts").select("id, phone, company_id").eq("workspace_id", ws).ilike("email", like(b.email)).limit(1).maybeSingle();
  if (found) {
    contact_id = found.id;
    const patch: { phone?: string; company_id?: string } = {};
    if (!found.phone && b.phone) patch.phone = b.phone;
    if (!found.company_id && company_id) patch.company_id = company_id;
    if (Object.keys(patch).length) await sb.from("contacts").update(patch).eq("id", found.id);
    if (!company_id) company_id = found.company_id;
  } else {
    const [first, ...rest] = b.name.trim().split(/\s+/);
    const { data } = await sb
      .from("contacts")
      .insert({ workspace_id: ws, company_id, first_name: first ?? "", last_name: rest.join(" "), email: b.email, phone: b.phone ?? "", notes: "Créé par une prise de rendez-vous." })
      .select("id")
      .single();
    contact_id = data?.id ?? null;
  }

  // Deal : on reprend un deal ouvert du contact, sinon on en crée un dans « Appel découverte »
  let deal_id: string | null = null;
  if (type?.create_deal !== false && contact_id) {
    const { data: stages } = await sb.from("pipeline_stages").select("id, name, kind, position").eq("workspace_id", ws).order("position");
    const open = (stages ?? []).filter((s) => s.kind === "open");
    const { data: existing } = open.length
      ? await sb
          .from("deals")
          .select("id")
          .eq("workspace_id", ws)
          .eq("contact_id", contact_id)
          .in("stage_id", open.map((s) => s.id))
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    if (existing) deal_id = existing.id;
    else {
      const stage = entryStage(open);
      const { data: top } = stage
        ? await sb.from("deals").select("position").eq("stage_id", stage.id).order("position").limit(1).maybeSingle()
        : { data: null };
      const utm = (b.utm ?? {}) as Record<string, string>;
      const source = utm.utm_source ? [utm.utm_source, utm.utm_campaign].filter(Boolean).join(" / ").slice(0, 120) : "Prise de rendez-vous";
      let companyLabel = companyName;
      if (!companyLabel && company_id) companyLabel = (await sb.from("companies").select("name").eq("id", company_id).maybeSingle()).data?.name ?? "";
      const title = `${type?.name ?? b.title} · ${companyLabel || b.name}`.slice(0, 200);
      const { data: deal } = await sb
        .from("deals")
        .insert({
          workspace_id: ws,
          title,
          company_id,
          contact_id,
          stage_id: stage?.id ?? null,
          owner_id: b.owner_id,
          source,
          position: top ? Number(top.position) - 1000 : 1000,
        })
        .select("id")
        .single();
      deal_id = deal?.id ?? null;
      if (deal_id) {
        // Le déclencheur « Deal confié » ferait doublon avec la notification du rendez-vous
        await sb.from("notifications").delete().eq("deal_id", deal_id).eq("kind", "deal").like("body", "Deal confié%");
        await sb.from("activity").insert({ workspace_id: ws, verb: "deal.created", deal_id, actor_id: null, meta: { title, stage: stage?.name ?? null, via: "booking" } });
      }
    }
  }

  // Activité « rendez-vous » datée
  const when = fmtWhen(b.start_at, b.end_at, pp?.timezone ?? "Europe/Paris");
  const qs = readQuestions(type?.questions);
  const lines = qs.filter((q) => answers[q.key] && q.key !== "phone" && q.key !== "company").map((q) => `${q.label} : ${answers[q.key]}`);
  const utm = (b.utm ?? {}) as Record<string, string>;
  if (utm.utm_source) lines.push(`Source : ${[utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean).join(" / ")}`);
  const { data: act } = await sb
    .from("crm_activities")
    .insert({
      workspace_id: ws,
      deal_id,
      company_id,
      contact_id,
      kind: "meeting",
      body: [`${type?.name ?? b.title} réservé en ligne : ${when.charAt(0).toLowerCase() + when.slice(1)}.`, ...lines].join("\n"),
      due_at: b.start_at,
      author_id: b.owner_id,
    })
    .select("id")
    .single();

  return { contact_id, company_id, deal_id, activity_id: act?.id ?? null };
}

/** Étape d'entrée des rendez-vous : « Appel découverte » si elle existe, sinon la première étape ouverte */
function entryStage<S extends { id: string; name: string }>(open: S[]) {
  return open.find((s) => /d[ée]couverte/i.test(s.name)) ?? open[0] ?? null;
}

async function addActivity(b: Pick<Booking, "workspace_id" | "deal_id" | "company_id" | "contact_id" | "owner_id">, kind: "note" | "task", body: string, done = false, due?: string) {
  if (!b.deal_id && !b.contact_id && !b.company_id) return;
  await db()
    .from("crm_activities")
    .insert({ workspace_id: b.workspace_id, deal_id: b.deal_id, company_id: b.company_id, contact_id: b.contact_id, kind, body, done, due_at: due ?? null, author_id: b.owner_id });
}

// ---------------------------------------------------------------------
// Notification in-app du membre (type « booking », repli sur « deal »)
// ---------------------------------------------------------------------
async function notifyHost(b: Pick<Booking, "workspace_id" | "owner_id" | "deal_id">, body: string) {
  if (!b.owner_id) return;
  const sb = db();
  const row = { workspace_id: b.workspace_id, user_id: b.owner_id, actor_id: null, deal_id: b.deal_id, body: body.slice(0, 300) };
  const { error } = await sb.from("notifications").insert({ ...row, kind: "booking" });
  if (error?.code === "23514") await sb.from("notifications").insert({ ...row, kind: "deal" });
  else if (error) console.error("[booking] notification", error.message);
}

// ---------------------------------------------------------------------
// Google Agenda
// ---------------------------------------------------------------------
async function pushGoogle(b: Booking, pp: PublicProfile, type: BookingType): Promise<Booking> {
  const conn = await getConnection(pp.workspace_id, pp.user_id);
  if (!conn) return b;
  const kind = type.location_kind as LocationKind;
  const answers = (b.answers ?? {}) as Record<string, string>;
  const qs = readQuestions(type.questions);
  const desc = [
    `${type.name} réservé en ligne via Agence OS.`,
    "",
    `Nom : ${b.name}`,
    `Email : ${b.email}`,
    ...qs.filter((q) => answers[q.key]).map((q) => `${q.label} : ${answers[q.key]}`),
    "",
    `Déplacer ou annuler : ${appUrl()}/b/r/${b.token}`,
  ].join("\n");
  try {
    const ev = await createEvent(conn, {
      calendarId: pp.event_calendar || "primary",
      summary: `${type.name} · ${b.name}${b.company_name ? ` (${b.company_name})` : ""}`,
      description: desc,
      start: b.start_at,
      end: b.end_at,
      timeZone: pp.timezone,
      attendee: { email: b.email, name: b.name },
      location: kind === "phone" ? `Téléphone : ${b.phone}` : kind === "address" || kind === "video" ? type.location_value : undefined,
      meet: kind === "google_meet",
    });
    const patch = { google_event_id: ev.id, google_calendar_id: pp.event_calendar || "primary", meet_url: ev.meet || (kind === "video" ? type.location_value : "") };
    await db().from("bookings").update(patch).eq("id", b.id);
    return { ...b, ...patch };
  } catch (e) {
    console.error("[booking] createEvent", e instanceof Error ? e.message : e);
    if (e instanceof CalendarError) await db().from("booking_google").update({ last_error: e.message }).eq("id", conn.id);
    return b;
  }
}

// ---------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------
async function mailCtx(b: Booking, pp: Pick<PublicProfile, "timezone" | "host" | "workspace" | "slug">, typeName: string, questions: unknown): Promise<MailCtx> {
  const answers = (b.answers ?? {}) as Record<string, string>;
  const qs = readQuestions(questions);
  return {
    agency: pp.workspace.name,
    host: { name: pp.host.name, email: pp.host.email },
    typeName,
    guest: { name: b.name, email: b.email, tz: isValidTz(b.timezone) ? b.timezone : pp.timezone },
    start: b.start_at,
    end: b.end_at,
    hostTz: pp.timezone,
    locationKind: b.location_kind,
    location: b.location,
    meetUrl: b.meet_url,
    manageUrl: `${appUrl()}/b/r/${b.token}`,
    appUrl: `${appUrl()}/w/${pp.workspace.slug}/booking?b=${b.id}`,
    answers: qs.filter((q) => answers[q.key]).map((q) => ({ label: q.label, value: answers[q.key] })),
  };
}

function icsFor(b: Booking, pp: Pick<PublicProfile, "host">, typeName: string, cancelled = false) {
  const kind = b.location_kind as LocationKind;
  return buildIcs({
    uid: b.id,
    title: `${typeName} avec ${pp.host.name}`,
    description: `Déplacer ou annuler : ${appUrl()}/b/r/${b.token}`,
    start: b.start_at,
    end: b.end_at,
    location: b.meet_url || (kind === "phone" ? `Téléphone : ${b.location}` : b.location) || LOCATION[kind]?.name,
    url: b.meet_url || undefined,
    organizer: { name: pp.host.name, email: pp.host.email },
    attendee: { name: b.name, email: b.email },
    cancelled,
    sequence: b.reschedule_count + (cancelled ? 1 : 0),
  });
}

async function mailBooked(b: Booking, pp: PublicProfile, type: BookingType, rescheduled: boolean) {
  if (!emailEnabled()) return;
  const c = await mailCtx(b, pp, type.name, type.questions);
  const g = guestConfirmed(c, rescheduled);
  // Sans évènement Google (qui envoie sa propre invitation), on joint un .ics
  const attachments = b.google_event_id ? undefined : [{ filename: "rendez-vous.ics", content: Buffer.from(icsFor(b, pp, type.name)).toString("base64"), contentType: "text/calendar" }];
  const h = hostBooked(c, rescheduled);
  await Promise.all([
    sendEmail({ to: b.email, subject: g.subject, html: g.html, replyTo: pp.host.email, attachments }),
    sendEmail({ to: pp.host.email, subject: h.subject, html: h.html, replyTo: b.email }),
  ]);
}

export { icsFor };

// ---------------------------------------------------------------------
// Tracking : évènement « booking » sur le site suivi de l'agence
// ---------------------------------------------------------------------
async function trackBooking(b: Booking, pp: PublicProfile, type: BookingType, input: BookInput) {
  const utm = (b.utm ?? {}) as Record<string, string>;
  const hasUtm = Object.keys(utm).length > 0;
  if (!hasUtm && !input.aos_id) return;
  const sb = db();
  const { data: s } = await sb
    .from("tracking_sites")
    .select("id, workspace_id, company_id, domains, settings")
    .eq("workspace_id", b.workspace_id)
    .is("company_id", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!s) return;
  const site: Site = { ...s, settings: readSettings(s.settings) };

  // Visiteur : identifiant du script (_aos_id) si transmis, sinon celui déjà connu pour cet email
  let anon = input.aos_id ?? "";
  if (!anon) {
    const { data: v } = await sb.from("visitors").select("anon_id").eq("site_id", site.id).eq("email", b.email).order("last_seen", { ascending: false }).limit(1).maybeSingle();
    anon = v?.anon_id ?? `bk_${randomBytes(12).toString("hex")}`;
  }
  const now = new Date().toISOString();
  const { data: visitor } = await sb
    .from("visitors")
    .upsert({ site_id: site.id, workspace_id: site.workspace_id, anon_id: anon, last_seen: now }, { onConflict: "site_id,anon_id" })
    .select("id")
    .single();

  // Arrivée sur la page de réservation avec une source : point de contact
  if (visitor && hasUtm) {
    const q = new URLSearchParams(utm).toString();
    const landing = input.page_url && /^https?:\/\//.test(input.page_url) ? input.page_url : `${appUrl()}/b/${pp.slug}/${type.slug}?${q}`;
    const a = classify(landing.includes("utm_") || landing.includes("clid") ? landing : `${landing}${landing.includes("?") ? "&" : "?"}${q}`, input.referrer ?? "", site.domains);
    await sb.from("touchpoints").insert({
      site_id: site.id,
      workspace_id: site.workspace_id,
      visitor_id: visitor.id,
      ts: new Date(Date.parse(b.created_at) - 1000).toISOString(),
      landing_url: landing.slice(0, 2000),
      referrer: (input.referrer ?? "").slice(0, 1000),
      utm_source: a.utm_source,
      utm_medium: a.utm_medium,
      utm_campaign: a.utm_campaign,
      utm_content: a.utm_content,
      utm_term: a.utm_term,
      utm_id: a.utm_id,
      click_id_type: a.click_id_type,
      click_id: a.click_id,
      channel: a.channel,
      platform: a.platform,
      campaign_key: a.campaign_key,
      adset_key: a.adset_key,
      ad_key: a.ad_key,
    });
  }
  const res = await recordConversion(
    site,
    { anon_id: anon, email: b.email, type: "booking", order_id: `booking:${b.id}`, name: b.name, phone: b.phone || undefined, props: { rdv: type.name, start: b.start_at } },
    "api",
  );
  if (!res.ok) console.error("[booking] tracking", res.error);
}

// ---------------------------------------------------------------------
// Annulation, statut honoré / absent
// ---------------------------------------------------------------------
async function profileFor(b: Booking): Promise<Pick<PublicProfile, "timezone" | "host" | "workspace" | "slug" | "user_id" | "workspace_id"> | null> {
  const sb = db();
  const [p, ws] = await Promise.all([
    b.profile_id ? sb.from("booking_profiles").select("slug, timezone, display_name, user_id, workspace_id").eq("id", b.profile_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("workspaces").select("id, name, slug, accent").eq("id", b.workspace_id).maybeSingle(),
  ]);
  const uid = p.data?.user_id ?? b.owner_id;
  if (!ws.data || !uid) return null;
  const { data: host } = await sb.from("profiles").select("full_name, email, color, title").eq("id", uid).maybeSingle();
  return {
    slug: p.data?.slug ?? "",
    timezone: p.data?.timezone && isValidTz(p.data.timezone) ? p.data.timezone : "Europe/Paris",
    user_id: uid,
    workspace_id: b.workspace_id,
    workspace: ws.data,
    host: { name: p.data?.display_name || host?.full_name || host?.email || "", email: host?.email ?? "", color: host?.color ?? "#5A67D8", title: host?.title ?? "" },
  };
}

export async function cancelBooking(b: Booking, by: "guest" | "host" | "calcom", reason = "") {
  if (b.status !== "confirmed") throw new BookingError("Ce rendez-vous n'est plus actif.", 409);
  const sb = db();
  const { data: row } = await sb
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: by, cancel_reason: reason.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "confirmed")
    .select("*")
    .maybeSingle();
  if (!row) throw new BookingError("Ce rendez-vous n'est plus actif.", 409);
  const pp = await profileFor(row);
  const type = row.type_id ? (await sb.from("booking_types").select("name, slug, questions").eq("id", row.type_id).maybeSingle()).data : null;
  const typeName = type?.name ?? row.title ?? "Rendez-vous";

  if (row.activity_id) {
    const { data: act } = await sb.from("crm_activities").select("body").eq("id", row.activity_id).maybeSingle();
    if (act && !act.body.startsWith("Annulé")) await sb.from("crm_activities").update({ body: `Annulé : ${act.body}`, done: true }).eq("id", row.activity_id);
  }
  const who = by === "host" ? "par toi" : by === "calcom" ? "sur Cal.com" : `par ${row.name}`;
  await addActivity(row, "note", `Rendez-vous « ${typeName} » annulé ${who}${reason ? ` : ${reason}` : "."}`, true);

  if (row.source === "native" && row.google_event_id && row.google_calendar_id && pp) {
    const conn = await getConnection(row.workspace_id, pp.user_id);
    if (conn) {
      try {
        await deleteEvent(conn, row.google_calendar_id, row.google_event_id);
      } catch (e) {
        console.error("[booking] deleteEvent", e instanceof Error ? e.message : e);
      }
    }
  }
  if (by !== "host") await notifyHost(row, `Rendez-vous annulé : ${row.name}, ${typeName.toLowerCase()} du ${fmtWhen(row.start_at, row.end_at, pp?.timezone ?? "Europe/Paris").replace(/^./, (c) => c.toLowerCase())}`);

  if (emailEnabled() && pp && row.source === "native") {
    const c = await mailCtx(row, pp, typeName, type?.questions);
    c.reason = reason;
    const g = guestCancelled({ ...c, appUrl: type && pp.slug ? `${appUrl()}/b/${pp.slug}/${type.slug}` : undefined }, by === "host");
    const mails = [
      sendEmail({
        to: row.email,
        subject: g.subject,
        html: g.html,
        replyTo: pp.host.email,
        attachments: row.google_event_id ? undefined : [{ filename: "annulation.ics", content: Buffer.from(icsFor(row, pp, typeName, true)).toString("base64"), contentType: "text/calendar" }],
      }),
    ];
    if (by === "guest") {
      const h = hostCancelled(c);
      mails.push(sendEmail({ to: pp.host.email, subject: h.subject, html: h.html, replyTo: row.email }));
    }
    await Promise.allSettled(mails);
  }
  return row;
}

/** Honoré / absent / remis à confirmé, depuis l'app */
export async function setOutcome(b: Booking, status: "completed" | "no_show" | "confirmed", actor: string) {
  const sb = db();
  if (b.status === "cancelled") throw new BookingError("Un rendez-vous annulé ne peut pas changer de statut.", 409);
  const { data: row, error } = await sb.from("bookings").update({ status, updated_at: new Date().toISOString() }).eq("id", b.id).select("*").single();
  if (error?.code === "23P01") throw new BookingError("Un autre rendez-vous occupe déjà ce créneau.", 409);
  if (error || !row) throw new BookingError("Mise à jour impossible", 500);
  if (row.activity_id) await sb.from("crm_activities").update({ done: status !== "confirmed" }).eq("id", row.activity_id);
  const who = { ...row, owner_id: actor };

  if (status === "completed") {
    await addActivity(who, "note", `Rendez-vous « ${row.title} » honoré.`, true);
    // Le deal quitte l'étape d'entrée (« Appel découverte ») pour l'étape ouverte suivante
    if (row.deal_id) {
      const { data: deal } = await sb.from("deals").select("id, title, stage_id").eq("id", row.deal_id).maybeSingle();
      const { data: stages } = await sb.from("pipeline_stages").select("id, name, kind, position").eq("workspace_id", row.workspace_id).order("position");
      const open = (stages ?? []).filter((s) => s.kind === "open");
      const entry = entryStage(open);
      if (deal && entry && deal.stage_id === entry.id) {
        const next = open.find((s) => s.position > entry.position);
        if (next) {
          const { data: top } = await sb.from("deals").select("position").eq("stage_id", next.id).order("position").limit(1).maybeSingle();
          await sb.from("deals").update({ stage_id: next.id, position: top ? Number(top.position) - 1000 : 1000 }).eq("id", deal.id);
          await sb.from("activity").insert({ workspace_id: row.workspace_id, verb: "deal.stage", deal_id: deal.id, actor_id: actor, meta: { title: deal.title, from: entry.name, to: next.name, via: "booking" } });
          return { booking: row, movedTo: next.name };
        }
      }
    }
  } else if (status === "no_show") {
    await addActivity(who, "note", `Absent au rendez-vous « ${row.title} ».`, true);
    await addActivity(who, "task", `Relancer ${row.name} (absent au rendez-vous) et lui proposer un nouveau créneau`, false, new Date(Date.now() + DAY).toISOString());
  }
  return { booking: row, movedTo: null as string | null };
}

// ---------------------------------------------------------------------
// Rappels (cron)
// ---------------------------------------------------------------------
export async function sendReminders() {
  if (!emailEnabled()) return { sent: 0, skipped: "emails non configurés" };
  const { guestReminder } = await import("./emails");
  const sb = db();
  const now = Date.now();
  const { data } = await sb
    .from("bookings")
    .select("*")
    .eq("status", "confirmed")
    .eq("source", "native")
    .eq("demo", false)
    .gt("start_at", new Date(now).toISOString())
    .lt("start_at", new Date(now + 25 * 3600_000).toISOString())
    .or("reminded_24h_at.is.null,reminded_1h_at.is.null")
    .limit(500);
  let sent = 0;
  const types = new Map<string, { name: string; questions: unknown } | null>();
  for (const b of data ?? []) {
    const start = Date.parse(b.start_at);
    const lead = start - now;
    // Délai entre la réservation et le rendez-vous : pas de rappel « demain » pour un rendez-vous pris la veille
    const ahead = start - Date.parse(b.created_at);
    const stamp = new Date().toISOString();
    const patch: { reminded_1h_at?: string; reminded_24h_at?: string } = {};
    let soon: boolean | null = null;
    if (!b.reminded_1h_at && lead <= 75 * MIN) {
      // Fenêtre de 75 min : un cron toutes les 15 min ne rate aucun rendez-vous
      patch.reminded_1h_at = stamp;
      if (!b.reminded_24h_at) patch.reminded_24h_at = stamp;
      if (ahead > 2 * 3600_000) soon = true;
    } else if (!b.reminded_24h_at && lead <= 24 * 3600_000) {
      patch.reminded_24h_at = stamp;
      if (ahead > 26 * 3600_000) soon = false;
    }
    if (soon !== null) {
      if (!types.has(b.type_id ?? "")) types.set(b.type_id ?? "", b.type_id ? (await sb.from("booking_types").select("name, questions").eq("id", b.type_id).maybeSingle()).data : null);
      const t = types.get(b.type_id ?? "");
      const pp = await profileFor(b);
      if (pp) {
        const m = guestReminder(await mailCtx(b, pp, t?.name ?? b.title, t?.questions), soon);
        const r = await sendEmail({ to: b.email, subject: m.subject, html: m.html, replyTo: pp.host.email });
        // Échec d'envoi : on retentera au prochain passage
        if (r.sent) sent++;
        else continue;
      }
    }
    if (Object.keys(patch).length) await sb.from("bookings").update(patch).eq("id", b.id);
  }
  return { sent, checked: data?.length ?? 0 };
}

export const newSecret = () => randomBytes(24).toString("hex");
