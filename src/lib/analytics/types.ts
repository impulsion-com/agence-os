// Types partagés de l'analytics de site (GA4 et Clarity), client et serveur.

export type AnalyticsKind = "ga4" | "clarity";

/** Propriété GA4 ou projet Clarity associé à un client (table analytics_sources). */
export interface AnalyticsSource {
  id: string;
  workspace_id: string;
  company_id: string | null;
  kind: AnalyticsKind;
  connection_id: string | null;
  external_id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  settings: { key_event?: string | null; token_exp?: string | null };
  first_synced_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  is_demo: boolean;
  created_at: string;
}

export const SOURCE_COLS =
  "id, workspace_id, company_id, kind, connection_id, external_id, name, currency, timezone, settings, first_synced_at, last_synced_at, sync_error, is_demo, created_at";

// ---------------------------------------------------------------------
// Charge utile de la fonction SQL _site_analytics (tableau de bord, rapport, portail, MCP)
// ---------------------------------------------------------------------
export interface SourceRef {
  id: string;
  name: string;
  last_synced_at: string | null;
  demo: boolean;
  // absents de la version « client »
  external_id?: string;
  sync_error?: string | null;
}

export interface Ga4Day {
  d: string;
  sessions: number;
  users: number;
  new_users: number;
  engaged: number;
  engagement_s: number;
  key_events: number;
  purchases: number;
  revenue: number;
  pageviews: number;
}

export interface Ga4Channel {
  channel: string;
  sessions: number;
  users: number;
  new_users: number;
  engaged: number;
  key_events: number;
  purchases: number;
  revenue: number;
  prev_sessions: number;
  prev_key_events: number;
  prev_revenue: number;
}

export interface Ga4SourceMedium {
  source: string;
  medium: string;
  channel: string;
  sessions: number;
  engaged: number;
  key_events: number;
  purchases: number;
  revenue: number;
  prev_sessions: number;
}

export interface Ga4Page {
  page: string;
  sessions: number;
  engaged: number;
  key_events: number;
  prev_sessions: number;
}

export interface Ga4Data {
  sources: (SourceRef & { key_event: string | null; connected?: boolean })[];
  currency: string | null;
  synced_at: string | null;
  daily: Ga4Day[];
  channels: Ga4Channel[];
  sources_medium: Ga4SourceMedium[];
  pages: Ga4Page[];
  devices: { device: string; sessions: number; users: number; engaged: number; key_events: number; revenue: number }[];
  countries: { country: string; sessions: number; key_events: number; revenue: number }[];
}

/** Signaux de friction Clarity : occurrences et sessions concernées. */
export interface Friction {
  dead_clicks: number;
  dead_sessions: number;
  rage_clicks: number;
  rage_sessions: number;
  quickbacks: number;
  quickback_sessions: number;
  excessive_scrolls: number;
  excessive_sessions: number;
  script_errors: number;
  script_error_sessions: number;
  error_clicks: number;
  error_click_sessions: number;
}

export interface ClarityDay extends Friction {
  d: string;
  sessions: number;
  users: number;
  scroll_depth: number | null;
  active_time: number | null;
  total_time: number | null;
  pages_per_session: number | null;
  window_days: number;
}

export interface ClarityDevice extends Friction {
  device: string;
  sessions: number;
  users: number;
  scroll_depth: number | null;
  active_time: number | null;
}

export interface ClarityPage extends Friction {
  url: string;
  device: string;
  sessions: number;
  scroll_depth: number | null;
  active_time: number | null;
}

export interface ClarityChannel {
  channel: string;
  sessions: number;
  dead_sessions: number;
  rage_sessions: number;
  quickback_sessions: number;
  script_error_sessions: number;
  scroll_depth: number | null;
  active_time: number | null;
}

export interface ClarityData {
  sources: (SourceRef & { first_synced_at: string | null })[];
  first_day: string | null;
  last_day: string | null;
  synced_at: string | null;
  daily: ClarityDay[];
  devices: ClarityDevice[];
  pages: ClarityPage[];
  channels: ClarityChannel[];
}

export interface SiteAnalytics {
  period: { start: string; end: string; prev_start: string; prev_end: string };
  ga4: Ga4Data | null;
  clarity: ClarityData | null;
  /** Tracking first-party d'Agence OS (agence seulement) : ventes, chiffre d'affaires et prospects mesurés sur le site. */
  first_party: { purchases: number; revenue: number; leads: number } | null;
}

/** Résultat de synchro d'une source (même forme que SyncResult des comptes publicitaires). */
export interface AnalyticsSyncResult {
  account_id: string;
  name: string;
  kind: AnalyticsKind;
  ok: boolean;
  rows?: number;
  error?: string;
  /** Synchro non lancée (Clarity déjà à jour : une requête de plus n'apporterait rien) */
  skipped?: string;
  /** Nature de l'erreur (token, quota, network…) quand la source la précise */
  code?: string;
}
