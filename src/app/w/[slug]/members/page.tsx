import { MembersView } from "@/components/workspace/members";
import { loadMembersData } from "@/components/workspace/queries";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Membres" };

export default async function Members({ params }: PageProps<"/w/[slug]/members">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const data = await loadMembersData(ws.workspace.id, ws.role === "owner" || ws.role === "admin");
  return (
    <div className="page">
      <MembersView {...data} />
    </div>
  );
}
