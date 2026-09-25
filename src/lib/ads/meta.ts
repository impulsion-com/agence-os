import "server-only";

import { AdsError, META_GRAPH_VERSION, META_SCOPES, sleep } from "./config";
import type { AvailableAccount, FetchedRow } from "./types";

// Connecteur Meta Marketing API (Graph). Tout se passe côté serveur.

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// Codes d'erreur de limitation de débit (réessayables)
const RATE_CODES = new Set([4, 17, 32, 341, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

interface GraphError {
  message: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

async function graph<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (res.ok && !body.error) return body;
  const err = body.error ?? { message: `HTTP ${res.status}` };
  if (err.code && RATE_CODES.has(err.code) && attempt < 3) {
    await sleep([4000, 15000, 45000][attempt]);
    return graph<T>(url, attempt + 1);
  }
  if (err.code === 190) throw new AdsError("Le jeton Meta a expiré ou a été révoqué : reconnecte Meta dans Réglages > Connexions publicitaires.", "token");
  if (err.code === 200 || err.code === 10) throw new AdsError("Permission Meta insuffisante : vérifie que l'app a bien l'accès ads_read et que tu as accès à ce compte.", "permission");
  if (err.code && RATE_CODES.has(err.code)) throw new AdsError("Limite de requêtes Meta atteinte : réessaie dans quelques minutes.", "rate");
  throw new AdsError(`Meta : ${err.error_user_msg || err.message}`);
}

const qs = (p: Record<string, string | number>) => new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();

export function metaAuthUrl(redirectUri: string, state: string) {
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${qs({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: META_SCOPES.join(","),
  })}`;
}

/** Échange le code contre un jeton, puis le convertit en jeton longue durée (~60 jours). */
export async function metaExchangeCode(code: string, redirectUri: string) {
  const short = await graph<{ access_token: string }>(
    `${GRAPH}/oauth/access_token?${qs({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: redirectUri, code })}`,
  );
  const long = await graph<{ access_token: string; expires_in?: number }>(
    `${GRAPH}/oauth/access_token?${qs({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID!,
      client_secret: process.env.META_APP_SECRET!,
      fb_exchange_token: short.access_token,
    })}`,
  );
  const me = await graph<{ id: string; name: string }>(`${GRAPH}/me?${qs({ fields: "id,name", access_token: long.access_token })}`);
  return {
    access_token: long.access_token,
    expires_at: new Date(Date.now() + (long.expires_in ?? 60 * 86400) * 1000).toISOString(),
    user_id: me.id,
    label: me.name,
  };
}

const ACCOUNT_STATUS: Record<number, string> = {
  1: "Actif", 2: "Désactivé", 3: "Impayé", 7: "En examen", 8: "Règlement en attente", 9: "Délai de grâce", 100: "Clôture en cours", 101: "Clôturé", 201: "Actif", 202: "Clôturé",
};

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

async function all<T>(first: string, max = 50): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = first;
  for (let i = 0; url && i < max; i++) {
    const page: Paged<T> = await graph<Paged<T>>(url);
    out.push(...page.data);
    url = page.paging?.next;
  }
  return out;
}

export async function metaListAccounts(token: string): Promise<AvailableAccount[]> {
  const rows = await all<{ id: string; name: string; currency: string; account_status: number; business?: { name: string } }>(
    `${GRAPH}/me/adaccounts?${qs({ fields: "id,name,currency,account_status,business{name}", limit: 200, access_token: token })}`,
  );
  return rows
    .map((a) => ({
      external_id: a.id, // act_XXXX
      name: a.name || a.id,
      currency: a.currency || "EUR",
      status: ACCOUNT_STATUS[a.account_status] ?? `Statut ${a.account_status}`,
      active: a.account_status === 1 || a.account_status === 201,
      login_customer_id: null,
      manager_name: a.business?.name ?? null,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "fr"));
}

// ---------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------
// Règle « conversions » (documentée dans docs/reporting.md) :
//  - par campagne, sur la fenêtre synchronisée : si la campagne a au moins un achat,
//    conversions = achats et valeur = valeur des achats ;
//  - sinon conversions = prospects (leads), valeur = valeur des leads (souvent 0).
//  Un seul type d'action est retenu dans chaque famille pour éviter les doublons :
//    achats : omni_purchase, sinon purchase, sinon offsite_conversion.fb_pixel_purchase
//    leads  : lead, sinon onsite_conversion.lead_grouped, sinon offsite_conversion.fb_pixel_lead
//  Clics = clics sur un lien (inline_link_clicks), comme la colonne « Clics sur un lien ».

const PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const LEAD = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

interface Action {
  action_type: string;
  value: string;
}
interface InsightRow {
  date_start: string;
  campaign_id: string;
  campaign_name: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: Action[];
  action_values?: Action[];
}

const pick = (list: Action[] | undefined, types: string[]) => {
  if (!list) return 0;
  for (const t of types) {
    const a = list.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};

/** Découpe [since, until] en tranches de 31 jours (requêtes plus légères). */
function chunks(since: string, until: string, size = 31) {
  const out: [string, string][] = [];
  const end = new Date(until + "T00:00:00Z");
  let cur = new Date(since + "T00:00:00Z");
  while (cur <= end) {
    const stop = new Date(Math.min(end.getTime(), cur.getTime() + (size - 1) * 864e5));
    out.push([cur.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)]);
    cur = new Date(stop.getTime() + 864e5);
  }
  return out;
}

export async function metaInsights(token: string, accountId: string, since: string, until: string): Promise<FetchedRow[]> {
  const raw: InsightRow[] = [];
  for (const [a, b] of chunks(since, until)) {
    raw.push(
      ...(await all<InsightRow>(
        `${GRAPH}/${accountId}/insights?${qs({
          level: "campaign",
          time_increment: 1,
          time_range: JSON.stringify({ since: a, until: b }),
          fields: "campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions,action_values",
          use_unified_attribution_setting: "true",
          limit: 500,
          access_token: token,
        })}`,
        200,
      )),
    );
  }
  // Famille de conversion retenue par campagne
  const hasPurchase = new Set(raw.filter((r) => pick(r.actions, PURCHASE) > 0).map((r) => r.campaign_id));
  return raw.map((r) => {
    const types = hasPurchase.has(r.campaign_id) ? PURCHASE : LEAD;
    return {
      date: r.date_start,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name ?? "",
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.inline_link_clicks ?? r.clicks ?? 0),
      conversions: pick(r.actions, types),
      conversion_value: pick(r.action_values, types),
    };
  });
}
