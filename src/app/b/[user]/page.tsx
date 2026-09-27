import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { PublicProfile } from "@/components/booking/public-pages";
import { PublicShell } from "@/components/booking/public-shell";
import { loadPublicProfile } from "@/lib/booking/server";

export const dynamic = "force-dynamic";

const load = cache((slug: string) => loadPublicProfile(slug));

export async function generateMetadata({ params }: PageProps<"/b/[user]">): Promise<Metadata> {
  const pp = await load((await params).user);
  return {
    title: pp ? { absolute: `Prendre rendez-vous avec ${pp.host.name} · ${pp.workspace.name}` } : "Page introuvable",
    robots: { index: false, follow: false },
  };
}

export default async function BookingProfilePage({ params, searchParams }: PageProps<"/b/[user]">) {
  const { user } = await params;
  const sp = await searchParams;
  const pp = await load(user);
  if (!pp) notFound();
  const embed = sp.embed === "1";
  // Un seul type : on va directement au calendrier
  if (pp.types.length === 1) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    redirect(`/b/${pp.slug}/${pp.types[0].slug}${q.size ? `?${q}` : ""}`);
  }
  return (
    <PublicShell agency={pp.workspace.name} accent={pp.workspace.accent} embed={embed}>
      <PublicProfile
        profile={{ slug: pp.slug, name: pp.host.name, headline: pp.headline, welcome: pp.welcome, color: pp.host.color }}
        types={pp.types.map((t) => ({ slug: t.slug, name: t.name, description: t.description, duration_min: t.duration_min, location_kind: t.location_kind, color: t.color }))}
      />
    </PublicShell>
  );
}
