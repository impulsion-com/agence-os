import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Installation } from "@/components/setup/installation";
import { appUrl } from "@/lib/ads/config";
import { currentEdition } from "@/lib/edition";
import { readModules } from "@/lib/modules";
import { SCHEMA_VERSION, cronStatus, schemaVersion } from "@/lib/setup/checks";
import { itemsFor } from "@/lib/setup/items";
import { requestOrigin } from "@/lib/setup/origin";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Installation" };

export default async function InstallationPage({ params }: PageProps<"/w/[slug]/settings/installation">) {
  const { slug } = await params;
  const { workspace, role } = await loadWorkspace(slug);
  if (role !== "owner" && role !== "admin") redirect(`/w/${slug}/settings/profile`);
  const origin = requestOrigin(await headers(), appUrl());
  const items = itemsFor(readModules(workspace.modules));
  const [version, jobs] = await Promise.all([schemaVersion(), cronStatus()]);
  // Présence des variables seulement (jamais leur valeur) : le test réel se fait au clic
  const envSet = Object.fromEntries(items.flatMap((i) => i.env).map((k) => [k, !!process.env[k]?.trim()]));
  return (
    <Installation
      items={items.map((i) => i.id)}
      envSet={envSet}
      schema={{ db: version, code: SCHEMA_VERSION }}
      jobs={jobs}
      ctx={{ appUrl: (process.env.NEXT_PUBLIC_APP_URL?.trim() || origin).replace(/\/$/, ""), host: process.env.VERCEL ? "vercel" : "autre", agency: workspace.name }}
      edition={currentEdition().name}
    />
  );
}
