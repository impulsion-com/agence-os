import "server-only";

import { createHash } from "node:crypto";

import { META_GRAPH_VERSION } from "@/lib/ads/config";
import { readModules } from "@/lib/modules";
import { supabaseAdmin } from "@/lib/supabase/server";
import { AI_TAG_LIMIT, aiEnabled, tagItems } from "./ai";
import { contentKey, mapGraphError, parseArchivePage, type GraphErr, type IntelErrorCode, type IntelTags, type ParsedAd } from "./intel-core";

// Veille concurrentielle : appels à l'API Meta Ad Library (lecture seule),
// synchro incrémentale des surveillances, notifications et tagging IA.
// Tout se passe côté serveur : le jeton ne quitte jamais le serveur.

type Admin = ReturnType<typeof supabaseAdmin>;
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const FIELDS = [
  "id", "page_id", "page_name", "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions", "ad_creative_link_captions",
  "ad_delivery_start_time", "ad_delivery_stop_time", "ad_snapshot_url", "publisher_platforms", "languages", "eu_total_reach",
  "target_ages", "target_gender", "target_locations",
].join(",");

const PAGE_SIZE = 100;
/** Environ 200 appels par heure et par jeton : on en garde une marge. */
export const CALLS_PER_RUN = 150;

export class IntelError extends Error {
  constructor(
    message: string,
    public code: IntelErrorCode | "no_token" | "budget" = "other",
  ) {
    super(message);
    this.name = "IntelError";
  }
}

export const intelErrMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Budget d'appels partagé par une exécution (manuelle ou cron). */
export class Budget {
  constructor(public left = CALLS_PER_RUN) {}
  take() {
    if (this.left <= 0) throw new IntelError("Budget d'appels de cette synchro épuisé : la suite passera à la prochaine synchro.", "budget");
    this.left--;
  }
}

async function graph<T>(url: string, budget?: Budget): Promise<T> {
  budget?.take();
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new IntelError("Impossible de joindre l'API Meta (réseau ou délai dépassé).");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: GraphErr };
  if (res.ok && !body.error) return body;
  const m = mapGraphError(body.error ?? { message: `HTTP ${res.status}` });
  throw new IntelError(m.message, m.code);
}

const qs = (p: Record<string, string | number>) => new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();

// ---------------------------------------------------------------------
// Jeton : collé à la main (prioritaire), sinon la connexion Meta du reporting
// ---------------------------------------------------------------------
export async function resolveToken(admin: Admin, ws: string): Promise<{ token: string; source: "manual" | "connection"; label: string | null } | null> {
  const { data: s } = await admin.from("creative_intel_settings").select("access_token, token_label").eq("workspace_id", ws).maybeSingle();
  if (s?.access_token) return { token: s.access_token, source: "manual", label: s.token_label };
  const { data: c } = await admin
    .from("ad_connections")
    .select("access_token, label, expires_at")
    .eq("workspace_id", ws)
    .eq("platform", "meta")
    .order("created_at", { ascending: false });
  const ok = (c ?? []).find((x) => !x.expires_at || new Date(x.expires_at).getTime() > Date.now());
  return ok ? { token: ok.access_token, source: "connection", label: ok.label } : null;
}

/** Vérifie un jeton : identité, expiration, et accès effectif à l'API Ad Library. */
export async function testToken(token: string) {
  const out: { ok: boolean; label: string | null; user_id: string | null; expires_at: string | null; error: string | null; code: string | null } = {
    ok: false, label: null, user_id: null, expires_at: null, error: null, code: null,
  };
  try {
    const me = await graph<{ id: string; name?: string }>(`${GRAPH}/me?${qs({ fields: "id,name", access_token: token })}`);
    out.user_id = me.id;
    out.label = me.name ?? null;
  } catch (e) {
    out.error = intelErrMsg(e);
    out.code = e instanceof IntelError ? e.code : "other";
    return out;
  }
  try {
    const d = await graph<{ data?: { expires_at?: number; data_access_expires_at?: number } }>(`${GRAPH}/debug_token?${qs({ input_token: token, access_token: token })}`);
    const exp = d.data?.expires_at;
    if (exp && exp > 0) out.expires_at = new Date(exp * 1000).toISOString();
  } catch {
    /* expiration inconnue : on continue */
  }
  try {
    await graph(`${GRAPH}/ads_archive?${qs({ search_terms: "lampe", ad_reached_countries: '["FR"]', ad_type: "ALL", limit: 1, fields: "id", access_token: token })}`);
    out.ok = true;
  } catch (e) {
    out.error = intelErrMsg(e);
    out.code = e instanceof IntelError ? e.code : "other";
  }
  return out;
}

