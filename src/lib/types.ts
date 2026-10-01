// Types du domaine, alignés sur supabase/migrations/0001_schema.sql.

export type Role = "owner" | "admin" | "member" | "guest";
export type TaskStatus = "backlog" | "todo" | "progress" | "review" | "done";
export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type ProjectStatus = "planning" | "active" | "risk" | "hold" | "complete";
export type Billing = "one_off" | "monthly";
export type Platform = "meta" | "google";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  title: string;
  color: string;
  prefs: Prefs;
}

export interface Prefs {
  theme?: "system" | "light" | "dark";
  accent?: Accent;
  density?: "comfortable" | "compact";
  weekStart?: 0 | 1;
  home?: string;
  openTasks?: "drawer" | "page";
}

export type Accent = "indigo" | "blue" | "violet" | "teal" | "rose" | "graphite";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  accent: Accent;
  currency: string;
  // modules activés (null = tous) : voir src/lib/modules.ts
  modules: string[] | null;
  created_at: string;
}

export interface Team {
  id: string;
  workspace_id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

export interface Member {
  user_id: string;
  role: Role;
  team_id: string | null;
  title: string;
  joined_at: string;
  profile: Profile;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Company {
  id: string;
  workspace_id: string;
  name: string;
  website: string;
  industry: string;
  status: "lead" | "client" | "former";
  owner_id: string | null;
  monthly_retainer: number | null;
  color: string;
  notes: string;
  created_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  notes: string;
  created_at: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  probability: number;
  kind: "open" | "won" | "lost";
  color: string;
}

export interface Deal {
  id: string;
  workspace_id: string;
  title: string;
  company_id: string | null;
  contact_id: string | null;
  stage_id: string | null;
  owner_id: string | null;
  value: number;
  billing: Billing;
  source: string;
  services: string[];
  expected_close: string | null;
  position: number;
  lost_reason: string;
  closed_at: string | null;
  created_at: string;
}

export interface CrmActivity {
  id: string;
  deal_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  kind: "note" | "call" | "email" | "meeting" | "task";
  body: string;
  due_at: string | null;
  done: boolean;
  author_id: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  company_id: string | null;
  key: string;
  seq: number;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  icon: string;
  lead_id: string | null;
  team_id: string | null;
  platforms: string[];
  monthly_budget: number | null;
  start_date: string | null;
  due_date: string | null;
  archived_at: string | null;
  created_at: string;
  // Portail client : none = aucune tâche, selected = tâches cochées, all = toutes les tâches
  portal_mode: PortalMode;
}

export type PortalMode = "none" | "selected" | "all";
// Fonctionnalités ouvrables à un client (voir portal_all_features en base)
export type PortalFeature = "reporting" | "tasks" | "creatives" | "files" | "documents" | "onboarding" | "booking";
export type ClientReview = "pending" | "approved" | "changes";

// Personne d'un client ayant accès au portail (elle n'est pas membre de l'espace)
export interface ClientUser {
  id: string;
  user_id: string;
  company_id: string;
  // null = toutes les fonctionnalités ouvertes au niveau du portail
  features: PortalFeature[] | null;
  contact_id: string | null;
  created_at: string;
  last_seen_at: string | null;
  profile: Pick<Profile, "id" | "email" | "full_name" | "title" | "color">;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  assignee_id: string | null;
  position: number;
}

export interface Task {
  id: string;
  workspace_id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  milestone: boolean;
  recurrence: "daily" | "weekly" | "biweekly" | "monthly" | null;
  position: number;
  completed_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Cochée « visible par le client » (compte quand le projet est en mode « Tâches cochées »)
  client_visible: boolean;
  // Relations chargées avec la requête TASK_SELECT
  label_ids: string[];
  subtasks: Subtask[];
  depends_on: string[];
  comment_count: number;
  attachment_count: number;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  edited_at: string | null;
  created_at: string;
  // internal = réservé à l'équipe, client = partagé sur le portail
  visibility: "internal" | "client";
}

export interface Attachment {
  id: string;
  project_id: string | null;
  task_id: string | null;
  name: string;
  path: string;
  size: number;
  mime: string;
  uploaded_by: string | null;
  created_at: string;
  client_visible: boolean;
}

export interface ActivityItem {
  id: number;
  project_id: string | null;
  task_id: string | null;
  deal_id: string | null;
  actor_id: string | null;
  verb: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  // « portal » : destinée à un client (portal_link = chemin relatif au portail) ; « file » : fichier déposé par un client
  kind: "assigned" | "mentioned" | "commented" | "status" | "due" | "invited" | "deal" | "proposal" | "onboarding" | "booking" | "creative" | "portal" | "file";
  task_id: string | null;
  project_id: string | null;
  deal_id: string | null;
  proposal_id: string | null;
  concept_id: string | null;
  portal_link: string | null;
  body: string;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface SavedView {
  id: string;
  project_id: string | null;
  name: string;
  icon: string;
  config: ViewConfig;
}

export interface ViewConfig {
  layout?: "board" | "list" | "table" | "calendar" | "timeline";
  filters?: TaskFilters;
  sort?: SortKey;
  group?: GroupKey;
}

export interface TaskFilters {
  q?: string;
  status?: TaskStatus[];
  priority?: Priority[];
  assignee?: (string | "none")[];
  label?: string[];
  project?: string[];
  due?: "overdue" | "today" | "week" | "none";
}

export type SortKey = "manual" | "priority" | "due" | "created" | "updated" | "title";
export type GroupKey = "status" | "priority" | "assignee" | "project" | "label" | "none";

export interface Service {
  id: string;
  name: string;
  description: string;
  unit_price: number;
  billing: Billing;
  position: number;
  archived: boolean;
}

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";

export type ProposalBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "pricing" }
  | { id: string; type: "timeline"; steps: { title: string; detail: string; duration: string }[] }
  | { id: string; type: "kpis"; items: { label: string; value: string }[] };

export interface Proposal {
  id: string;
  workspace_id: string;
  number: number;
  title: string;
  company_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  status: ProposalStatus;
  blocks: ProposalBlock[];
  currency: string;
  discount_pct: number;
  tax_pct: number;
  valid_until: string | null;
  public_token: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  accepted_name: string | null;
  declined_reason: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalItem {
  id: string;
  proposal_id: string;
  service_id: string | null;
  name: string;
  description: string;
  quantity: number;
  unit_price: number;
  billing: Billing;
  optional: boolean;
  selected: boolean;
  position: number;
}

export interface AdConnection {
  id: string;
  platform: Platform;
  label: string;
  expires_at: string | null;
  created_at: string;
}

export interface AdAccount {
  id: string;
  connection_id: string | null;
  company_id: string | null;
  platform: Platform;
  external_id: string;
  name: string;
  currency: string;
  login_customer_id: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
}

export interface MetricRow {
  ad_account_id: string;
  date: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

export type KpiMetric = "spend" | "cpa" | "roas" | "ctr" | "cpc" | "conversions";

export interface Report {
  id: string;
  company_id: string;
  title: string;
  period_start: string;
  period_end: string;
  commentary: string;
  next_steps: string;
  public_token: string;
  shared: boolean;
  created_at: string;
}
