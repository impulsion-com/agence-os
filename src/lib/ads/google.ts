import "server-only";

import { AdsError, GOOGLE_ADS_API_VERSION, GOOGLE_SCOPES, sleep } from "./config";
import type { AvailableAccount, FetchedRow } from "./types";

// Connecteur Google Ads API (REST + GAQL). Tout se passe côté serveur.

const API = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

const clean = (id: string) => id.replace(/\D/g, "");
export const fmtCustomerId = (id: string) => clean(id).replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

export function googleAuthUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // pour obtenir un refresh token
    prompt: "consent", // force le refresh token même si l'accès a déjà été accordé
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant")
      throw new AdsError("L'accès Google a été révoqué ou a expiré : reconnecte Google Ads dans Réglages > Connexions publicitaires.", "token");
    throw new AdsError(`Google OAuth : ${json.error_description || json.error || res.status}`);
  }
  return json;
}

export async function googleExchangeCode(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new AdsError("Google n'a pas renvoyé de refresh token. Réessaie la connexion (le consentement doit être redemandé).");
  let email = "";
  let sub = "";
  if (t.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) as { email?: string; sub?: string };
      email = payload.email ?? "";
      sub = payload.sub ?? "";
    } catch {
      /* identité facultative */
    }
  }
  return { access_token: t.access_token!, refresh_token: t.refresh_token, label: email || "Compte Google", user_id: sub || null };
}

export async function googleAccessToken(refreshToken: string) {
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return t.access_token!;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { errors?: { message?: string; errorCode?: Record<string, string> }[] }[];
  };
}

function explain(body: GoogleErrorBody, status: number) {
  const e = body.error;
  const inner = e?.details?.flatMap((d) => d.errors ?? [])[0];
  const code = inner?.errorCode ? Object.values(inner.errorCode)[0] : "";
  if (code === "DEVELOPER_TOKEN_NOT_APPROVED" || code === "DEVELOPER_TOKEN_PROHIBITED")
    return "Jeton développeur Google Ads non approuvé pour les comptes réels : demande l'accès de base dans le Centre API.";
  if (code === "USER_PERMISSION_DENIED") return "Accès refusé à ce compte Google Ads (vérifie le compte administrateur MCC utilisé).";
  if (code === "CUSTOMER_NOT_ENABLED") return "Ce compte Google Ads n'est pas actif (désactivé ou jamais configuré).";
  if (status === 401) return "Accès Google expiré : reconnecte Google Ads.";
  return `Google Ads : ${inner?.message || e?.message || `HTTP ${status}`}`;
}

