import { LoadError } from "@/components/portal/bits";
import { HomeView } from "@/components/portal/home";
import { resolvePortal } from "@/lib/portal/load";
import type { PortalHome } from "@/lib/portal/types";

export default async function PortalHomePage({ params, searchParams }: PageProps<"/c/[slug]">) {
  const p = await resolvePortal((await params).slug, await searchParams);
  if (!p) return null;
  const { data, error } = await p.sb.rpc("portal_home", { p_company: p.portal.company_id });
  if (error || !data) return <LoadError />;
  return <HomeView data={data as unknown as PortalHome} />;
}
