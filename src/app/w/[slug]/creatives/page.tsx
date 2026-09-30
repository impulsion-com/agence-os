import type { Metadata } from "next";

import { CreativeLibrary, type View } from "@/components/creatives/library";
import { resolvePeriod } from "@/lib/ads/metrics";
import { loadLibrary } from "@/lib/creatives/load";
import { loadIntel } from "@/lib/creatives/intel-load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Bibliothèque créa" };

const VIEWS: View[] = ["gallery", "table", "board", "analysis", "intel", "recos"];

export default async function CreativesPage({ params, searchParams }: PageProps<"/w/[slug]/creatives">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  const period = resolvePeriod(sp);
  const view = VIEWS.includes(sp.view as View) ? (sp.view as View) : "gallery";
  const min = Number(typeof sp.min === "string" ? sp.min : 50);
  const [data, intel] = await Promise.all([
    loadLibrary(workspace.id, period),
    view === "intel" || view === "recos" ? loadIntel(workspace.id) : Promise.resolve(null),
  ]);
  return (
    <CreativeLibrary
      data={data}
      period={period}
      view={view}
      intel={intel}
      analysis={{ company: typeof sp.company === "string" ? sp.company : null, min: Number.isFinite(min) && min >= 0 ? min : 50 }}
    />
  );
}
