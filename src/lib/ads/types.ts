// Types partagés du reporting (client et serveur).

export type AdPlatform = "meta" | "google" | "tiktok" | "linkedin" | "snapchat" | "pinterest" | "chatgpt" | "other";

/** Compte publicitaire accessible avec une connexion (cache ad_connections.accounts). */
export interface AvailableAccount {
  external_id: string; // Meta : act_123 ; Google : 1234567890 (sans tirets)
  name: string;
  currency: string;
  status: string; // libellé lisible
  active: boolean;
  login_customer_id: string | null; // Google : MCC par lequel on y accède
  manager_name?: string | null;
}

/** Ligne quotidienne par campagne renvoyée par une plateforme. */
export interface FetchedRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

export interface ConnectionPublic {
  id: string;
  workspace_id: string;
  platform: "meta" | "google";
  label: string;
  expires_at: string | null;
  created_at: string;
  accounts: AvailableAccount[];
  accounts_refreshed_at: string | null;
  last_error: string | null;
}

export interface TrackedAccount {
  id: string;
  connection_id: string | null;
  company_id: string | null;
  platform: AdPlatform;
  external_id: string;
  name: string;
  currency: string;
  login_customer_id: string | null;
  last_synced_at: string | null;
  first_synced_at: string | null;
  sync_error: string | null;
}

export interface SyncResult {
  account_id: string;
  name: string;
  ok: boolean;
  rows?: number;
  error?: string;
}
