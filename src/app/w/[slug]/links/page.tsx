import type { Metadata } from "next";

import { LinksView } from "@/components/links/links-view";
import { loadLinks } from "@/lib/links/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Liens trackés" };

export default async function LinksPage({ params }: PageProps<"/w/[slug]/links">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  const data = await loadLinks(workspace.id);
  return <LinksView {...data} />;
}
