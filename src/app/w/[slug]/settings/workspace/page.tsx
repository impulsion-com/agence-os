import { WorkspaceSettings } from "@/components/workspace/settings/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Espace de travail" };

// Noms des entreprises créées par load_demo_data (voir 0003_demo_data.sql)
const DEMO_COMPANIES = ["Maison Lumen", "Vélo Nord", "Kalia Cosmetics", "FormaPro", "Atelier Brun", "Nova SaaS", "Oasis Immobilier"];

export default async function WorkspacePage({ params }: PageProps<"/w/[slug]/settings/workspace">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { count } = await sb.from("companies").select("id", { count: "exact", head: true }).eq("workspace_id", ws.workspace.id).in("name", DEMO_COMPANIES);
  return <WorkspaceSettings hasDemo={(count ?? 0) > 0} />;
}
