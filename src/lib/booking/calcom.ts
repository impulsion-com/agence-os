import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/server";
import { isValidTz } from "./engine";
import { BookingError, cancelBooking, setOutcome, syncCrm } from "./server";
import { fmtWhen, UTM_KEYS, type Question } from "./shared";

// =====================================================================
// Connecteur Cal.com (cloud ou auto-hébergé) : webhook entrant
//   POST /api/booking/calcom?ws=<workspace id>
// Signature : en-tête x-cal-signature-256 = HMAC-SHA256 (hex) du corps brut
// avec le secret affiché dans Rendez-vous > Réglages > Cal.com.
// =====================================================================

export function verifySignature(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.trim().replace(/^sha256=/, ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

interface CalPerson {
  name?: string;
  email?: string;
  timeZone?: string;
  phoneNumber?: string | null;
}
interface CalPayload {
  uid?: string;
  bookingId?: number;
  title?: string;
  eventTitle?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  organizer?: CalPerson;
  attendees?: CalPerson[];
  responses?: Record<string, { label?: string; value?: unknown } | undefined>;
  location?: string;
  metadata?: Record<string, unknown> & { videoCallUrl?: string };
  tracking?: Record<string, unknown>;
  cancellationReason?: string | null;
  rescheduleUid?: string;
  fromReschedule?: string;
  additionalNotes?: string;
}
export interface CalEvent {
  triggerEvent?: string;
  payload?: CalPayload;
}

const SKIP = new Set(["name", "email", "location", "guests", "rescheduleReason", "attendeePhoneNumber", "notes"]);
const KNOWN: Record<string, string> = { company: "company", entreprise: "company", societe: "company", website: "website", site: "website", budget: "budget", phone: "phone", telephone: "phone", message: "message" };

const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(text).join(", ") : v && typeof v === "object" && "value" in v ? text((v as { value: unknown }).value) : "");

/** Réponses du formulaire Cal.com -> réponses Agence OS (clés connues du CRM quand c'est possible) */
function readResponses(p: CalPayload) {
  const answers: Record<string, string> = {};
  const questions: Question[] = [];
  for (const [k, r] of Object.entries(p.responses ?? {})) {
    if (!r || SKIP.has(k)) continue;
    const v = text(r.value).trim();
    if (!v) continue;
    const norm = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
    const key = KNOWN[norm] ?? k.slice(0, 40);
    answers[key] = v.slice(0, 3000);
    questions.push({ key, label: (r.label && !/_/.test(r.label) ? r.label : k).slice(0, 120), type: "text", required: false });
  }
  const notes = text(p.responses?.notes?.value) || p.additionalNotes || "";
  if (notes.trim()) {
    answers.message = notes.trim().slice(0, 3000);
    questions.push({ key: "message", label: "Message", type: "textarea", required: false });
  }
  const phone = text(p.responses?.attendeePhoneNumber?.value) || answers.phone || p.attendees?.[0]?.phoneNumber || "";
  return { answers, questions, phone: phone.slice(0, 40) };
}

function readUtm(p: CalPayload) {
  const out: Record<string, string> = {};
  for (const src of [p.tracking, p.metadata]) {
    if (!src || typeof src !== "object") continue;
    for (const k of UTM_KEYS) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim() && !out[k]) out[k] = v.trim().slice(0, 200);
    }
  }
  return out;
}

/** Membre qui reçoit le rendez-vous : organisateur (par email), sinon membre choisi dans les réglages, sinon propriétaire */
async function ownerFor(ws: string, organizerEmail: string | undefined, fallback: string | null) {
  const sb = supabaseAdmin();
  const { data: members } = await sb.from("workspace_members").select("user_id, role, profile:profiles(email)").eq("workspace_id", ws);
  const rows = (members ?? []) as unknown as { user_id: string; role: string; profile: { email: string } | null }[];
  const byMail = organizerEmail ? rows.find((m) => m.profile?.email?.toLowerCase() === organizerEmail.toLowerCase()) : null;
  return byMail?.user_id ?? (fallback && rows.some((m) => m.user_id === fallback) ? fallback : null) ?? rows.find((m) => m.role === "owner")?.user_id ?? null;
}

