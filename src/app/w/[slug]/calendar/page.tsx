import type { Metadata } from "next";

import { PlanningPage } from "@/components/tasks/calendar-planning";
import { loadPlanningTasks } from "@/components/tasks/calendar-load";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Calendrier" };

export default async function CalendarPage({ params }: PageProps<"/w/[slug]/calendar">) {
  const { slug } = await params;
  const data = await loadWorkspace(slug);
  const tasks = await loadPlanningTasks(data);
  return <PlanningPage tasks={tasks} view="calendar" />;
}
