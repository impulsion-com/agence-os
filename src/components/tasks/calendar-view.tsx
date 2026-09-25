"use client";

import type { Task } from "@/lib/types";

// À IMPLÉMENTER (module Calendrier/Timeline) : calendrier mensuel/hebdo des tâches par échéance.
export function CalendarView({ tasks }: { tasks: Task[] }) {
  return <div className="page faint">Calendrier ({tasks.length} tâches)</div>;
}
