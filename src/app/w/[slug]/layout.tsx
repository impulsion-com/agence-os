import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceProvider } from "@/lib/workspace/context";
import { loadWorkspace } from "@/lib/workspace/load";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const data = await loadWorkspace(slug);
  return (
    <WorkspaceProvider data={data}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
