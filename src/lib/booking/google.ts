import "server-only";

import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/server";

// =====================================================================
// Google Agenda : OAuth (même client OAuth que Google Ads, GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET), disponibilités (freeBusy) et évènements avec Meet.
// Les jetons vivent dans booking_google (aucune policy : service role seul).
// Redirection à autoriser dans la console Google Cloud :
//   <NEXT_PUBLIC_APP_URL>/api/booking/google/callback
// =====================================================================

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly", // liste des agendas + freeBusy
  "https://www.googleapis.com/auth/calendar.events", // créer, déplacer, annuler les évènements
  "openid",
  "email",
];

const API = "https://www.googleapis.com/calendar/v3";

export class CalendarError extends Error {
  constructor(
    message: string,
    public revoked = false,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}

export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const calendarRedirectUri = (origin: string) => `${origin}/api/booking/google/callback`;

export function calendarAuthUrl(redirectUri: string, state: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new CalendarError("L'accès à Google Agenda a été révoqué ou a expiré : reconnecte ton agenda.", true);
    throw new CalendarError(`Google OAuth : ${json.error_description || json.error || res.status}`);
  }
  return json;
}

export async function calendarExchangeCode(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new CalendarError("Google n'a pas renvoyé de refresh token. Relance la connexion (le consentement doit être redemandé).");
  if (t.scope && !t.scope.includes("calendar.events"))
    throw new CalendarError("Autorisation incomplète : coche l'accès à Google Agenda sur l'écran de consentement.");
  let email = "";
  if (t.id_token) {
    try {
      email = (JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? "";
    } catch {
      /* email facultatif */
    }
  }
  return { access_token: t.access_token!, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), email };
}

export interface CalendarConn {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
}

export async function getConnection(workspaceId: string, userId: string): Promise<CalendarConn | null> {
  if (!googleConfigured()) return null;
  const { data } = await supabaseAdmin()
    .from("booking_google")
    .select("id, workspace_id, user_id, email, refresh_token, access_token, expires_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

/** Jeton d'accès valide (rafraîchi et enregistré si besoin) */
async function accessToken(conn: CalendarConn) {
  if (conn.access_token && conn.expires_at && new Date(conn.expires_at).getTime() > Date.now() + 60_000) return conn.access_token;
  const admin = supabaseAdmin();
  try {
    const t = await tokenRequest({ refresh_token: conn.refresh_token, grant_type: "refresh_token" });
    const expires_at = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
    await admin.from("booking_google").update({ access_token: t.access_token!, expires_at, last_error: null }).eq("id", conn.id);
    conn.access_token = t.access_token!;
    conn.expires_at = expires_at;
    return t.access_token!;
  } catch (e) {
    await admin.from("booking_google").update({ last_error: e instanceof Error ? e.message : String(e) }).eq("id", conn.id);
    throw e;
  }
}

async function call<R>(conn: CalendarConn, path: string, init: { method?: string; body?: unknown } = {}): Promise<R> {
  const token = await accessToken(conn);
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return {} as R;
  const json = (await res.json().catch(() => ({}))) as R & { error?: { message?: string; code?: number } };
  if (!res.ok) {
    // Évènement déjà supprimé côté Google : rien à faire
    if ((res.status === 404 || res.status === 410) && init.method === "DELETE") return {} as R;
    const msg = json.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new CalendarError("Accès Google Agenda expiré : reconnecte ton agenda.", true);
    if (res.status === 403) throw new CalendarError(`Google Agenda refuse l'accès : ${msg}`);
    throw new CalendarError(`Google Agenda : ${msg}`);
  }
  return json;
}

export interface CalendarItem {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string;
}

export async function listCalendars(conn: CalendarConn): Promise<CalendarItem[]> {
  const r = await call<{ items?: (CalendarItem & { summaryOverride?: string })[] }>(conn, "/users/me/calendarList?maxResults=250");
  return (r.items ?? [])
    .map((c) => ({ id: c.id, summary: c.summaryOverride || c.summary, primary: !!c.primary, accessRole: c.accessRole, backgroundColor: c.backgroundColor }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary, "fr"));
}

/** Plages occupées (ms UTC) sur les agendas choisis, par fenêtres de 60 jours */
export async function freeBusy(conn: CalendarConn, calendars: string[], from: number, to: number) {
  const ids = (calendars.length ? calendars : ["primary"]).slice(0, 20);
  const out: { start: number; end: number }[] = [];
  for (let a = from; a < to; a += 60 * 864e5) {
    const b = Math.min(to, a + 60 * 864e5);
    const r = await call<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(conn, "/freeBusy", {
      body: { timeMin: new Date(a).toISOString(), timeMax: new Date(b).toISOString(), items: ids.map((id) => ({ id })) },
    });
    for (const c of Object.values(r.calendars ?? {})) for (const x of c.busy ?? []) out.push({ start: Date.parse(x.start), end: Date.parse(x.end) });
  }
  return out;
}

export interface EventInput {
  calendarId: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  attendee: { email: string; name: string };
  location?: string;
  meet: boolean;
}

/** Crée l'évènement, invite le prospect (Google envoie l'invitation), avec lien Meet si demandé */
export async function createEvent(conn: CalendarConn, e: EventInput) {
  const body: Record<string, unknown> = {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start, timeZone: e.timeZone },
    end: { dateTime: e.end, timeZone: e.timeZone },
    attendees: [{ email: e.attendee.email, displayName: e.attendee.name }],
    location: e.location || undefined,
    guestsCanModify: false,
    reminders: { useDefault: true },
  };
  if (e.meet) body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
  const r = await call<{ id: string; hangoutLink?: string; htmlLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }>(
    conn,
    `/calendars/${encodeURIComponent(e.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    { body },
  );
  const meet = r.hangoutLink || r.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri || "";
  return { id: r.id, meet };
}

export async function moveEvent(conn: CalendarConn, calendarId: string, eventId: string, start: string, end: string, timeZone: string) {
  await call(conn, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "PATCH",
    body: { start: { dateTime: start, timeZone }, end: { dateTime: end, timeZone } },
  });
}

export async function deleteEvent(conn: CalendarConn, calendarId: string, eventId: string) {
  await call(conn, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
}

/** Révoque le jeton chez Google (déconnexion), sans bloquer en cas d'échec */
export async function revoke(refreshToken: string) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
  } catch {
    /* sans importance */
  }
}
