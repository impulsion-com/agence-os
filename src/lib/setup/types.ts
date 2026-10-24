export type CheckId = "app_url" | "schema" | "cron" | "meta" | "google" | "resend" | "anthropic";

export interface CheckResult {
  ok: boolean;
  message: string;
}

export interface CronJob {
  name: string;
  path: string;
  schedule: string;
  scheduled: boolean;
  url: string | null;
  last_run: string | null;
  last_status: string | null;
  last_message: string | null;
}
