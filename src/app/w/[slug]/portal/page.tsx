import { PortalOverview, type PortalOverviewData } from "@/components/portal-admin/portal-overview";
import { taskVisibleToClient } from "@/lib/portal-admin/features";
import { supabaseServer } from "@/lib/supabase/server";
import type { ClientReview, PortalFeature } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Portail client" };

// Vue d'ensemble des portails : qui a accès, ce qui attend le client, ce que le client a demandé.
export default async function PortalPage({ params }: PageProps<"/w/[slug]/portal">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const wid = ws.workspace.id;
  const shared = ws.projects.filter((p) => p.company_id && !p.archived_at && p.portal_mode !== "none");
  const allIds = shared.filter((p) => p.portal_mode === "all").map((p) => p.id);
  const pickIds = shared.filter((p) => p.portal_mode === "selected").map((p) => p.id);
  const cols = "id, title, number, status, project_id, client_visible, archived_at, updated_at";
  const none = Promise.resolve({ data: [] as never[] });

  const [portals, invites, tasksAll, tasksPicked, concepts, files, reports] = await Promise.all([
    sb.from("client_portals").select("company_id, enabled, features").eq("workspace_id", wid),
    // lisibles par les membres non invités seulement (RLS)
    sb.from("client_invitations").select("company_id").eq("workspace_id", wid).is("accepted_at", null).is("revoked_at", null),
    allIds.length ? sb.from("tasks").select(cols).in("project_id", allIds).is("archived_at", null) : none,
    pickIds.length ? sb.from("tasks").select(cols).in("project_id", pickIds).eq("client_visible", true).is("archived_at", null) : none,
    sb.from("creative_concepts").select("id, title, company_id, client_review, client_feedback, client_reviewed_at, client_reviewed_by, updated_at").eq("workspace_id", wid).not("client_review", "is", null),
    sb.from("attachments").select("project_id").eq("workspace_id", wid).eq("client_visible", true),
    sb.from("reports").select("company_id").eq("workspace_id", wid).eq("shared", true),
  ]);

  const projectOf = new Map(ws.projects.map((p) => [p.id, p]));
  const tasks = [...(tasksAll.data ?? []), ...(tasksPicked.data ?? [])].filter((t) => taskVisibleToClient(t, projectOf.get(t.project_id)));
  const count = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const k = key(r);
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };

  const data: PortalOverviewData = {
    portals: (portals.data ?? []).map((p) => ({ company_id: p.company_id, enabled: p.enabled, features: p.features as PortalFeature[] })),
    invites: count(invites.data ?? [], (i) => i.company_id),
    visibleTasks: count(tasks, (t) => projectOf.get(t.project_id)?.company_id),
    reviewTasks: tasks
      .filter((t) => t.status === "review")
      .map((t) => ({ id: t.id, title: t.title, number: t.number, project_id: t.project_id, company_id: projectOf.get(t.project_id)!.company_id!, updated_at: t.updated_at })),
    concepts: (concepts.data ?? [])
      .filter((c) => c.company_id)
      .map((c) => ({
        id: c.id, title: c.title, company_id: c.company_id!, review: c.client_review as ClientReview, feedback: c.client_feedback,
        reviewed_at: c.client_reviewed_at, reviewed_by: c.client_reviewed_by, updated_at: c.updated_at,
      })),
    files: count(files.data ?? [], (f) => {
      const p = f.project_id ? projectOf.get(f.project_id) : undefined;
      return p && !p.archived_at && p.portal_mode !== "none" ? p.company_id : null;
    }),
    reports: count(reports.data ?? [], (r) => r.company_id),
  };
  return <PortalOverview data={data} />;
}
