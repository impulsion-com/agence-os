// Onboarding client par formulaire : types partagés (app, page publique, routes serveur).
// Les modèles et les formulaires envoyés stockent leurs sections en jsonb.

export type QuestionType = "short" | "long" | "single" | "multi" | "number" | "url" | "date" | "email" | "phone" | "file" | "access";

/** Champ de la fiche client ou KPI alimenté par la réponse à la fin du formulaire */
export type QuestionMap = "kpi.cpa" | "kpi.roas" | "company.website" | "company.industry";

export type AccessPlatform = "meta_bm" | "meta_ads" | "google_ads" | "ga4" | "gtm" | "cms" | "search_console" | "gbp" | "other";

export interface AccessItem {
  id: string;
  name: string;
  platform: AccessPlatform;
  /** Étapes du mini-tutoriel ; {agence}, {meta_bm_id}, {google_mcc_id} et {email_acces} sont remplacés */
  steps: string[];
  link?: string;
  /** Si renseigné, le client peut saisir un identifiant (ID du compte, numéro client…) */
  idLabel?: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  label: string;
  help?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  unit?: string;
  map?: QuestionMap;
  accept?: "images" | "docs" | "any";
  items?: AccessItem[];
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

/** done : accès donné ; skip : le client signale ne pas pouvoir le donner (non concerné, bloqué) */
export type AccessAnswer = Record<string, { done?: boolean; skip?: boolean; value?: string }>;
export type AnswerValue = string | string[] | AccessAnswer;
export type Answers = Record<string, AnswerValue | undefined>;
export type Verified = Record<string, { at: string; by: string | null }>;

export type FormStatus = "sent" | "in_progress" | "completed";

export interface FormOptions {
  project?: boolean;
  kpis?: boolean;
  company?: boolean;
}

export interface AutomationResult {
  at?: string;
  project_id?: string | null;
  project_created?: boolean;
  tasks?: number;
  kpis?: Partial<Record<"cpa" | "roas", number>>;
  company?: string[];
  errors?: string[];
}

export interface OnboardingSettings {
  workspace_id: string;
  meta_business_id: string;
  google_mcc_id: string;
  access_email: string;
  intro: string;
  auto_project: boolean;
  auto_kpis: boolean;
  auto_company: boolean;
}

export interface OnboardingTemplate {
  id: string;
  workspace_id: string;
  key: string | null;
  name: string;
  description: string;
  icon: string;
  sections: Section[];
  position: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface OnboardingForm {
  id: string;
  workspace_id: string;
  template_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  project_id: string | null;
  title: string;
  intro: string;
  sections: Section[];
  answers: Answers;
  verified: Verified;
  status: FormStatus;
  progress: number;
  token: string;
  options: FormOptions;
  automation: AutomationResult;
  sent_at: string;
  email_sent_at: string | null;
  opened_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  reminded_at: string | null;
  remind_count: number;
  is_demo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingFile {
  id: string;
  form_id: string;
  question_id: string;
  name: string;
  path: string;
  size: number;
  mime: string;
  created_at: string;
}

/** Données envoyées à la page publique /f/[token] (sans identifiants internes superflus) */
export interface PublicFormData {
  preview: boolean;
  token: string;
  title: string;
  intro: string;
  sections: Section[];
  answers: Answers;
  status: FormStatus;
  completed_at: string | null;
  files: Pick<OnboardingFile, "id" | "question_id" | "name" | "size" | "mime">[];
  agency: { name: string; accent: string; meta_business_id: string; google_mcc_id: string; access_email: string };
  company: string | null;
  contact: { first_name: string; email: string } | null;
  owner: { full_name: string; email: string } | null;
}
