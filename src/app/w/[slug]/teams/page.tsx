import { loadOpenByTeam } from "@/components/workspace/queries";
import { TeamsView } from "@/components/workspace/teams";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Équipes" };

export default async function Teams({ params }: PageProps<"/w/[slug]/teams">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  return <TeamsView openByTeam={await loadOpenByTeam(ws)} />;
}