// ---------------------------------------------------------------------
// Recherche d'une page concurrente par son nom (via les pubs qui la citent)
// ---------------------------------------------------------------------
export async function searchPages(token: string, q: string, countries: string[]) {
  const pages = new Map<string, { page_id: string; page_name: string; ads: number }>();
  let url: string | null = `${GRAPH}/ads_archive?${qs({
    search_terms: q.slice(0, 100),
    ad_reached_countries: JSON.stringify(countries.length ? countries : ["FR"]),
    ad_type: "ALL",
    ad_active_status: "ALL",
    fields: "page_id,page_name",
    limit: 200,
    access_token: token,
  })}`;
  for (let i = 0; url && i < 2; i++) {
    const body: unknown = await graph<unknown>(url);
    const page = parseArchivePage(body);
    for (const a of page.ads) {
      if (!a.page_id) continue;
      const cur = pages.get(a.page_id) ?? { page_id: a.page_id, page_name: a.page_name, ads: 0 };
      cur.ads++;
      pages.set(a.page_id, cur);
    }
    url = page.next;
  }
  const needle = q.toLowerCase();
  return [...pages.values()]
    .sort((a, b) => Number(b.page_name.toLowerCase().includes(needle)) - Number(a.page_name.toLowerCase().includes(needle)) || b.ads - a.ads)
    .slice(0, 12);
}

// ---------------------------------------------------------------------
// Synchro d'une surveillance
// ---------------------------------------------------------------------
export interface WatchRow {
  id: string;
  workspace_id: string;
  company_id: string | null;
  kind: string;
  page_id: string | null;
  page_name: string;
  search_terms: string;
  countries: string[];
  active_only: boolean;
  last_synced_at: string | null;
  last_notified_at: string | null;
}

const WATCH_COLS = "id, workspace_id, company_id, kind, page_id, page_name, search_terms, countries, active_only, last_synced_at, last_notified_at";

async function fetchAll(token: string, w: WatchRow, status: "ACTIVE" | "INACTIVE", maxPages: number, budget: Budget, dateMin?: string) {
  const params: Record<string, string | number> = {
    ad_reached_countries: JSON.stringify(w.countries.length ? w.countries : ["FR"]),
    ad_type: "ALL",
    ad_active_status: status,
    fields: FIELDS,
    limit: PAGE_SIZE,
    access_token: token,
  };
  if (w.kind === "page") params.search_page_ids = JSON.stringify([w.page_id]);
  else params.search_terms = w.search_terms.slice(0, 100);
  if (dateMin) params.ad_delivery_date_min = dateMin;
  const ads: ParsedAd[] = [];
  let url: string | null = `${GRAPH}/ads_archive?${qs(params)}`;
  let pages = 0;
  while (url && pages < maxPages) {
    const page = parseArchivePage(await graph<unknown>(url, budget));
    ads.push(...page.ads);
    url = page.next;
    pages++;
  }
  // complet = on a atteint la fin des résultats (sinon, on ne déduit rien des absents)
  return { ads, complete: !url };
}

