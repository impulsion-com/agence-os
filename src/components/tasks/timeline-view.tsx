"use client";

import type { Task } from "@/lib/types";

export type TimelineGroup = "project" | "status" | "assignee" | "none";

// À IMPLÉMENTER (module Calendrier/Timeline) : Gantt avec dépendances et jalons.
export function TimelineView({ tasks }: { tasks: Task[]; group?: TimelineGroup }) {
  return <div className="page faint">Timeline ({tasks.length} tâches)</div>;
}
