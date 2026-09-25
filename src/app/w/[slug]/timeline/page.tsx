import type { Metadata } from "next";

import { PlanningPage } from "@/components/tasks/calendar-planning";
import { loadPlanningTasks } from "@/components/tasks/calendar-load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Timeline" };

export default async function TimelinePage({ params }: PageProps<"/w/[slug]/timeline">) {
  const { slug } = await params;
  const data = await loadWorkspace(slug);
  const tasks = await loadPlanningTasks(data);
  return <PlanningPage tasks={tasks} view="timeline" />;
}
