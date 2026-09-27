import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicManage } from "@/components/booking/public-pages";
import { PublicShell } from "@/components/booking/public-shell";
import { bookingByToken } from "@/lib/booking/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Votre rendez-vous", robots: { index: false, follow: false } };

export default async function ManageBookingPage({ params }: PageProps<"/b/r/[token]">) {
  const { token } = await params;
  const b = await bookingByToken(token);
  if (!b || b.source !== "native") notFound();
  const sb = supabaseAdmin();
  const [ws, prof, type, host] = await Promise.all([
    sb.from("workspaces").select("name, accent").eq("id", b.workspace_id).maybeSingle(),
    b.profile_id ? sb.from("booking_profiles").select("slug, display_name, active").eq("id", b.profile_id).maybeSingle() : Promise.resolve({ data: null }),
    b.type_id ? sb.from("booking_types").select("slug, name, active").eq("id", b.type_id).maybeSingle() : Promise.resolve({ data: null }),
    b.owner_id ? sb.from("profiles").select("full_name").eq("id", b.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!ws.data) notFound();
  const bookable = !!(prof.data?.active && type.data?.active);
  const typeHref = bookable ? `/b/${prof.data!.slug}/${type.data!.slug}` : null;
  return (
    <PublicShell agency={ws.data.name} accent={ws.data.accent} embed={false}>
      <PublicManage
        d={{
          token: b.token,
          status: b.status,
          start: b.start_at,
          end: b.end_at,
          tz: b.timezone,
          name: b.name,
          typeName: type.data?.name ?? b.title,
          host: prof.data?.display_name || host.data?.full_name || ws.data.name,
          locationKind: b.location_kind,
          location: b.location_kind === "phone" ? b.phone : b.location_kind === "address" ? b.location : "",
          meet: b.meet_url || (b.location_kind === "video" ? b.location : ""),
          rescheduleHref: typeHref ? `${typeHref}?reschedule=${b.token}` : null,
          bookAgainHref: typeHref,
          cancelReason: b.cancel_reason,
        }}
      />
    </PublicShell>
  );
}