export async function handleCalEvent(ws: string, fallbackOwner: string | null, ev: CalEvent) {
  const sb = supabaseAdmin();
  const trigger = ev.triggerEvent ?? "";
  const p = ev.payload ?? {};
  if (trigger === "PING") return { ok: true, action: "ping" };
  const uid = p.uid ?? (p.bookingId ? String(p.bookingId) : "");
  if (!uid) throw new BookingError("Évènement Cal.com sans identifiant de réservation (uid)");

  const find = async (id: string) => (await sb.from("bookings").select("*").eq("workspace_id", ws).eq("source", "calcom").eq("external_id", id).maybeSingle()).data;

  if (trigger === "BOOKING_CANCELLED" || trigger === "BOOKING_REJECTED") {
    const b = await find(uid);
    if (!b) return { ok: true, action: "ignored" };
    if (b.status !== "confirmed") return { ok: true, action: "already" };
    await cancelBooking(b, "calcom", p.cancellationReason ?? "");
    return { ok: true, action: "cancelled", id: b.id };
  }

  if (trigger === "MEETING_ENDED") {
    const b = await find(uid);
    if (!b || b.status !== "confirmed") return { ok: true, action: "ignored" };
    await setOutcome(b, "completed", b.owner_id ?? "");
    return { ok: true, action: "completed", id: b.id };
  }

  if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_RESCHEDULED") return { ok: true, action: "ignored" };
  if (!p.startTime || !p.endTime) throw new BookingError("Évènement Cal.com sans horaires");
  const start = new Date(p.startTime).toISOString();
  const end = new Date(p.endTime).toISOString();
  const attendee = p.attendees?.[0] ?? {};
  const email = (text(p.responses?.email?.value) || attendee.email || "").trim().toLowerCase();
  const name = (text(p.responses?.name?.value) || attendee.name || email.split("@")[0] || "").trim().slice(0, 120);
  const tz = attendee.timeZone && isValidTz(attendee.timeZone) ? attendee.timeZone : "Europe/Paris";
  const hostTz = p.organizer?.timeZone && isValidTz(p.organizer.timeZone) ? p.organizer.timeZone : "Europe/Paris";
  const title = (p.eventTitle || p.type || p.title || "Rendez-vous Cal.com").slice(0, 120);
  const { answers, questions, phone } = readResponses(p);
  const meet = typeof p.metadata?.videoCallUrl === "string" ? p.metadata.videoCallUrl : /^https?:\/\//.test(p.location ?? "") ? p.location! : "";

  // Report : on déplace la réservation d'origine
  if (trigger === "BOOKING_RESCHEDULED") {
    const prev = (p.rescheduleUid && (await find(p.rescheduleUid))) || (p.fromReschedule && (await find(p.fromReschedule))) || (await find(uid));
    if (prev) {
      const { data: row } = await sb
        .from("bookings")
        .update({ external_id: uid, start_at: start, end_at: end, status: "confirmed", meet_url: meet || prev.meet_url, reschedule_count: prev.reschedule_count + 1, updated_at: new Date().toISOString() })
        .eq("id", prev.id)
        .select("*")
        .single();
      if (row?.activity_id) await sb.from("crm_activities").update({ due_at: start }).eq("id", row.activity_id);
      if (row && (row.deal_id || row.contact_id))
        await sb.from("crm_activities").insert({
          workspace_id: ws,
          deal_id: row.deal_id,
          contact_id: row.contact_id,
          company_id: row.company_id,
          kind: "note",
          done: true,
          author_id: row.owner_id,
          body: `Rendez-vous « ${title} » déplacé sur Cal.com : ${fmtWhen(start, end, hostTz).replace(/^./, (c) => c.toLowerCase())}.`,
        });
      if (row?.owner_id)
        await sb.from("notifications").insert({ workspace_id: ws, user_id: row.owner_id, kind: "booking", deal_id: row.deal_id, body: `Rendez-vous déplacé (Cal.com) : ${name}, ${fmtWhen(start, end, hostTz).replace(/^./, (c) => c.toLowerCase())}` });
      return { ok: true, action: "rescheduled", id: prev.id };
    }
  }

  const existing = await find(uid);
  if (existing) return { ok: true, action: "duplicate", id: existing.id };

  const owner = await ownerFor(ws, p.organizer?.email, fallbackOwner);
  const profile = owner ? (await sb.from("booking_profiles").select("id").eq("workspace_id", ws).eq("user_id", owner).maybeSingle()).data : null;
  const utm = readUtm(p);
  const { data: row, error } = await sb
    .from("bookings")
    .insert({
      workspace_id: ws,
      profile_id: profile?.id ?? null,
      owner_id: owner,
      source: "calcom",
      external_id: uid,
      title,
      start_at: start,
      end_at: end,
      timezone: tz,
      name,
      email,
      phone,
      company_name: answers.company ?? "",
      answers,
      location_kind: meet ? "video" : "google_meet",
      location: (p.location ?? "").slice(0, 300),
      meet_url: meet,
      utm,
    })
    .select("*")
    .single();
  if (error?.code === "23505") return { ok: true, action: "duplicate" };
  if (error || !row) throw new BookingError(`Enregistrement impossible : ${error?.message ?? "inconnu"}`, 500);

  if (email) {
    try {
      const crm = await syncCrm(row, { name: title, create_deal: true, questions }, { timezone: hostTz });
      await sb.from("bookings").update(crm).eq("id", row.id);
      row.deal_id = crm.deal_id;
    } catch (e) {
      console.error("[booking] CRM Cal.com", e instanceof Error ? e.message : e);
    }
  }
  if (owner) {
    const body = `Nouveau rendez-vous (Cal.com) : ${name}, ${title.toLowerCase()} le ${fmtWhen(start, end, hostTz).replace(/^./, (c) => c.toLowerCase())}`;
    const { error: nerr } = await sb.from("notifications").insert({ workspace_id: ws, user_id: owner, kind: "booking", deal_id: row.deal_id, body });
    if (nerr?.code === "23514") await sb.from("notifications").insert({ workspace_id: ws, user_id: owner, kind: "deal", deal_id: row.deal_id, body });
  }
  return { ok: true, action: "created", id: row.id };
}
