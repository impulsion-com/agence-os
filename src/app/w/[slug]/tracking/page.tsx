import type { Metadata } from "next";

import { SitesView } from "@/components/tracking/sites-view";
import { loadSites } from "@/lib/tracking/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Attribution" };

export default async function TrackingPage({ params }: PageProps<"/w/[slug]/tracking">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  const sites = await loadSites(workspace.id);
  return <SitesView sites={sites} />;
}
