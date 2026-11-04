import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocPageView } from "@/components/docs/page-view";
import { UNTITLED } from "@/lib/docs/types";
import { loadDocPage } from "@/lib/docs/load";
import { loadWorkspace } from "@/lib/workspace/load";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/w/[slug]/docs/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  if (!UUID.test(id)) return { title: "Docs" };
  const { workspace } = await loadWorkspace(slug);
  const page = await loadDocPage(workspace.id, id);
  return { title: page ? page.title || UNTITLED : "Docs" };
}

export default async function DocPage({ params }: PageProps<"/w/[slug]/docs/[id]">) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const { workspace } = await loadWorkspace(slug);
  const page = await loadDocPage(workspace.id, id);
  if (!page) notFound();
  // Une clé par page : l'état d'édition repart de zéro en changeant de page
  return <DocPageView key={page.id} initial={page} />;
}
