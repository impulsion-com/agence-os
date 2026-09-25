// Types et sélections « légères » partagés par les pages transverses
// (accueil, vue d'ensemble, membres, équipes). On ne charge que les colonnes
// utiles aux tableaux de bord, sans les relations de TASK_SELECT.
import type { Priority, TaskStatus } from "@/lib/types";

export const LITE_TASK_SELECT =
  "id, title, number, status, priority, assignee_id, due_date, start_date, project_id, completed_at, milestone, created_at, updated_at";

export interface LiteTask {
  id: string;
  title: string;
  number: number;
  status: TaskStatus;
  priority: Priority;
  assignee_id: string | null;
  due_date: string | null;
  start_date: string | null;
  project_id: string;
  completed_at: string | null;
  milestone: boolean;
  created_at: string;
  updated_at: string;
}

// Ligne d'activité avec les objets liés (titre de tâche, deal)
export const ACTIVITY_SELECT =
  "id, verb, meta, created_at, actor_id, project_id, task_id, deal_id, task:tasks(id, title, number, project_id), deal:deals(id, title)";

export interface ActivityRow {
  id: number;
  verb: string;
  meta: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
  project_id: string | null;
  task_id: string | null;
  deal_id: string | null;
  task: { id: string; title: string; number: number; project_id: string } | null;
  deal: { id: string; title: string } | null;
}
