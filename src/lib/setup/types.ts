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
  /** Dernier appel lancé par la tâche */
  last_run: string | null;
  /** Code HTTP renvoyé par l'app (null si pas encore arrivé ou plus vieux que 6 h) */
  last_http: number | null;
  last_error: string | null;
}