async function ads<T>(path: string, token: string, init: { body?: unknown; login?: string | null } = {}, attempt = 0): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  if (init.login) headers["login-customer-id"] = clean(init.login);
  const res = await fetch(`${API}/${path}`, {
    method: init.body ? "POST" : "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & GoogleErrorBody;
  if (res.ok) return body;
  if ((res.status === 429 || res.status === 503) && attempt < 3) {
    await sleep([5000, 20000, 60000][attempt]);
    return ads<T>(path, token, init, attempt + 1);
  }
  throw new AdsError(explain(body, res.status));
}

interface SearchPage<R> {
  results?: R[];
  nextPageToken?: string;
}

/** Requête GAQL paginée (googleAds:search). */
async function search<R>(token: string, customerId: string, query: string, login?: string | null): Promise<R[]> {
  const out: R[] = [];
  let pageToken: string | undefined;
  do {
    const page: SearchPage<R> = await ads<SearchPage<R>>(`customers/${clean(customerId)}/googleAds:search`, token, {
      body: { query, ...(pageToken ? { pageToken } : {}) },
      login,
    });
    out.push(...(page.results ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** Requête GAQL en flux (googleAds:searchStream) : une réponse JSON = tableau de lots. */
async function searchStream<R>(token: string, customerId: string, query: string, login?: string | null): Promise<R[]> {
  const batches = await ads<{ results?: R[] }[]>(`customers/${clean(customerId)}/googleAds:searchStream`, token, { body: { query }, login });
  return (Array.isArray(batches) ? batches : []).flatMap((b) => b.results ?? []);
}

const STATUS: Record<string, string> = { ENABLED: "Actif", CANCELED: "Résilié", SUSPENDED: "Suspendu", CLOSED: "Clôturé" };

interface CustomerRow {
  customer: { id: string; descriptiveName?: string; currencyCode?: string; manager?: boolean; status?: string };
}
interface ClientRow {
  customerClient: { id: string; descriptiveName?: string; currencyCode?: string; manager?: boolean; status?: string; level?: string };
}

/**
 * Comptes accessibles : ceux listés par customers:listAccessibleCustomers, plus,
 * pour chaque compte administrateur (MCC), ses comptes clients (customer_client),
 * accessibles avec l'en-tête login-customer-id = identifiant du MCC.
 */
export async function googleListAccounts(token: string): Promise<AvailableAccount[]> {
  const { resourceNames = [] } = await ads<{ resourceNames?: string[] }>("customers:listAccessibleCustomers", token);
  const ids = resourceNames.map((r) => r.split("/")[1]);
  const found = new Map<string, AvailableAccount>();
  const managers: { id: string; name: string }[] = [];

  await Promise.all(
    ids.map(async (id) => {
      try {
        const [row] = await search<CustomerRow>(
          token,
          id,
          "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1",
        );
        if (!row) return;
        const c = row.customer;
        if (c.manager) managers.push({ id: c.id, name: c.descriptiveName || fmtCustomerId(c.id) });
        else
          found.set(c.id, {
            external_id: c.id,
            name: c.descriptiveName || fmtCustomerId(c.id),
            currency: c.currencyCode || "EUR",
            status: STATUS[c.status ?? ""] ?? c.status ?? "",
            active: c.status === "ENABLED",
            login_customer_id: null,
            manager_name: null,
          });
      } catch {
        // Compte résilié ou inaccessible directement : on l'ignore ici
      }
    }),
  );

  for (const m of managers) {
    try {
      const rows = await search<ClientRow>(
        token,
        m.id,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.manager = false",
        m.id,
      );
      for (const { customerClient: c } of rows) {
        if (found.has(c.id)) continue; // accès direct déjà connu : pas besoin du MCC
        found.set(c.id, {
          external_id: c.id,
          name: c.descriptiveName || fmtCustomerId(c.id),
          currency: c.currencyCode || "EUR",
          status: STATUS[c.status ?? ""] ?? c.status ?? "",
          active: c.status === "ENABLED",
          login_customer_id: m.id,
          manager_name: m.name,
        });
      }
    } catch {
      /* MCC sans accès API : on garde les comptes directs */
    }
  }
  return [...found.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "fr"));
}

interface MetricsRow {
  campaign: { id: string; name?: string };
  segments: { date: string };
  metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number; conversionsValue?: number };
}

/**
 * Métriques quotidiennes par campagne. Conversions = colonne « Conversions » de Google Ads
 * (actions de conversion incluses dans l'objectif du compte), valeur = « Valeur de conv. ».
 * NB : LAST_90_DAYS n'existe pas en GAQL, d'où BETWEEN.
 */
export async function googleMetrics(token: string, customerId: string, since: string, until: string, login?: string | null): Promise<FetchedRow[]> {
  const rows = await searchStream<MetricsRow>(
    token,
    customerId,
    `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    login,
  );
  return rows.map((r) => ({
    date: r.segments.date,
    campaign_id: String(r.campaign.id),
    campaign_name: r.campaign.name ?? "",
    spend: Math.round(Number(r.metrics.costMicros ?? 0) / 1e4) / 100,
    impressions: Number(r.metrics.impressions ?? 0),
    clicks: Number(r.metrics.clicks ?? 0),
    conversions: Math.round(Number(r.metrics.conversions ?? 0) * 100) / 100,
    conversion_value: Math.round(Number(r.metrics.conversionsValue ?? 0) * 100) / 100,
  }));
}
