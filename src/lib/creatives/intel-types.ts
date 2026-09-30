// Types partagés des onglets Veille et Recommandations (client et serveur).
import type { Recommendation } from "./ai-parse";
import type { CompetitorAd } from "./intel-core";

export interface Watch {
  id: string;
  company_id: string | null;
  kind: "page" | "keyword";
  page_id: string | null;
  page_name: string;
  search_terms: string;
  countries: string[];
  active_only: boolean;
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface RecommendationRow {
  id: string;
  company_id: string | null;
  model: string;
  output: Recommendation;
  created_concepts: Record<string, string>;
  is_demo: boolean;
  created_by: string | null;
  created_at: string;
}

export interface IntelStatus {
  manual: { label: string | null; expires_at: string | null; checked_at: string | null; ok: boolean | null; error: string | null } | null;
  connection: { label: string | null; expires_at: string | null } | null;
}

export interface IntelData {
  watches: Watch[];
  ads: CompetitorAd[];
  recommendations: RecommendationRow[];
  status: IntelStatus;
  ai: { enabled: boolean; fast: string; smart: string };
}

export const watchLabel = (w: Pick<Watch, "kind" | "page_name" | "page_id" | "search_terms">) =>
  w.kind === "page" ? w.page_name || `Page ${w.page_id}` : `« ${w.search_terms} »`;
