import type { Metadata } from "next";

import { BookingsView } from "@/components/booking/bookings-view";
import { loadBookings } from "@/lib/booking/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Rendez-vous" };

export default async function BookingPage({ params }: PageProps<"/w/[slug]/booking">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  const data = await loadBookings(workspace.id);
  return <BookingsView {...data} />;
}
