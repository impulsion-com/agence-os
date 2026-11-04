import { DocsShell } from "@/components/docs/docs-shell";
import { loadDocsTree } from "@/lib/docs/load";
import { loadWorkspace } from "@/lib/workspace/load";

export default async function DocsLayout({ children, params }: LayoutProps<"/w/[slug]/docs">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  const tree = await loadDocsTree(workspace.id);
  return <DocsShell {...tree}>{children}</DocsShell>;
}
