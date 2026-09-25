import { MembersView } from "@/components/workspace/members";
import { loadMembersData } from "@/components/workspace/queries";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Membres et invitations" };

export default async function MembersSettings({ params }: PageProps<"/w/[slug]/settings/members">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const data = await loadMembersData(ws.workspace.id, ws.role === "owner" || ws.role === "admin");
  return (
    <div className="set-page" style={{ maxWidth: 1000 }}>
      <MembersView {...data} embedded />
    </div>
  );
}
