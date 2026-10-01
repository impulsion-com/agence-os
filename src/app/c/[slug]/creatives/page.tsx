import type { Metadata } from "next";

import { FeatureOff, LoadError } from "@/components/portal/bits";
import { CreativesView } from "@/components/portal/creatives";
import { hasFeature, resolvePortal } from "@/lib/portal/load";
import type { PortalCreativeItem } from "@/lib/portal/types";

export const metadata: Metadata = { title: "Créas" };

export default async function PortalCreativesPage({ params, searchParams }: PageProps<"/c/[slug]/creatives">) {
  const p = await resolvePortal((await params).slug, await searchParams);
  if (!p) return null;
  if (!hasFeature(p.portal, "creatives")) return <FeatureOff name="Créas" />;
  const { data, error } = await p.sb.rpc("portal_creatives", { p_company: p.portal.company_id });
  if (error || !data) return <LoadError />;
  return <CreativesView items={data as unknown as PortalCreativeItem[]} />;
}
