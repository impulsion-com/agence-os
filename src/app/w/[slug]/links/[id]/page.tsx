import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LinkStatsView } from "@/components/links/link-stats";
import { resolvePeriod } from "@/lib/ads/metrics";
import { addDays, today } from "@/lib/format";
import { loadLinkStats } from "@/lib/links/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Statistiques du lien" };

export default async function LinkPage({ params, searchParams }: PageProps<"/w/[slug]/links/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Les clics du jour comptent : la période glissante se termine aujourd'hui
  const rolling = !sp.period || sp.period === "7d" || sp.period === "30d" || sp.period === "90d";
  const period = resolvePeriod(sp, rolling ? addDays(today(), 1) : undefined);
  const data = await loadLinkStats(workspace.id, id, period);
  if (!data) notFound();
  return <LinkStatsView period={period} {...data} />;
}
