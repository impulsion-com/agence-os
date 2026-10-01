import type { Metadata } from "next";

import { FeatureOff, LoadError } from "@/components/portal/bits";
import { TasksView } from "@/components/portal/tasks";
import { hasFeature, resolvePortal } from "@/lib/portal/load";
import type { PortalTasks } from "@/lib/portal/types";

export const metadata: Metadata = { title: "Projet" };

export default async function PortalTasksPage({ params, searchParams }: PageProps<"/c/[slug]/tasks">) {
  const p = await resolvePortal((await params).slug, await searchParams);
  if (!p) return null;
  if (!hasFeature(p.portal, "tasks")) return <FeatureOff name="Projet" />;
  const { data, error } = await p.sb.rpc("portal_tasks", { p_company: p.portal.company_id });
  if (error || !data) return <LoadError />;
  return <TasksView data={data as unknown as PortalTasks} />;
}
