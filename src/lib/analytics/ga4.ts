import "server-only";

import { AdsError, sleep } from "@/lib/ads/config";
import type { AvailableAccount } from "@/lib/ads/types";
import {
  explainGa4Error,
  ga4BatchRequests,
  ga4ChannelRows,
  ga4DimRows,
  ga4PageRows,
  ga4PagesRequest,
  ga4TopPages,
  type Ga4ChannelRow,
  type Ga4DimRow,
  type Ga4PageRow,
  type Ga4Report,
  type Ga4Request,
  type GoogleApiError,
} from "./ga4-rows";

// Connecteur Google Analytics 4 (lecture seule, côté serveur) :
//  - Admin API v1beta : accountSummaries.list (propriétés accessibles), keyEvents.list ;
//  - Data API v1beta : properties/{id}:batchRunReports et :runReport.
// Même client OAuth que Google Ads (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET), scope analytics.readonly.
// Les deux API doivent être activées dans le projet Google Cloud du client OAuth.

export const GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly", "openid", "email"];

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

/** Identifiant numérique d'une propriété (« properties/123 » ou « 123 »). */
export const propertyId = (v: string) => v.replace(/^properties\//, "").replace(/\D/g, "");

async function call<T>(url: string, token: string, body?: unknown, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new AdsError("Google Analytics est injoignable pour le moment. Réessaie plus tard.", "network");
  }
  const json = (await res.json().catch(() => ({}))) as T & GoogleApiError;
  if (res.ok) return json;
  // Erreur passagère du serveur : deux nouvelles tentatives. Un quota dépassé (429) ne se réessaie pas.
  if (res.status >= 500 && attempt < 2) {
    await sleep([2000, 8000][attempt]);
    return call<T>(url, token, body, attempt + 1);
  }
  const e = explainGa4Error(res.status, json);
  throw new AdsError(e.message, e.code);
}

interface AccountSummaries {
  accountSummaries?: {
    account?: string;
    displayName?: string;
    propertySummaries?: { property?: string; displayName?: string; propertyType?: string }[];
  }[];
  nextPageToken?: string;
}

/**
 * Propriétés GA4 accessibles avec ce jeton (accountSummaries.list, paginé), au format du cache
 * ad_connections.accounts : external_id = identifiant numérique, manager_name = nom du compte Analytics.
 */
export async function ga4ListProperties(token: string): Promise<AvailableAccount[]> {
  const out: AvailableAccount[] = [];
  let pageToken: string | undefined;
  do {
    const page: AccountSummaries = await call<AccountSummaries>(`${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token);
    for (const a of page.accountSummaries ?? []) {
      for (const p of a.propertySummaries ?? []) {
        const id = propertyId(p.property ?? "");
        if (!id) continue;
        out.push({
          external_id: id,
          name: p.displayName || `Propriété ${id}`,
          currency: "",
          status: "",
          active: true,
          login_customer_id: null,
          manager_name: a.displayName ?? null,
        });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => (a.manager_name ?? "").localeCompare(b.manager_name ?? "", "fr") || a.name.localeCompare(b.name, "fr"));
}

/** Évènements clés déclarés sur la propriété (pour choisir la conversion principale). */
export async function ga4KeyEvents(token: string, property: string): Promise<{ name: string; counting: string | null }[]> {
  const out: { name: string; counting: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const page: { keyEvents?: { eventName?: string; countingMethod?: string }[]; nextPageToken?: string } = await call(
      `${ADMIN}/properties/${propertyId(property)}/keyEvents?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
    );
    for (const k of page.keyEvents ?? []) if (k.eventName) out.push({ name: k.eventName, counting: k.countingMethod ?? null });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Ga4Fetched {
  channels: Ga4ChannelRow[];
  dims: Ga4DimRow[];
  pages: Ga4PageRow[];
  currency: string | null;
  timezone: string | null;
  /** appels HTTP à la Data API (un batch de 5 rapports, puis un rapport de pages) */
  requests: number;
}

/**
 * Lit la fenêtre [since, until] en deux appels :
 *  1. batchRunReports : totaux par jour, jour × canal × source / medium, jour × appareil, jour × pays,
 *     et les principales pages de destination de la fenêtre ;
 *  2. runReport : jour × page de destination, limité à ces pages (le reste devient « (autres) »).
 */
export async function ga4Fetch(token: string, property: string, since: string, until: string, opts: { keyEvent?: string | null } = {}): Promise<Ga4Fetched> {
  const id = propertyId(property);
  const requests: Ga4Request[] = ga4BatchRequests(since, until, opts.keyEvent);
  const batch = await call<{ reports?: Ga4Report[] }>(`${DATA}/properties/${id}:batchRunReports`, token, { requests });
  const [totals, channels, devices, countries, top] = batch.reports ?? [];
  const dims = [...ga4DimRows(totals, "total"), ...ga4DimRows(devices, "device"), ...ga4DimRows(countries, "country")];
  const topPages = ga4TopPages(top);
  let pages: Ga4PageRow[] = [];
  let n = 1;
  if (topPages.length) {
    const report = await call<Ga4Report>(`${DATA}/properties/${id}:runReport`, token, ga4PagesRequest(since, until, topPages, opts.keyEvent));
    pages = ga4PageRows(report, dims);
    n = 2;
  }
  return {
    channels: ga4ChannelRows(channels),
    dims,
    pages,
    currency: totals?.metadata?.currencyCode ?? channels?.metadata?.currencyCode ?? null,
    timezone: totals?.metadata?.timeZone ?? null,
    requests: n,
  };
}
