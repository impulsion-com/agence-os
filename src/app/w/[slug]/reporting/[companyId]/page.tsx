import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompanyDashboard } from "@/components/reporting/company-dashboard";
import { loadAdTree, loadCompany } from "@/lib/ads/load";
import { resolvePeriod } from "@/lib/ads/metrics";
import { loadSiteAnalytics } from "@/lib/analytics/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Reporting client" };

const UUID = /^[0-9a-f-]{36}$/i;
const TABS = ["overview", "ads", "site", "behavior"] as const;

export default async function CompanyReportingPage({ params, searchParams }: PageProps<"/w/[slug]/reporting/[companyId]">) {
  const { slug, companyId } = await params;
  if (!UUID.test(companyId)) notFound();
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  const period = resolvePeriod(sp);
  const tab = TABS.find((t) => t === sp.tab) ?? "overview";
  const [data, analytics, tree] = await Promise.all([
    loadCompany(workspace.id, companyId, period),
    loadSiteAnalytics(companyId, period),
    // le détail par publicité ne sert qu'à l'onglet Publicité
    tab === "ads" ? loadAdTree(workspace.id, companyId, period) : Promise.resolve(null),
  ]);
  if (!data.company) notFound();
  return <CompanyDashboard period={period} {...data} company={data.company} analytics={analytics} tab={tab} tree={tree} />;
}