export async function syncWatch(admin: Admin, w: WatchRow, token: string, budget: Budget) {
  const now = new Date().toISOString();
  try {
    const maxPages = w.kind === "page" ? 5 : 3;
    const active = await fetchAll(token, w, "ACTIVE", maxPages, budget);
    // Historique : une seule fois, à la première synchro d'une surveillance « toutes les pubs »
    const past =
      !w.active_only && !w.last_synced_at
        ? await fetchAll(token, w, "INACTIVE", 2, budget, new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10))
        : { ads: [] as ParsedAd[], complete: true };

    const all = [...active.ads.map((a) => ({ a, on: true })), ...past.ads.map((a) => ({ a, on: false }))];
    const ids = [...new Set(all.map((x) => x.a.archive_id))];
    const existing = new Map<string, { watch_id: string | null; first_seen: string }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("competitor_ads").select("archive_id, watch_id, first_seen").eq("workspace_id", w.workspace_id).in("archive_id", ids.slice(i, i + 200));
      for (const r of data ?? []) existing.set(r.archive_id, { watch_id: r.watch_id, first_seen: r.first_seen });
    }
    const seen = new Set<string>();
    const rows = all
      .filter(({ a }) => (seen.has(a.archive_id) ? false : (seen.add(a.archive_id), true)))
      .map(({ a, on }) => {
        const ex = existing.get(a.archive_id);
        return {
          workspace_id: w.workspace_id,
          watch_id: ex?.watch_id ?? w.id,
          archive_id: a.archive_id,
          page_id: a.page_id,
          page_name: a.page_name,
          bodies: a.bodies,
          titles: a.titles,
          descriptions: a.descriptions,
          captions: a.captions,
          start_time: a.start_time,
          stop_time: a.stop_time,
          snapshot_url: a.snapshot_url,
          platforms: a.platforms,
          languages: a.languages,
          eu_reach: a.eu_reach,
          target_ages: a.target_ages,
          target_gender: a.target_gender,
          target_locations: (a.target_locations ?? null) as never,
          is_active: on && !a.stop_time,
          first_seen: ex?.first_seen ?? now,
          last_seen: now,
        };
      });
    for (let i = 0; i < rows.length; i += 200) {
      const up = await admin.from("competitor_ads").upsert(rows.slice(i, i + 200), { onConflict: "workspace_id,archive_id" });
      if (up.error) throw new Error(up.error.message);
    }

    // Pubs de cette surveillance qui ne sont plus actives
    let stopped = 0;
    if (active.complete) {
      const activeIds = new Set(active.ads.map((a) => a.archive_id));
      const { data: prev } = await admin.from("competitor_ads").select("id, archive_id").eq("watch_id", w.id).eq("is_active", true).eq("is_demo", false);
      const gone = (prev ?? []).filter((p) => !activeIds.has(p.archive_id)).map((p) => p.id);
      for (let i = 0; i < gone.length; i += 200) await admin.from("competitor_ads").update({ is_active: false }).in("id", gone.slice(i, i + 200));
      stopped = gone.length;
    }

    // Nom de la page (surveillance créée à partir d'un ID)
    const pageName = w.kind === "page" && !w.page_name ? (active.ads[0]?.page_name ?? past.ads[0]?.page_name ?? "") : w.page_name;
    await admin.from("competitor_watches").update({ last_synced_at: now, last_error: null, page_name: pageName }).eq("id", w.id);
    await notifyLaunches(admin, { ...w, page_name: pageName });
    return { ok: true as const, fetched: rows.length, created: rows.filter((r) => !existing.has(r.archive_id)).length, stopped, complete: active.complete };
  } catch (e) {
    const msg = intelErrMsg(e);
    await admin.from("competitor_watches").update({ last_error: msg }).eq("id", w.id);
    return { ok: false as const, error: msg, code: e instanceof IntelError ? e.code : "other" };
  }
}

/** Notification in-app : un concurrent surveillé lance au moins 3 nouvelles pubs dans la semaine. */
async function notifyLaunches(admin: Admin, w: WatchRow) {
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  if (w.last_notified_at && w.last_notified_at > week) return;
  const { count } = await admin
    .from("competitor_ads")
    .select("id", { count: "exact", head: true })
    .eq("watch_id", w.id)
    .gte("start_time", week);
  if (!count || count < 3) return;
  const { data: members } = await admin.from("workspace_members").select("user_id").eq("workspace_id", w.workspace_id).in("role", ["owner", "admin", "member"]);
  if (!members?.length) return;
  const who = w.kind === "page" ? w.page_name || `la page ${w.page_id}` : `« ${w.search_terms} »`;
  await admin.from("notifications").insert(
    members.map((m) => ({
      workspace_id: w.workspace_id,
      user_id: m.user_id,
      kind: "creative",
      body: `Veille : ${who} a lancé ${count} nouvelles pubs cette semaine`,
    })),
  );
  await admin.from("competitor_watches").update({ last_notified_at: new Date().toISOString() }).eq("id", w.id);
}

