// Outils communs aux outils MCP : résolution des références (id, clé, nom),
// dates, mise en forme Markdown compacte. Toutes les requêtes filtrent par espace.
import { z } from "zod";

import { STATUS, PRIORITY } from "@/lib/constants";
import { addDays, fmtDate, iso, money as fmtMoney, parseDay, today } from "@/lib/format";
import type { Priority, Role, TaskStatus } from "@/lib/types";
import { ToolError, type McpContext } from "./types";

// ---------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------
export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s.trim());

/** Échappe une valeur pour un filtre PostgREST ilike (virgules, parenthèses, jokers). */
export const likeSafe = (s: string) => s.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);

/** Cellule de tableau Markdown sur une ligne. */
const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v).replace(/\|/g, "/").replace(/\s*\n\s*/g, " "));

export function table(head: string[], rows: unknown[][]) {
  if (!rows.length) return "";
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

export const money = (v: number | null | undefined, currency = "EUR") => fmtMoney(v ?? 0, currency, Math.abs(Number(v ?? 0)) < 100 && Number(v ?? 0) % 1 !== 0 ? 2 : 0);
export const day = (s: string | null | undefined) => (s ? fmtDate(s.slice(0, 10), true) : "-");
export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n > 1 ? many : one}`;

export const statusName = (s: string) => STATUS[s as TaskStatus]?.name ?? s;
export const priorityName = (p: string) => PRIORITY[p as Priority]?.name ?? p;
export const ROLE_NAME: Record<Role, string> = { owner: "Propriétaire", admin: "Admin", member: "Membre", guest: "Invité" };

// ---------------------------------------------------------------------
// Dates saisies par le modèle : AAAA-MM-JJ, aujourd'hui, demain, +3, -7
// ---------------------------------------------------------------------
export function parseDateInput(v: string | null | undefined, field = "date"): string | null {
  if (v === null || v === undefined) return null;
  const s = norm(v);
  if (!s || s === "null" || s === "aucune") return null;
  if (s === "aujourd'hui" || s === "aujourdhui" || s === "today") return iso(today());
  if (s === "demain" || s === "tomorrow") return iso(addDays(today(), 1));
  if (s === "hier" || s === "yesterday") return iso(addDays(today(), -1));
  const rel = /^([+-]\d{1,4})\s*j?$/.exec(s);
  if (rel) return iso(addDays(today(), Number(rel[1])));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && parseDay(s) && !Number.isNaN(parseDay(s)!.getTime())) return s;
  throw new ToolError(`${field} invalide : « ${v} ». Utilise le format AAAA-MM-JJ (ou aujourd'hui, demain, +3).`);
}

/** Schéma zod d'une date saisie. */
export const zDate = (desc: string) => z.string().max(20).describe(`${desc} (AAAA-MM-JJ, ou « aujourd'hui », « demain », « +7 »)`);

// ---------------------------------------------------------------------
// Liens vers l'application
// ---------------------------------------------------------------------
export const url = {
  base: (c: McpContext) => `${c.appUrl}/w/${c.workspace.slug}`,
  task: (c: McpContext, projectKey: string, id: string) => `${url.base(c)}/projects/${projectKey}/board?task=${id}`,
  project: (c: McpContext, key: string) => `${url.base(c)}/projects/${key}/board`,
  deal: (c: McpContext, id: string) => `${url.base(c)}/crm/deals/${id}`,
  company: (c: McpContext, id: string) => `${url.base(c)}/crm/companies/${id}`,
  contact: (c: McpContext, id: string) => `${url.base(c)}/crm/contacts/${id}`,
  proposal: (c: McpContext, id: string) => `${url.base(c)}/proposals/${id}`,
  link: (c: McpContext, id: string) => `${url.base(c)}/links/${id}`,
  reporting: (c: McpContext, companyId?: string) => `${url.base(c)}/reporting${companyId ? `/${companyId}` : ""}`,
};

// ---------------------------------------------------------------------
// Chargements mis en cache par requête
// ---------------------------------------------------------------------
async function cached<T>(ctx: McpContext, key: string, load: () => Promise<T>): Promise<T> {
  if (ctx.cache.has(key)) return ctx.cache.get(key) as T;
  const v = await load();
  ctx.cache.set(key, v);
  return v;
}

export interface MemberLite {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function members(ctx: McpContext) {
  return cached(ctx, "members", async () => {
    const { data, error } = await ctx.db
      .from("workspace_members")
      .select("user_id, role, profile:profiles(full_name, email)")
      .eq("workspace_id", ctx.workspace.id);
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => {
      const p = m.profile as unknown as { full_name: string; email: string } | null;
      return { id: m.user_id, role: m.role as Role, name: p?.full_name || p?.email || "?", email: p?.email ?? "" };
    }) as MemberLite[];
  });
}

