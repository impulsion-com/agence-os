import type { Metadata } from "next";

import { FeatureOff, LoadError } from "@/components/portal/bits";
import { FilesView } from "@/components/portal/files";
import { hasFeature, resolvePortal } from "@/lib/portal/load";
import type { PortalFiles } from "@/lib/portal/types";

export const metadata: Metadata = { title: "Fichiers" };

export default async function PortalFilesPage({ params, searchParams }: PageProps<"/c/[slug]/files">) {
  const p = await resolvePortal((await params).slug, await searchParams);
  if (!p) return null;
  if (!hasFeature(p.portal, "files")) return <FeatureOff name="Fichiers" />;
  const { data, error } = await p.sb.rpc("portal_files", { p_company: p.portal.company_id });
  if (error || !data) return <LoadError />;
  return <FilesView data={data as unknown as PortalFiles} />;
}
