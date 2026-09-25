import { loadOpenByTeam } from "@/components/workspace/queries";
import { TeamsSettings } from "@/components/workspace/settings/teams";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Équipes" };

export default async function TeamsSettingsPage({ params }: PageProps<"/w/[slug]/settings/teams">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  return <TeamsSettings openByTeam={await loadOpenByTeam(ws)} />;
}
