import type { Metadata } from "next";

import { UtmSettings } from "@/components/links/utm-settings";
import { loadUtmSettings } from "@/lib/links/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Conventions UTM" };

export default async function UtmSettingsPage({ params }: PageProps<"/w/[slug]/settings/utm">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  const data = await loadUtmSettings(workspace.id);
  return <UtmSettings {...data} />;
}
