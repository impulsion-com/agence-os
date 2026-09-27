import "server-only";

import { appUrl } from "@/lib/ads/config";
import { emailEnabled } from "@/lib/email";
import { supabaseServer } from "@/lib/supabase/server";
import { googleConfigured } from "./google";
import type { Booking, BookingOverride, BookingProfile, BookingType } from "./shared";

// Chargement des pages de l'app (droits de l'utilisateur, RLS appliquée).

export type BookingRow = Omit<Booking, "token"> & { token: string };

export async function loadBookings(workspaceId: string) {
  const sb = await supabaseServer();
  const { data: mine } = await sb.rpc("booking_my_profile", { ws: workspaceId });
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const [bookings, profiles, types, sites] = await Promise.all([
    sb.from("bookings").select("*").eq("workspace_id", workspaceId).gte("start_at", since).order("start_at").limit(1000),
    sb.from("booking_profiles").select("*").eq("workspace_id", workspaceId),
    sb.from("booking_types").select("id, profile_id, slug, name, color, duration_min, active, position").eq("workspace_id", workspaceId).order("position"),
    sb.from("tracking_sites").select("id").eq("workspace_id", workspaceId).is("company_id", null).limit(1),
  ]);
  return {
    myProfileId: (mine as string | null) ?? null,
    bookings: (bookings.data ?? []) as BookingRow[],
    profiles: (profiles.data ?? []) as BookingProfile[],
    types: (types.data ?? []) as Pick<BookingType, "id" | "profile_id" | "slug" | "name" | "color" | "duration_min" | "active" | "position">[],
    appUrl: appUrl(),
    tracking: !!sites.data?.length,
  };
}

export async function loadBookingSettings(workspaceId: string, isAdmin: boolean, memberId?: string | null) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: mine } = await sb.rpc("booking_my_profile", { ws: workspaceId });
  const { data: profiles } = await sb.from("booking_profiles").select("*").eq("workspace_id", workspaceId);
  const all = (profiles ?? []) as BookingProfile[];
  // Un admin peut régler la page d'un autre membre (?m=<user_id>)
  const profile = (isAdmin && memberId ? all.find((p) => p.user_id === memberId) : null) ?? all.find((p) => p.id === mine) ?? null;

  let settings: { calcom_secret: string; calcom_user_id: string | null; calcom_last_at: string | null } | null = null;
  if (isAdmin) {
    await sb.from("booking_settings").upsert({ workspace_id: workspaceId }, { onConflict: "workspace_id", ignoreDuplicates: true });
    const { data } = await sb.from("booking_settings").select("calcom_secret, calcom_user_id, calcom_last_at").eq("workspace_id", workspaceId).maybeSingle();
    settings = data;
  }

  const [types, overrides, google, calcomCount] = await Promise.all([
    profile ? sb.from("booking_types").select("*").eq("profile_id", profile.id).order("position").order("created_at") : Promise.resolve({ data: [] }),
    profile
      ? sb.from("booking_overrides").select("*").eq("profile_id", profile.id).gte("day_end", new Date().toISOString().slice(0, 10)).order("day_start")
      : Promise.resolve({ data: [] }),
    profile ? sb.from("booking_google_public").select("email, last_error, created_at, user_id").eq("workspace_id", workspaceId).eq("user_id", profile.user_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("bookings").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("source", "calcom"),
  ]);

  return {
    profile,
    profiles: all,
    isSelf: !!profile && profile.user_id === auth.user?.id,
    types: (types.data ?? []) as BookingType[],
    overrides: (overrides.data ?? []) as BookingOverride[],
    google: google.data as { email: string | null; last_error: string | null; created_at: string | null } | null,
    googleConfigured: googleConfigured(),
    settings,
    calcomCount: calcomCount.count ?? 0,
    emailOn: emailEnabled(),
    appUrl: appUrl(),
  };
}
