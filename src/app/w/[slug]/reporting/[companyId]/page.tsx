import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompanyDashboard } from "@/components/reporting/company-dashboard";
import { loadCompany } from "@/lib/ads/load";
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
  const [data, analytics] = await Promise.all([loadCompany(workspace.id, companyId, period), loadSiteAnalytics(companyId, period)]);
  if (!data.company) notFound();
  const tab = TABS.find((t) => t === sp.tab) ?? "overview";
  return <CompanyDashboard period={period} {...data} company={data.company} analytics={analytics} tab={tab} />;
}
