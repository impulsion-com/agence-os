import "server-only";

import { supabaseServer } from "@/lib/supabase/server";

export interface Invitation {
  id: string;
  email: string;
  role: "owner" | "admin" | "member" | "guest";
  team_id: string | null;
  token: string;
  invited_by: string | null;
  created_at: string;
}

// Données de la page Membres (et de Réglages > Membres) : tâches ouvertes par
// personne et invitations en attente (visibles des seuls admins, RLS).
export async function loadMembersData(workspaceId: string, isAdmin: boolean) {
  const sb = await supabaseServer();
  const [tasks, invites] = await Promise.all([
    sb.from("tasks").select("assignee_id").eq("workspace_id", workspaceId).neq("status", "done").is("archived_at", null).not("assignee_id", "is", null),
    isAdmin
      ? sb.from("invitations").select("id, email, role, team_id, token, invited_by, created_at").eq("workspace_id", workspaceId).is("accepted_at", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Invitation[] }),
  ]);
  const openByUser: Record<string, number> = {};
  for (const t of tasks.data ?? []) if (t.assignee_id) openByUser[t.assignee_id] = (openByUser[t.assignee_id] ?? 0) + 1;
  return { openByUser, invitations: (invites.data ?? []) as Invitation[] };
}

// Tâches ouvertes par équipe : assignées à un membre de l'équipe ou dans un projet de l'équipe
export async function loadOpenByTeam(ws: { workspace: { id: string }; members: { user_id: string; team_id: string | null }[]; projects: { id: string; team_id: string | null }[] }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("tasks").select("id, assignee_id, project_id").eq("workspace_id", ws.workspace.id).neq("status", "done").is("archived_at", null);
  const teamOfUser = new Map(ws.members.map((m) => [m.user_id, m.team_id]));
  const teamOfProject = new Map(ws.projects.map((p) => [p.id, p.team_id]));
  const out: Record<string, number> = {};
  for (const t of data ?? []) {
    const teams = new Set([t.assignee_id ? teamOfUser.get(t.assignee_id) : null, teamOfProject.get(t.project_id)].filter(Boolean) as string[]);
    for (const id of teams) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}
