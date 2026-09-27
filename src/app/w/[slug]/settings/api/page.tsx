import type { Metadata } from "next";
import { headers } from "next/headers";

import { ApiSettings, type ApiToken, type ToolGroup } from "@/components/settings-api/api-settings";
import { DOMAINS } from "@/lib/mcp/tools";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "API et MCP" };

/** État d'un jeton, calculé côté serveur au moment du rendu. */
function withState(rows: Omit<ApiToken, "state">[]): ApiToken[] {
  const now = Date.now();
  return rows.map((t) => ({ ...t, state: t.revoked_at ? "revoked" : t.expires_at && new Date(t.expires_at).getTime() <= now ? "expired" : "active" }));
}

export default async function ApiPage({ params }: PageProps<"/w/[slug]/settings/api">) {
  const { slug } = await params;
  const { workspace } = await loadWorkspace(slug);
  const sb = await supabaseServer();
  // RLS : ses propres jetons, et tous ceux de l'espace pour un admin
  const { data } = await sb
    .from("api_tokens")
    .select("id, user_id, name, prefix, scope, last_used_at, expires_at, revoked_at, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`).replace(/\/+$/, "");

  const tools: ToolGroup[] = DOMAINS.map((d) => ({ label: d.label, tools: d.tools.map((t) => ({ name: t.name, title: t.title, write: !!t.write })) }));
  return <ApiSettings tokens={withState((data ?? []) as Omit<ApiToken, "state">[])} appUrl={appUrl} tools={tools} />;
}
