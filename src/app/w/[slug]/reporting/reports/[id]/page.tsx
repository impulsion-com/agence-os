import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ReportEditor } from "@/components/reporting/report-editor";
import { loadReport } from "@/lib/ads/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Rapport" };

export default async function ReportPage({ params }: PageProps<"/w/[slug]/reporting/reports/[id]">) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { workspace } = await loadWorkspace(slug);
  const res = await loadReport(workspace, id);
  if (!res) notFound();
  // Lien public : URL configurée, sinon l'hôte de la requête
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return <ReportEditor key={res.data.report.id + res.data.report.period_start + res.data.report.period_end} data={res.data} publicUrl={`${origin}/r/${res.publicToken}`} />;
}