// ---------------------------------------------------------------------
// Synchro d'un espace (manuelle) et de tous les espaces (cron)
// ---------------------------------------------------------------------
export async function syncIntel(ws: string, opts: { watchId?: string; budget?: Budget; minAgeHours?: number } = {}) {
  const admin = supabaseAdmin();
  const budget = opts.budget ?? new Budget();
  let q = admin.from("competitor_watches").select(WATCH_COLS).eq("workspace_id", ws).eq("enabled", true).eq("is_demo", false);
  if (opts.watchId) q = q.eq("id", opts.watchId);
  const { data: watches, error } = await q.order("last_synced_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);
  const list = (watches ?? []).filter((w) => !opts.minAgeHours || !w.last_synced_at || Date.now() - Date.parse(w.last_synced_at) > opts.minAgeHours * 3600e3);
  if (!list.length) return { results: [], tagged: 0, tagError: null as string | null };
  const tok = await resolveToken(admin, ws);
  if (!tok) {
    const msg = "Aucun jeton Meta : colle un jeton dans les réglages de la veille ou connecte Meta dans le reporting.";
    await admin.from("competitor_watches").update({ last_error: msg }).in("id", list.map((w) => w.id));
    throw new IntelError(msg, "no_token");
  }
  const results: ({ watch_id: string } & Awaited<ReturnType<typeof syncWatch>>)[] = [];
  for (const w of list) {
    const r = await syncWatch(admin, w, tok.token, budget);
    results.push({ watch_id: w.id, ...r });
    // Jeton refusé ou limite atteinte : inutile d'insister sur les suivantes
    if (!r.ok && (r.code === "token" || r.code === "identity" || r.code === "rate" || r.code === "budget")) break;
  }
  let tagged = 0;
  let tagError: string | null = null;
  if (aiEnabled() && results.some((r) => r.ok)) {
    const t = await tagCompetitorAds(admin, ws, AI_TAG_LIMIT);
    tagged = t.tagged;
    tagError = t.error;
  }
  return { results, tagged, tagError };
}

export async function syncIntelAll() {
  const admin = supabaseAdmin();
  const { data } = await admin.from("competitor_watches").select("workspace_id, workspace:workspaces(modules)").eq("enabled", true).eq("is_demo", false);
  const ids = [
    ...new Set(
      (data ?? [])
        .filter((r) => readModules((r.workspace as { modules?: unknown } | null)?.modules).includes("creatives"))
        .map((r) => r.workspace_id),
    ),
  ];
  const out: { workspace_id: string; ok: number; errors: string[]; tagged: number }[] = [];
  for (const id of ids) {
    try {
      // Un budget par espace (chaque espace a son propre jeton) ; on saute ce qui a été synchronisé il y a moins de 12 h
      const r = await syncIntel(id, { budget: new Budget(), minAgeHours: 12 });
      out.push({ workspace_id: id, ok: r.results.filter((x) => x.ok).length, errors: r.results.flatMap((x) => (x.ok ? [] : [x.error])), tagged: r.tagged });
    } catch (e) {
      out.push({ workspace_id: id, ok: 0, errors: [intelErrMsg(e)], tagged: 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Tagging IA idempotent (empreinte du contenu)
// ---------------------------------------------------------------------
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

export async function tagCompetitorAds(admin: Admin, ws: string, limit: number, companyWatchIds?: string[]) {
  let q = admin.from("competitor_ads").select("id, bodies, titles, descriptions, ai_tags_hash").eq("workspace_id", ws);
  if (companyWatchIds) q = q.in("watch_id", companyWatchIds);
  const { data } = await q.order("first_seen", { ascending: false }).limit(1000);
  const todo = (data ?? [])
    .map((a) => {
      const key = contentKey([...a.bodies, ...a.titles, ...a.descriptions]);
      return { a, key, h: hash(key) };
    })
    .filter((x) => x.key && x.a.ai_tags_hash !== x.h && x.a.ai_tags_hash !== "demo")
    .slice(0, limit);
  if (!todo.length) return { tagged: 0, remaining: 0, error: null as string | null };
  const items = todo.map(({ a }) => ({
    id: a.id,
    text: [a.bodies.join("\n"), a.titles.length ? `Titre : ${a.titles.join(" / ")}` : "", a.descriptions.length ? `Description : ${a.descriptions.join(" / ")}` : ""].filter(Boolean).join("\n"),
  }));
  const res = await tagItems(items);
  const at = new Date().toISOString();
  for (const x of todo) {
    const t = res.tags.get(x.a.id);
    if (t) await admin.from("competitor_ads").update({ ai_tags: t as never, ai_tags_hash: x.h, ai_tagged_at: at }).eq("id", x.a.id);
  }
  return { tagged: res.tags.size, remaining: Math.max(0, todo.length - res.tags.size), error: res.error };
}

export async function tagConcepts(admin: Admin, ws: string, limit: number, companyId?: string | null) {
  let q = admin.from("creative_concepts").select("id, title, angle, hook, persona, format, brief, ai_tags_hash").eq("workspace_id", ws);
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q.order("updated_at", { ascending: false }).limit(1000);
  const text = (c: NonNullable<typeof data>[number]) => {
    const b = (c.brief ?? {}) as Record<string, string>;
    return [`Titre : ${c.title}`, c.hook && `Hook : ${c.hook}`, c.angle && `Angle noté : ${c.angle}`, c.persona && `Persona : ${c.persona}`, b.script && `Script : ${b.script}`, b.cta && `Appel à l'action : ${b.cta}`]
      .filter(Boolean)
      .join("\n");
  };
  const todo = (data ?? [])
    .map((c) => {
      const t = text(c);
      return { c, t, h: hash(contentKey([t])) };
    })
    .filter((x) => x.c.ai_tags_hash !== x.h && x.c.ai_tags_hash !== "demo")
    .slice(0, limit);
  if (!todo.length) return { tagged: 0, remaining: 0, error: null as string | null };
  const res = await tagItems(todo.map((x) => ({ id: x.c.id, text: x.t, format: x.c.format })));
  const at = new Date().toISOString();
  for (const x of todo) {
    const t: IntelTags | undefined = res.tags.get(x.c.id);
    if (t) await admin.from("creative_concepts").update({ ai_tags: t as never, ai_tags_hash: x.h, ai_tagged_at: at }).eq("id", x.c.id);
  }
  return { tagged: res.tags.size, remaining: Math.max(0, todo.length - res.tags.size), error: res.error };
}
