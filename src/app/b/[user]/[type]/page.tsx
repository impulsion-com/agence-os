import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";

import { PublicBooker } from "@/components/booking/public-booker";
import { PublicShell } from "@/components/booking/public-shell";
import { loadPublicProfile, reschedulable } from "@/lib/booking/server";
import { readQuestions } from "@/lib/booking/shared";
import { emailEnabled } from "@/lib/email";

export const dynamic = "force-dynamic";

const load = cache((slug: string) => loadPublicProfile(slug));

export async function generateMetadata({ params }: PageProps<"/b/[user]/[type]">): Promise<Metadata> {
  const { user, type } = await params;
  const pp = await load(user);
  const t = pp?.types.find((x) => x.slug === type);
  return {
    title: pp && t ? { absolute: `${t.name} avec ${pp.host.name} · ${pp.workspace.name}` } : "Page introuvable",
    description: t?.description || undefined,
    robots: { index: false, follow: false },
  };
}

export default async function BookingTypePage({ params, searchParams }: PageProps<"/b/[user]/[type]">) {
  const { user, type } = await params;
  const sp = await searchParams;
  const pp = await load(user);
  const t = pp?.types.find((x) => x.slug === type);
  if (!pp || !t) notFound();

  // Report : le jeton doit désigner un rendez-vous à venir de ce membre
  let reschedule = null;
  if (typeof sp.reschedule === "string") {
    const b = await reschedulable(sp.reschedule, pp.id);
    if (b) reschedule = { token: b.token, start: b.start_at, end: b.end_at, name: b.name, email: b.email };
  }

  return (
    <PublicShell agency={pp.workspace.name} accent={pp.workspace.accent} embed={sp.embed === "1"}>
      <PublicBooker
        profile={{ slug: pp.slug, name: pp.host.name, headline: pp.headline, color: pp.host.color, timezone: pp.timezone }}
        type={{
          slug: t.slug,
          name: t.name,
          description: t.description,
          duration_min: t.duration_min,
          location_kind: t.location_kind,
          location_value: t.location_kind === "address" ? t.location_value : "",
          questions: readQuestions(t.questions),
          color: t.color,
        }}
        emailOn={emailEnabled()}
        reschedule={reschedule}
        backHref={pp.types.length > 1 && !reschedule ? `/b/${pp.slug}${sp.embed === "1" ? "?embed=1" : ""}` : null}
      />
    </PublicShell>
  );
}
