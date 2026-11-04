import type { Metadata } from "next";

import { DocsTrash } from "@/components/docs/trash";
import { loadDocsTrash } from "@/lib/docs/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Corbeille des docs" };

export default async function DocsTrashPage({ params }: PageProps<"/w/[slug]/docs/trash">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  return <DocsTrash items={await loadDocsTrash(workspace.id)} />;
}