export async function memberName(ctx: McpContext, id: string | null | undefined) {
  if (!id) return null;
  return (await members(ctx)).find((m) => m.id === id)?.name ?? "Ancien membre";
}

export function labels(ctx: McpContext) {
  return cached(ctx, "labels", async () => {
    const { data } = await ctx.db.from("labels").select("id, name, color").eq("workspace_id", ctx.workspace.id).order("name");
    return data ?? [];
  });
}

export function stages(ctx: McpContext) {
  return cached(ctx, "stages", async () => {
    const { data } = await ctx.db.from("pipeline_stages").select("id, name, position, probability, kind").eq("workspace_id", ctx.workspace.id).order("position");
    return (data ?? []) as { id: string; name: string; position: number; probability: number; kind: "open" | "won" | "lost" }[];
  });
}

export function companiesLite(ctx: McpContext) {
  return cached(ctx, "companies", async () => {
    const { data } = await ctx.db.from("companies").select("id, name, status").eq("workspace_id", ctx.workspace.id).order("name");
    return data ?? [];
  });
}

export function projectsLite(ctx: McpContext) {
  return cached(ctx, "projects", async () => {
    const { data } = await ctx.db
      .from("projects")
      .select("id, key, name, status, company_id, archived_at")
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at");
    return data ?? [];
  });
}

// ---------------------------------------------------------------------
// Résolution d'une référence : identifiant, sinon nom (exact puis partiel, sans ambiguïté)
// ---------------------------------------------------------------------
function pick<T>(list: T[], ref: string, keys: (x: T) => (string | null | undefined)[], what: string, show: (x: T) => string): T {
  const q = norm(ref);
  const exact = list.filter((x) => keys(x).some((k) => norm(k) === q));
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : list.filter((x) => keys(x).some((k) => !!k && norm(k).includes(q)));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new ToolError(`${what} introuvable : « ${ref} ».`);
  throw new ToolError(`« ${ref} » est ambigu (${what.toLowerCase()}) : ${partial.slice(0, 8).map(show).join(", ")}. Précise l'identifiant ou le nom exact.`);
}

/** Membre : « me » / « moi », identifiant, email ou nom. */
export async function resolveMember(ctx: McpContext, ref: string): Promise<MemberLite> {
  const r = ref.trim();
  const list = await members(ctx);
  if (["me", "moi", "myself"].includes(norm(r))) return list.find((m) => m.id === ctx.user.id)!;
  if (isUuid(r)) {
    const m = list.find((x) => x.id === r);
    if (!m) throw new ToolError("Ce membre ne fait pas partie de l'espace.");
    return m;
  }
  return pick(list, r, (m) => [m.email, m.name], "Membre", (m) => `${m.name} <${m.email}>`);
}

/** Responsable facultatif : null ou « aucun » pour retirer. */
export async function resolveAssignee(ctx: McpContext, ref: string | null | undefined): Promise<string | null | undefined> {
  if (ref === undefined) return undefined;
  if (ref === null || ["", "none", "aucun", "personne", "null"].includes(norm(ref))) return null;
  return (await resolveMember(ctx, ref)).id;
}

export async function resolveProject(ctx: McpContext, ref: string) {
  const r = ref.trim();
  const list = await projectsLite(ctx);
  if (isUuid(r)) {
    const p = list.find((x) => x.id === r);
    if (!p) throw new ToolError("Projet introuvable dans cet espace.");
    return p;
  }
  const byKey = list.find((p) => p.key.toLowerCase() === r.toLowerCase());
  if (byKey) return byKey;
  return pick(list, r, (p) => [p.name], "Projet", (p) => `${p.name} (${p.key})`);
}

/** Tâche : identifiant ou clé « PROJ-12 ». */
export async function resolveTask(ctx: McpContext, ref: string) {
  const r = ref.trim();
  let q = ctx.db.from("tasks").select("*").eq("workspace_id", ctx.workspace.id);
  if (isUuid(r)) q = q.eq("id", r);
  else {
    const m = /^([A-Za-z0-9]{2,6})-(\d+)$/.exec(r);
    if (!m) throw new ToolError(`Référence de tâche invalide : « ${ref} ». Utilise la clé (ex. ACME-12) ou l'identifiant.`);
    const project = (await projectsLite(ctx)).find((p) => p.key.toLowerCase() === m[1].toLowerCase());
    if (!project) throw new ToolError(`Aucun projet de clé ${m[1].toUpperCase()} dans cet espace.`);
    q = q.eq("project_id", project.id).eq("number", Number(m[2]));
  }
  const { data } = await q.maybeSingle();
  if (!data) throw new ToolError(`Tâche introuvable : « ${ref} ».`);
  const project = (await projectsLite(ctx)).find((p) => p.id === data.project_id)!;
  return { task: data, project, key: `${project.key}-${data.number}` };
}

