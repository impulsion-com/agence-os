import type { Metadata } from "next";

import { ReportingOverview } from "@/components/reporting/overview";
import { loadOverview } from "@/lib/ads/load";
import { resolvePeriod } from "@/lib/ads/metrics";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Reporting" };

export default async function ReportingPage({ params, searchParams }: PageProps<"/w/[slug]/reporting">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  const period = resolvePeriod(sp);
  const data = await loadOverview(workspace.id, period);
  return <ReportingOverview period={period} tab={sp.tab === "reports" ? "reports" : "clients"} {...data} />;
}
