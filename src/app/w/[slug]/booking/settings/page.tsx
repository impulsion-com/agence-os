import type { Metadata } from "next";

import { BookingSettings } from "@/components/booking/booking-settings";
import { loadBookingSettings } from "@/lib/booking/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Réglages des rendez-vous" };

export default async function BookingSettingsPage({ params, searchParams }: PageProps<"/w/[slug]/booking/settings">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace, role } = await loadWorkspace(slug);
  const isAdmin = role === "owner" || role === "admin";
  const data = await loadBookingSettings(workspace.id, isAdmin, typeof sp.m === "string" ? sp.m : null);
  return <BookingSettings key={data.profile?.id ?? "none"} {...data} />;
}
