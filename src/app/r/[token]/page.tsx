import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PublicReport } from "@/components/reporting/public-report";
import type { ReportData } from "@/lib/ads/load";
import { supabaseAnon } from "@/lib/supabase/server";

const load = cache(async (token: string) => {
  if (!/^[0-9a-f]{16,64}$/i.test(token)) return null;
  const { data, error } = await supabaseAnon().rpc("public_report", { p_token: token });
  if (error || !data) return null;
  return data as unknown as ReportData;
});

export async function generateMetadata({ params }: PageProps<"/r/[token]">): Promise<Metadata> {
  const data = await load((await params).token);
  return {
    title: data ? { absolute: `${data.report.title} · ${data.workspace.name}` } : "Rapport introuvable",
    robots: { index: false, follow: false },
  };
}

export default async function PublicReportPage({ params }: PageProps<"/r/[token]">) {
  const data = await load((await params).token);
  if (!data) notFound();
  return <PublicReport data={data} />;
}
