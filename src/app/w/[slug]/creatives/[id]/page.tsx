import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConceptPage } from "@/components/creatives/concept-page";
import { resolvePeriod } from "@/lib/ads/metrics";
import { loadConcept } from "@/lib/creatives/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Concept créatif" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ConceptRoute({ params, searchParams }: PageProps<"/w/[slug]/creatives/[id]">) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  const period = resolvePeriod(sp);
  const data = await loadConcept(workspace.id, id, period);
  if (!data) notFound();
  return <ConceptPage key={id} data={data} period={period} />;
}
