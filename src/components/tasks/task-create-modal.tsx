"use client";

import { Modal } from "@/components/ui/overlay";
import type { Priority, TaskStatus } from "@/lib/types";

export interface TaskDefaults {
  project_id?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignee_id?: string | null;
  due_date?: string | null;
  label_ids?: string[];
}

// À IMPLÉMENTER (module Tâches)
export function TaskCreateModal({ onClose }: { defaults?: TaskDefaults; onClose: () => void }) {
  return <Modal title="Nouvelle tâche" onClose={onClose}>…</Modal>;
}
