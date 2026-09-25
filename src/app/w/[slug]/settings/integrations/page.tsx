import type { Metadata } from "next";

import { Integrations } from "@/components/reporting/integrations";
import { appUrl, integrationStatus, redirectUri } from "@/lib/ads/config";
import type { ConnectionPublic, TrackedAccount } from "@/lib/ads/types";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Connexions publicitaires" };

export default async function IntegrationsPage({ params, searchParams }: PageProps<"/w/[slug]/settings/integrations">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const [conns, accounts] = await Promise.all([
    sb
      .from("ad_connections_public")
      .select("id, workspace_id, platform, label, expires_at, created_at, accounts, accounts_refreshed_at, last_error")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    sb
      .from("ad_accounts")
      .select("id, connection_id, company_id, platform, external_id, name, currency, login_customer_id, last_synced_at, first_synced_at, sync_error")
      .eq("workspace_id", workspace.id)
      .order("name"),
  ]);
  const st = integrationStatus();
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 400) : undefined);
  return (
    <Integrations
      status={{
        meta: st.meta,
        google: st.google,
        cron: st.cron,
        redirect: { meta: redirectUri("meta"), google: redirectUri("google") },
        cronPath: `${appUrl()}/api/cron/sync`,
      }}
      connections={(conns.data ?? []) as unknown as ConnectionPublic[]}
      accounts={(accounts.data ?? []) as TrackedAccount[]}
      notice={{ connected: str(sp.connected), accounts: str(sp.accounts), error: str(sp.error) }}
    />
  );
}
