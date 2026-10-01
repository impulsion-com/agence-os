// Formes renvoyées par les fonctions portal_* (supabase/migrations/0091_portal_rpc.sql).
// Le portail ne lit aucune table en direct : ces types sont tout ce qu'un client voit.

import type { ReportData } from "@/lib/ads/load";
import type { Totals } from "@/lib/ads/metrics";
import type { TaskStatus } from "@/lib/types";

export type PortalFeature = "reporting" | "tasks" | "creatives" | "files" | "documents" | "onboarding" | "booking";

export interface PortalInfo {
  company_id: string;
  company: string;
  color: string;
  welcome: string;
  enabled: boolean;
  features: PortalFeature[];
}

export interface PortalContext {
  workspace: { id: string; name: string; slug: string; accent: string; currency: string };
  // true : membre de l'espace qui prévisualise le portail (actions d'écriture désactivées)
  preview: boolean;
  user: { id: string; name: string; email: string; color: string };
  unread: number;
  portals: PortalInfo[];
}

export interface PortalPerson {
  name: string;
  client: boolean;
  mine: boolean;
  color: string;
}

// ---------- Accueil ----------
export type PortalNews =
  | { kind: "report" | "task_done" | "file" | "creative"; id: string; title: string; at: string }
  | { kind: "comment"; id: string; title: string; excerpt: string; by: string; at: string };

export interface PortalAssetRef {
  id: string;
  name: string;
  mime: string;
}

export interface PortalHome {
  company: { name: string; color: string };
  welcome: string;
  features: PortalFeature[];
  review_tasks?: { id: string; title: string; due_date: string | null; project: string | null }[];
  review_creatives?: { id: string; title: string; format: string; cover: PortalAssetRef | null }[];
  review_proposals?: { id: string; title: string; token: string; valid_until: string | null }[];
  news: PortalNews[];
  performance?: {
    start: string;
    end: string;
    accounts: number;
    cur: Totals;
    prev: Totals;
    series: { date: string; spend: number }[];
  } | null;
  last_report?: PortalReportItem | null;
  booking?: {
    slug: string | null;
    host: string | null;
    next: { title: string; start_at: string; end_at: string; location_kind: string; meet_url: string | null; manage_token: string | null } | null;
  };
  onboarding?: { id: string; title: string; status: string; progress: number; token: string }[];
}

// ---------- Performance ----------
export interface PortalReportItem {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

export interface PortalReporting extends Omit<ReportData, "report"> {
  synced_at: string | null;
  reports: PortalReportItem[];
}

// ---------- Projet ----------
export interface PortalTaskItem {
  id: string;
  project_id: string;
  ref: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  milestone: boolean;
  completed_at: string | null;
  updated_at: string;
  assignee: string | null;
  labels: { name: string; color: string }[];
  subtasks: number;
  subtasks_done: number;
  comments: number;
  files: number;
}

export interface PortalProject {
  id: string;
  name: string;
  color: string;
  icon: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
}

export interface PortalTasks {
  projects: PortalProject[];
  tasks: PortalTaskItem[];
}

export interface PortalFileRef {
  id: string;
  name: string;
  size: number;
  mime: string;
  created_at: string;
}

export interface PortalTaskDetail {
  id: string;
  ref: string;
  title: string;
  description: string;
  status: TaskStatus;
  start_date: string | null;
  due_date: string | null;
  milestone: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  project: { id: string; name: string; color: string };
  assignee: string | null;
  labels: { name: string; color: string }[];
  subtasks: { title: string; done: boolean }[];
  comments: { id: string; body: string; created_at: string; edited: boolean; author: PortalPerson }[];
  files: PortalFileRef[];
}

// ---------- Créas ----------
export type ClientReview = "pending" | "approved" | "changes";

export interface PortalCreativeItem {
  id: string;
  title: string;
  hook: string;
  angle: string;
  format: string;
  platforms: string[];
  review: ClientReview;
  feedback: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  updated_at: string;
  assets: number;
  cover: PortalAssetRef | null;
}

export interface PortalCreativeDetail extends Omit<PortalCreativeItem, "assets" | "cover" | "updated_at"> {
  script: string;
  cta: string;
  variants: { id: string; name: string; hook: string }[];
  assets: (PortalFileRef & { variant: string | null })[];
  history: { at: string; verb: string; decision: ClientReview | null; feedback: string; by: string }[];
}

// ---------- Fichiers ----------
export interface PortalFile extends PortalFileRef {
  project: string | null;
  task: { id: string; title: string } | null;
  by: PortalPerson;
}

export interface PortalFiles {
  projects: { id: string; name: string }[];
  files: PortalFile[];
}

// ---------- Documents ----------
export interface PortalProposal {
  id: string;
  number: number;
  title: string;
  status: "sent" | "viewed" | "accepted" | "declined" | "expired";
  sent_at: string | null;
  valid_until: string | null;
  accepted_at: string | null;
  token: string;
  expired: boolean;
  signed_at: string | null;
  countersign_required: boolean;
  countersigned_at: string | null;
}

export interface PortalOnboardingForm {
  id: string;
  title: string;
  status: "sent" | "in_progress" | "completed";
  progress: number;
  token: string;
  sent_at: string | null;
  completed_at: string | null;
}

export interface PortalBooking {
  host: { slug: string; name: string; headline: string } | null;
  types: { slug: string; name: string; description: string; duration_min: number; location_kind: string }[];
  upcoming: {
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    location_kind: string;
    meet_url: string | null;
    location: string | null;
    host: string | null;
    manage_token: string | null;
  }[];
}

// ---------- Notifications (table notifications, policy « notifs perso ») ----------
export interface PortalNotification {
  id: string;
  kind: string;
  body: string;
  read_at: string | null;
  created_at: string;
  // chemin relatif au portail (tasks?task=<id>, creatives?c=<id>, performance?report=<id>, files…) ; absent sur d'anciennes lignes
  portal_link?: string | null;
  task_id?: string | null;
}
