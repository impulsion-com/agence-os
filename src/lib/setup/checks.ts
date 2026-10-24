import "server-only";

import { META_GRAPH_VERSION, integrationStatus } from "@/lib/ads/config";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { CheckId, CheckResult, CronJob } from "./types";

/** Numéro de la dernière migration que ce code attend (fonction schema_version() en base). */
export const SCHEMA_VERSION = 120;

/** Version du schéma en base ; 0 si la fonction n'existe pas encore (base antérieure à 0120). */
export async function schemaVersion(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("schema_version");
  return error ? 0 : Number(data) || 0;
}

export async function cronStatus(): Promise<CronJob[] | null> {
  const { data, error } = await supabaseAdmin().rpc("cron_status");
  return error ? null : ((data ?? []) as unknown as CronJob[]);
}

const env = (k: string) => process.env[k]?.trim() || "";
const fail = (message: string): CheckResult => ({ ok: false, message });
const pass = (message: string): CheckResult => ({ ok: true, message });

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * Teste pour de vrai un réglage du serveur, sans rien écrire nulle part.
 * Meta : jeton d'app (identifiant + clé secrète). Google : le client OAuth répond « code invalide »
 * et non « client inconnu ». Resend : la clé lit les domaines et celui d'EMAIL_FROM est vérifié.
 * Anthropic : la clé liste les modèles.
 */
export async function runCheck(id: CheckId, origin: string): Promise<CheckResult> {
  try {
    switch (id) {
      case "app_url": {
        const url = env("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
        if (!url) return fail("NEXT_PUBLIC_APP_URL est vide : les liens d'invitation et les connexions Meta et Google ne marcheront pas.");
        if (url !== origin) return fail(`NEXT_PUBLIC_APP_URL vaut ${url} alors que l'app est ouverte sur ${origin}. Mets la même adresse, sans / à la fin, puis redéploie.`);
        return pass(`Adresse publique cohérente : ${url}`);
      }
      case "schema": {
        const v = await schemaVersion();
        if (v >= SCHEMA_VERSION) return pass(`Base à jour (migration ${v}).`);
        return fail(v ? `La base est à la migration ${v}, le code attend la ${SCHEMA_VERSION}.` : `La base date d'avant la migration 0120 : exécute les nouveaux fichiers de supabase/migrations.`);
      }
      case "cron": {
        if (!env("CRON_SECRET")) return fail("CRON_SECRET est vide.");
        const jobs = await cronStatus();
        if (!jobs) return fail("Impossible de lire les tâches planifiées : la migration 0120 n'est pas appliquée.");
        const missing = jobs.filter((j) => !j.scheduled);
        if (missing.length) return fail(`Non programmées : ${missing.map((j) => j.path).join(", ")}.`);
        const wrong = jobs.find((j) => j.url && !j.url.startsWith(env("NEXT_PUBLIC_APP_URL").replace(/\/$/, "") + "/"));
        if (wrong) return fail(`Les tâches visent ${new URL(wrong.url!).origin} : reprogramme-les pour viser l'adresse actuelle.`);
        const failed = jobs.find((j) => j.last_status === "failed");
        if (failed) return fail(`Dernier passage en échec pour ${failed.path} : ${failed.last_message ?? "erreur inconnue"}`);
        return pass("Les trois tâches sont programmées dans Supabase.");
      }
      case "meta": {
        const st = integrationStatus().meta;
        if (!st.configured) return fail(`Variables manquantes : ${st.missing.join(", ")}.`);
        const q = new URLSearchParams({ client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), grant_type: "client_credentials" });
        const r = await getJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${q}`);
        if (r.body.access_token) return pass("L'app Meta répond : identifiant et clé secrète valides.");
        const err = r.body.error as { message?: string } | undefined;
        return fail(`Meta refuse l'app : ${err?.message ?? `HTTP ${r.status}`}. Vérifie META_APP_ID et META_APP_SECRET.`);
      }
      case "google": {
        const ids = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => !env(k));
        if (ids.length) return fail(`Variables manquantes : ${ids.join(", ")}.`);
        const r = await getJson("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), grant_type: "authorization_code", code: "test-agence-os", redirect_uri: `${origin}/api/integrations/google/callback` }),
        });
        const code = String(r.body.error ?? "");
        if (code === "invalid_client" || code === "unauthorized_client") return fail("Google ne reconnaît pas ce client OAuth : vérifie GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.");
        if (code !== "invalid_grant") return fail(`Réponse inattendue de Google : ${code || `HTTP ${r.status}`}.`);
        if (!env("GOOGLE_ADS_DEVELOPER_TOKEN")) return pass("Client OAuth valide (Google Analytics et Agenda prêts). Il manque GOOGLE_ADS_DEVELOPER_TOKEN pour Google Ads.");
        return pass("Client OAuth valide. Le jeton développeur Google Ads se vérifie à la première connexion d'un compte.");
      }
      case "resend": {
        if (!env("RESEND_API_KEY")) return fail("RESEND_API_KEY est vide.");
        const from = env("EMAIL_FROM");
        const domain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
        if (!domain) return fail("EMAIL_FROM doit ressembler à « Mon agence <bonjour@mon-agence.fr> ».");
        const r = await getJson("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` } });
        if (r.status === 401 || r.status === 403) return fail("Resend refuse la clé (ou c'est une clé « envoi seulement » : la vérification du domaine demande une clé « accès complet »).");
        const list = (r.body.data ?? []) as { name: string; status: string }[];
        const d = list.find((x) => x.name.toLowerCase() === domain);
        if (!d) return fail(`Le domaine ${domain} n'est pas ajouté dans Resend.`);
        if (d.status !== "verified") return fail(`Le domaine ${domain} est « ${d.status} » dans Resend : les enregistrements DNS ne sont pas encore validés.`);
        return pass(`Resend prêt : ${domain} est vérifié.`);
      }
      case "anthropic": {
        if (!env("ANTHROPIC_API_KEY")) return fail("ANTHROPIC_API_KEY est vide.");
        const r = await getJson("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" } });
        if (r.status === 200) return pass("Clé Anthropic valide.");
        const err = r.body.error as { message?: string } | undefined;
        return fail(`Anthropic refuse la clé : ${err?.message ?? `HTTP ${r.status}`}.`);
      }
    }
  } catch (e) {
    return fail(`Test impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}