export async function resolveCompany(ctx: McpContext, ref: string) {
  const r = ref.trim();
  const list = await companiesLite(ctx);
  if (isUuid(r)) {
    const c = list.find((x) => x.id === r);
    if (!c) throw new ToolError("Client introuvable dans cet espace.");
    return c;
  }
  return pick(list, r, (c) => [c.name], "Client", (c) => c.name);
}

export async function resolveContact(ctx: McpContext, ref: string) {
  const r = ref.trim();
  const { data } = await ctx.db.from("contacts").select("id, first_name, last_name, email, company_id").eq("workspace_id", ctx.workspace.id).limit(5000);
  const list = data ?? [];
  if (isUuid(r)) {
    const c = list.find((x) => x.id === r);
    if (!c) throw new ToolError("Contact introuvable dans cet espace.");
    return c;
  }
  return pick(list, r, (c) => [c.email, `${c.first_name} ${c.last_name}`.trim(), `${c.last_name} ${c.first_name}`.trim()], "Contact", (c) => `${c.first_name} ${c.last_name}`.trim() || c.email);
}

export async function resolveDeal(ctx: McpContext, ref: string) {
  const r = ref.trim();
  const { data } = await ctx.db.from("deals").select("*").eq("workspace_id", ctx.workspace.id).limit(5000);
  const list = data ?? [];
  if (isUuid(r)) {
    const d = list.find((x) => x.id === r);
    if (!d) throw new ToolError("Deal introuvable dans cet espace.");
    return d;
  }
  return pick(list, r, (d) => [d.title], "Deal", (d) => d.title);
}

/** Étape du pipeline : identifiant, nom, ou « gagné » / « perdu ». */
export async function resolveStage(ctx: McpContext, ref: string) {
  const list = await stages(ctx);
  const q = norm(ref);
  if (["won", "gagne", "signe"].includes(q)) {
    const s = list.find((x) => x.kind === "won");
    if (s) return s;
  }
  if (["lost", "perdu"].includes(q)) {
    const s = list.find((x) => x.kind === "lost");
    if (s) return s;
  }
  if (isUuid(ref)) {
    const s = list.find((x) => x.id === ref.trim());
    if (!s) throw new ToolError("Étape introuvable dans ce pipeline.");
    return s;
  }
  return pick(list, ref, (s) => [s.name], "Étape", (s) => s.name);
}

export async function resolveLabels(ctx: McpContext, refs: string[]) {
  const list = await labels(ctx);
  return refs.map((r) => {
    if (isUuid(r)) {
      const l = list.find((x) => x.id === r.trim());
      if (!l) throw new ToolError(`Étiquette introuvable : ${r}`);
      return l;
    }
    const l = list.find((x) => norm(x.name) === norm(r));
    if (!l) throw new ToolError(`Étiquette introuvable : « ${r} ». Étiquettes de l'espace : ${list.map((x) => x.name).join(", ") || "aucune"}.`);
    return l;
  });
}

/** Proposition : identifiant ou numéro (« 12 », « #12 »). */
export async function resolveProposal(ctx: McpContext, ref: string) {
  const r = ref.trim().replace(/^#/, "");
  let q = ctx.db.from("proposals").select("*").eq("workspace_id", ctx.workspace.id);
  if (isUuid(r)) q = q.eq("id", r);
  else if (/^\d+$/.test(r)) q = q.eq("number", Number(r));
  else {
    const { data } = await ctx.db.from("proposals").select("id, title, number").eq("workspace_id", ctx.workspace.id).limit(2000);
    const p = pick(data ?? [], r, (x) => [x.title], "Proposition", (x) => `#${x.number} ${x.title}`);
    q = q.eq("id", p.id);
  }
  const { data } = await q.maybeSingle();
  if (!data) throw new ToolError(`Proposition introuvable : « ${ref} ».`);
  return data;
}

/** Échoue proprement sur une erreur Supabase. */
export function must<T>(res: { data: T; error: { message: string; code?: string } | null }, what = "Opération"): NonNullable<T> {
  if (res.error) throw new ToolError(`${what} impossible : ${res.error.message}`);
  return res.data as NonNullable<T>;
}
