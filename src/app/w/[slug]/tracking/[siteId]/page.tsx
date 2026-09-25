import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SiteDashboard, type Tab } from "@/components/tracking/site-dashboard";
import { resolvePeriod } from "@/lib/ads/metrics";
import { addDays, today } from "@/lib/format";
import { MODEL_IDS, WINDOWS, type ModelId } from "@/lib/tracking/attribution";
import { loadOverview, loadPeople, loadSecret, loadSites, type Goal } from "@/lib/tracking/load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Attribution" };

const UUID = /^[0-9a-f-]{36}$/i;
const TABS: Tab[] = ["overview", "journeys", "people", "install", "api"];
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** URL publique de l'application (snippet d'installation, exemples d'API). */
async function appUrl() {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

export default async function TrackingSitePage({ params, searchParams }: PageProps<"/w/[slug]/tracking/[siteId]">) {
  const { slug, siteId } = await params;
  if (!UUID.test(siteId)) notFound();
  const sp = await searchParams;
  const { workspace, role } = await loadWorkspace(slug);
  const sites = await loadSites(workspace.id);
  const site = sites.find((s) => s.id === siteId);
  if (!site) notFound();

  const tab = (TABS.find((t) => t === one(sp.tab)) ?? "overview") as Tab;
  // Les périodes glissantes incluent aujourd'hui : le tracking est en temps réel
  // (le reporting s'arrête à hier, journée publicitaire incomplète).
  const rolling = ["7d", "30d", "90d", undefined].includes(one(sp.period));
  const period = resolvePeriod(sp, rolling ? addDays(today(), 1) : today());
  const m = one(sp.model);
  const model: ModelId = m && MODEL_IDS.includes(m as ModelId) ? (m as ModelId) : site.settings.model;
  const w = Number(one(sp.window));
  const window = WINDOWS.includes(w) ? w : site.settings.window_days;
  const goal: Goal = one(sp.goal) === "leads" ? "leads" : "sales";
  const q = (one(sp.q) ?? "").trim();

  const [overview, people, secret, url] = await Promise.all([
    tab === "overview" || tab === "journeys" ? loadOverview(site, workspace.id, period, { model, window, goal }) : null,
    tab === "people" ? loadPeople(site.id, q) : null,
    tab === "api" && role !== "guest" ? loadSecret(site.id) : null,
    appUrl(),
  ]);

  return (
    <SiteDashboard
      site={site}
      sites={sites}
      tab={tab}
      period={period}
      model={model}
      window={window}
      goal={goal}
      overview={overview}
      people={people}
      q={q}
      secret={secret}
      appUrl={url}
    />
  );
}
