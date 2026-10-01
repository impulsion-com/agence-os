import type { Awareness, Brief, ConceptFormat, ConceptStatus } from "./constants";
import type { ClientReview } from "@/lib/types";
import type { IntelTags } from "./intel-core";

/** Origine d'un concept créé depuis la veille ou une recommandation IA. */
export type ConceptSource =
  | { type: "competitor"; ad_id: string; archive_id: string; page_name: string; url: string }
  | { type: "recommendation"; recommendation_id: string; title: string };

export interface Concept {
  id: string;
  workspace_id: string;
  company_id: string | null;
  project_id: string | null;
  task_id: string | null;
  title: string;
  angle: string;
  hook: string;
  persona: string;
  awareness: Awareness | null;
  format: ConceptFormat;
  platforms: string[];
  status: ConceptStatus;
  brief: Brief;
  tags: string[];
  verdict: string;
  launched_at: string | null;
  owner_id: string | null;
  cover_path: string | null;
  position: number;
  is_demo: boolean;
  source: ConceptSource | null;
  ai_tags: IntelTags | null;
  // Validation par le client sur son portail : null = non envoyée
  client_review: ClientReview | null;
  client_feedback: string;
  client_reviewed_at: string | null;
  client_reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Variant {
  id: string;
  concept_id: string;
  name: string;
  hook: string;
  notes: string;
  position: number;
}

export interface Asset {
  id: string;
  concept_id: string;
  variant_id: string | null;
  name: string;
  path: string;
  size: number;
  mime: string;
  created_at: string;
}

export interface AdLink {
  id: string;
  concept_id: string;
  variant_id: string | null;
  platform: string;
  ad_id: string;
}

/** Annonce du catalogue (ad_ads) avec la plateforme et le client de son compte. */
export interface CatalogAd {
  ad_account_id: string;
  ad_id: string;
  name: string;
  campaign_name: string;
  adset_name: string;
  status: string | null;
  format: string | null;
  thumbnail_url: string | null;
  frequency_7d: number | null;
  platform: string;
  company_id: string | null;
}

/** Ligne quotidienne par annonce (RPC creative_ad_daily). */
export interface AdDay {
  ad_account_id: string;
  platform: string;
  company_id: string | null;
  date: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  video_3s: number | null;
  video_p25: number | null;
  video_p50: number | null;
  video_p75: number | null;
  video_p100: number | null;
  thruplay: number | null;
}

/** Ventes réelles attribuées par le tracking (clé = identifiant d'annonce). */
export type Attribution = Record<string, { sales: number; revenue: number }>;

export const CONCEPT_COLS =
  "id, workspace_id, company_id, project_id, task_id, title, angle, hook, persona, awareness, format, platforms, status, brief, tags, verdict, launched_at, owner_id, cover_path, position, is_demo, source, ai_tags, client_review, client_feedback, client_reviewed_at, client_reviewed_by, created_at, updated_at";
