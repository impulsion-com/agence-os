import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BriefDoc } from "@/components/creatives/brief-doc";
import { loadBrief } from "@/lib/creatives/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Brief créateur" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function BriefRoute({ params }: PageProps<"/w/[slug]/creatives/[id]/brief">) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const { workspace } = await loadWorkspace(slug);
  const data = await loadBrief(workspace.id, id);
  if (!data) notFound();
  return <BriefDoc {...data} />;
}
