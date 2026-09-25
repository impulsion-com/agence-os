import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import type { Company, Label, Member, Profile, Project, Role, Team, Workspace } from "@/lib/types";

export interface WorkspaceData {
  workspace: Workspace;
  me: Profile;
  role: Role;
  members: Member[];
  teams: Team[];
  labels: Label[];
  projects: Project[];
  companies: Pick<Company, "id" | "name" | "color" | "status">[];
  favorites: string[];
  unread: number;
  myOpen: number;
  workspaces: Pick<Workspace, "id" | "name" | "slug">[];
}

// Chargé une fois par requête (layout + pages partagent le résultat).
export const loadWorkspace = cache(async (slug: string): Promise<WorkspaceData> => {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect(`/login?next=/w/${slug}`);
  const uid = auth.user.id;

  const { data: workspace } = await sb.from("workspaces").select("*").eq("slug", slug).maybeSingle();
  if (!workspace) notFound();

  const [me, members, teams, labels, projects, companies, favorites, unread, myOpen, mine] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).single(),
    sb.from("workspace_members").select("user_id, role, team_id, title, joined_at, profile:profiles(*)").eq("workspace_id", workspace.id),
    sb.from("teams").select("*").eq("workspace_id", workspace.id).order("name"),
    sb.from("labels").select("id, name, color").eq("workspace_id", workspace.id).order("name"),
    sb.from("projects").select("*").eq("workspace_id", workspace.id).order("created_at"),
    sb.from("companies").select("id, name, color, status").eq("workspace_id", workspace.id).order("name"),
    sb.from("project_favorites").select("project_id").eq("user_id", uid).order("position"),
    sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("workspace_id", workspace.id).is("read_at", null).is("archived_at", null),
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("assignee_id", uid).neq("status", "done").is("archived_at", null),
    sb.from("workspace_members").select("workspace:workspaces(id, name, slug)").eq("user_id", uid),
  ]);

  const memberRows = (members.data ?? []) as unknown as Member[];
  const role = memberRows.find((m) => m.user_id === uid)?.role;
  if (!role) notFound();

  return {
    workspace: workspace as Workspace,
    me: me.data as Profile,
    role,
    members: memberRows.sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name, "fr")),
    teams: (teams.data ?? []) as Team[],
    labels: (labels.data ?? []) as Label[],
    projects: (projects.data ?? []) as Project[],
    companies: (companies.data ?? []) as WorkspaceData["companies"],
    favorites: (favorites.data ?? []).map((f) => f.project_id),
    unread: unread.count ?? 0,
    myOpen: myOpen.count ?? 0,
    workspaces: (mine.data ?? []).map((m) => m.workspace as unknown as Pick<Workspace, "id" | "name" | "slug">).filter(Boolean),
  };
});
