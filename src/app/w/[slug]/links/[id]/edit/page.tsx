import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LinkEditor } from "@/components/links/link-editor";
import { loadEditor } from "@/lib/links/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Modifier le lien" };

export default async function EditLinkPage({ params }: PageProps<"/w/[slug]/links/[id]/edit">) {
  const { slug, id } = await params;
  const { workspace } = await loadWorkspace(slug);
  const data = await loadEditor(workspace.id, id);
  if (!data.link) notFound();
  return <LinkEditor key={id} mode="edit" {...data} seedCode="" />;
}
