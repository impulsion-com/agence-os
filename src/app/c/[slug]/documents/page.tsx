import type { Metadata } from "next";

import { FeatureOff } from "@/components/portal/bits";
import { DocumentsView } from "@/components/portal/documents";
import { hasFeature, resolvePortal } from "@/lib/portal/load";
import type { PortalBooking, PortalOnboardingForm, PortalProposal } from "@/lib/portal/types";

export const metadata: Metadata = { title: "Documents" };

export default async function PortalDocumentsPage({ params, searchParams }: PageProps<"/c/[slug]/documents">) {
  const p = await resolvePortal((await params).slug, await searchParams);
  if (!p) return null;
  if (!hasFeature(p.portal, "documents", "onboarding", "booking")) return <FeatureOff name="Documents" />;
  const company = p.portal.company_id;
  // Une fonction par fonctionnalité : chacune vérifie son propre droit
  const [proposals, forms, booking] = await Promise.all([
    hasFeature(p.portal, "documents") ? p.sb.rpc("portal_documents", { p_company: company }) : null,
    hasFeature(p.portal, "onboarding") ? p.sb.rpc("portal_onboarding", { p_company: company }) : null,
    hasFeature(p.portal, "booking") ? p.sb.rpc("portal_booking", { p_company: company }) : null,
  ]);
  return (
    <DocumentsView
      proposals={(proposals?.data as unknown as PortalProposal[] | null) ?? null}
      forms={(forms?.data as unknown as PortalOnboardingForm[] | null) ?? null}
      booking={(booking?.data as unknown as PortalBooking | null) ?? null}
    />
  );
}
