import type { Metadata } from "next";

import { FeatureOff, LoadError } from "@/components/portal/bits";
import { PerformanceView, ReportReader } from "@/components/portal/performance";
import type { ReportData } from "@/lib/ads/load";
import { resolvePeriod } from "@/lib/ads/metrics";
import { hasFeature, resolvePortal } from "@/lib/portal/load";
import { UUID } from "@/lib/portal/nav";
import type { PortalReporting } from "@/lib/portal/types";

export const metadata: Metadata = { title: "Performance" };

export default async function PortalPerformancePage({ params, searchParams }: PageProps<"/c/[slug]/performance">) {
  const sp = await searchParams;
  const p = await resolvePortal((await params).slug, sp);
  if (!p) return null;
  if (!hasFeature(p.portal, "reporting")) return <FeatureOff name="Performance" />;
  const company = p.portal.company_id;

  // Lecture d'un rapport publié : ?report=<id>
  if (typeof sp.report === "string") {
    const { data } = UUID.test(sp.report) ? await p.sb.rpc("portal_report", { p_company: company, p_report: sp.report }) : { data: null };
    if (!data) return <LoadError />;
    return <ReportReader data={data as unknown as ReportData} />;
  }

  const period = resolvePeriod(sp);
  const { data, error } = await p.sb.rpc("portal_reporting", { p_company: company, p_start: period.start, p_end: period.end, p_prev_start: period.prevStart });
  if (error || !data) return <LoadError />;
  return <PerformanceView data={data as unknown as PortalReporting} period={period} />;
}
