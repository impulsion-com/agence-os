// Outils Projets : lister, détailler, créer (avec les modèles d'agence).
import { z } from "zod";

import { PROJECT_STATUS, PROJECT_TEMPLATES } from "@/lib/constants";
import { addDays, iso, parseDay, today } from "@/lib/format";
import type { ProjectStatus } from "@/lib/types";
import {
  companiesLite, day, labels, memberName, money, must, norm, parseDateInput, plural, priorityName, projectsLite, resolveCompany,
  resolveMember, resolveProject, statusName, table, url, zDate,
} from "../helpers";
import { ToolError, defineTool } from "../types";

const STATUSES = ["planning", "active", "risk", "hold", "complete"] as const;
const projectStatus = (s: string) => PROJECT_STATUS[s as ProjectStatus]?.name ?? s;

/** Clé de projet à partir du nom (initiales), unique dans l'espace. */
export function projectKeyFor(name: string, taken: string[]) {
  const words = norm(name).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "PRJ").slice(0, 4);
  if (base.length < 2) base = (base + "PR").slice(0, 3);
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base.slice(0, 5)}${i++}`.slice(0, 6);
  return key;
}

const listProjects = defineTool({
  name: "list_projects",
  title: "Lister les projets",
  description:
    "Liste les projets de l'espace avec statut, client, responsable, avancement (tâches terminées / total) et tâches en retard. Par défaut, les projets non archivés.",
  input: z.object({
    status: z.array(z.enum(STATUSES)).optional().describe("Filtre de statut : planning (cadrage), active, risk (à risque), hold (en pause), complete"),
    company: z.string().optional().describe("Client (nom ou identifiant)"),
    lead: z.string().optional().describe("Responsable du projet (nom, email, « me »)"),
    include_archived: z.boolean().default(false),
  }),
  run: async ({ status, company, lead, include_archived }, ctx) => {
    let q = ctx.db
      .from("projects")
      .select("id, key, name, status, company_id, lead_id, due_date, archived_at, monthly_budget, platforms")
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at");
    if (!include_archived) q = q.is("archived_at", null);
    if (status?.length) q = q.in("status", status);
    if (company) q = q.eq("company_id", (await resolveCompany(ctx, company)).id);
    if (lead) q = q.eq("lead_id", (await resolveMember(ctx, lead)).id);
    const projects = must(await q, "Lecture des projets");
    const ids = projects.map((p) => p.id);
    const tasks = ids.length
      ? must(await ctx.db.from("tasks").select("project_id, status, due_date").eq("workspace_id", ctx.workspace.id).in("project_id", ids).is("archived_at", null), "Lecture des tâches")
      : [];
    const t0 = iso(today());
    const companies = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const rows = await Promise.all(
      projects.map(async (p) => {
        const ts = tasks.filter((t) => t.project_id === p.id);
        const done = ts.filter((t) => t.status === "done").length;
        const late = ts.filter((t) => t.status !== "done" && t.due_date && t.due_date < t0).length;
        return { ...p, company: companies.get(p.company_id ?? "") ?? null, lead: await memberName(ctx, p.lead_id), total: ts.length, done, late };
      }),
    );
    if (!rows.length) return { text: "Aucun projet ne correspond.", data: { projects: [] } };
    return {
      text: table(
        ["Clé", "Projet", "Statut", "Client", "Responsable", "Avancement", "En retard", "Échéance"],
        rows.map((p) => [p.key, p.name + (p.archived_at ? " (archivé)" : ""), projectStatus(p.status), p.company, p.lead, `${p.done}/${p.total}`, p.late || "", day(p.due_date)]),
      ),
      data: { projects: rows.map((p) => ({ id: p.id, key: p.key, name: p.name, status: p.status, company: p.company, lead: p.lead, tasks_done: p.done, tasks_total: p.total, tasks_overdue: p.late, due_date: p.due_date })) },
    };
  },
});

const getProject = defineTool({
  name: "get_project",
  title: "Détail d'un projet",
  description: "Détail d'un projet (clé, nom ou identifiant) : description, client, équipe, budget, dates, répartition des tâches par statut, tâches en retard et prochaines échéances.",
  input: z.object({ project: z.string().describe("Clé (ex. ACME), nom ou identifiant du projet") }),
  run: async ({ project }, ctx) => {
    const ref = await resolveProject(ctx, project);
    const [p, tasks, team] = await Promise.all([
      ctx.db.from("projects").select("*").eq("id", ref.id).eq("workspace_id", ctx.workspace.id).single(),
      ctx.db.from("tasks").select("id, number, title, status, priority, assignee_id, due_date, milestone").eq("workspace_id", ctx.workspace.id).eq("project_id", ref.id).is("archived_at", null),
      ctx.db.from("project_members").select("user_id").eq("project_id", ref.id),
    ]);
    const pr = must(p, "Lecture du projet");
    const ts = tasks.data ?? [];
    const t0 = iso(today());
    const open = ts.filter((t) => t.status !== "done");
    const late = open.filter((t) => t.due_date && t.due_date < t0).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
    const next = open.filter((t) => t.due_date && t.due_date >= t0).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 10);
    const byStatus = ["backlog", "todo", "progress", "review", "done"].map((s) => `${statusName(s)} ${ts.filter((t) => t.status === s).length}`).join(" · ");
    const company = pr.company_id ? (await companiesLite(ctx)).find((c) => c.id === pr.company_id)?.name : null;
    const teamNames = await Promise.all((team.data ?? []).map((m) => memberName(ctx, m.user_id)));
    const line = async (t: (typeof ts)[number]) => `- ${pr.key}-${t.number} · ${t.title} · ${day(t.due_date)}${t.assignee_id ? ` · ${await memberName(ctx, t.assignee_id)}` : ""}${t.milestone ? " · jalon" : ""}`;
    const text = [
      `# ${pr.name} (${pr.key})`,
      `Statut : ${projectStatus(pr.status)}${company ? ` · Client : ${company}` : ""} · Responsable : ${(await memberName(ctx, pr.lead_id)) ?? "aucun"}`,
      `Dates : ${day(pr.start_date)} → ${day(pr.due_date)}${pr.monthly_budget ? ` · Budget pub mensuel : ${money(Number(pr.monthly_budget), ctx.workspace.currency)}` : ""}${pr.platforms.length ? ` · Plateformes : ${pr.platforms.join(", ")}` : ""}`,
      teamNames.length ? `Équipe : ${teamNames.join(", ")}` : "",
      pr.description ? `\n${pr.description}\n` : "",
      `Tâches : ${byStatus} (total ${ts.length})`,
      late.length ? `\n## En retard (${late.length})\n${(await Promise.all(late.slice(0, 15).map(line))).join("\n")}` : "",
      next.length ? `\n## Prochaines échéances\n${(await Promise.all(next.map(line))).join("\n")}` : "",
      `\n${url.project(ctx, pr.key)}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text,
      data: {
        project: { id: pr.id, key: pr.key, name: pr.name, status: pr.status, company, start_date: pr.start_date, due_date: pr.due_date, monthly_budget: pr.monthly_budget, description: pr.description },
        counts: Object.fromEntries(["backlog", "todo", "progress", "review", "done"].map((s) => [s, ts.filter((t) => t.status === s).length])),
        overdue: late.map((t) => ({ key: `${pr.key}-${t.number}`, title: t.title, due_date: t.due_date, priority: priorityName(t.priority) })),
        url: url.project(ctx, pr.key),
      },
    };
  },
});

const createProject = defineTool({
  name: "create_project",
  title: "Créer un projet",
  description: `Crée un projet, éventuellement à partir d'un modèle d'agence qui ajoute des tâches de départ avec échéances et étiquettes. Modèles : ${PROJECT_TEMPLATES.map((t) => `${t.id} (${t.name} : ${t.desc})`).join(" ; ")}.`,
  write: true,
  input: z.object({
    name: z.string().min(1).max(120).describe("Nom du projet"),
    template: z.enum(PROJECT_TEMPLATES.map((t) => t.id) as [string, ...string[]]).default("blank").describe("Modèle de départ"),
    key: z.string().regex(/^[A-Za-z0-9]{2,6}$/).optional().describe("Clé courte (2 à 6 lettres ou chiffres), déduite du nom sinon"),
    company: z.string().optional().describe("Client (nom ou identifiant)"),
    lead: z.string().optional().describe("Responsable (nom, email, « me ») ; assigné aussi aux tâches du modèle"),
    status: z.enum(STATUSES).default("active"),
    description: z.string().max(5000).optional(),
    start_date: zDate("Début, base des échéances du modèle").optional(),
    due_date: zDate("Échéance du projet").optional(),
    monthly_budget: z.number().min(0).optional().describe("Budget publicitaire mensuel"),
    platforms: z.array(z.enum(["meta", "google", "tiktok", "linkedin", "snapchat", "pinterest", "chatgpt"])).optional(),
  }),
  run: async (a, ctx) => {
    const tpl = PROJECT_TEMPLATES.find((t) => t.id === a.template)!;
    const taken = (await projectsLite(ctx)).map((p) => p.key);
    const key = a.key ? a.key.toUpperCase() : projectKeyFor(a.name, taken);
    if (taken.includes(key)) throw new ToolError(`La clé ${key} est déjà prise. Clés existantes : ${taken.join(", ")}.`);
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    const lead = a.lead ? await resolveMember(ctx, a.lead) : null;
    const start = parseDateInput(a.start_date, "start_date") ?? iso(today());
    const maxDue = Math.max(0, ...tpl.tasks.map((t) => t.due ?? 0));
    const due = parseDateInput(a.due_date, "due_date") ?? (tpl.tasks.length ? iso(addDays(parseDay(start)!, maxDue)) : null);
    const p = must(
      await ctx.db
        .from("projects")
        .insert({
          workspace_id: ctx.workspace.id,
          name: a.name.trim(),
          key,
          company_id: company?.id ?? null,
          lead_id: lead?.id ?? null,
          status: a.status,
          description: a.description ?? tpl.desc ?? "",
          icon: tpl.icon,
          start_date: start,
          due_date: due,
          monthly_budget: a.monthly_budget ?? null,
          platforms: a.platforms ?? [],
        })
        .select("id, key")
        .single(),
      "Création du projet",
    );
    const memberIds = [...new Set([ctx.user.id, ...(lead ? [lead.id] : [])])];
    await ctx.db.from("project_members").insert(memberIds.map((user_id) => ({ project_id: p.id, user_id })));
    if (tpl.tasks.length) {
      const created = must(
        await ctx.db
          .from("tasks")
          .insert(
            tpl.tasks.map((t, i) => ({
              workspace_id: ctx.workspace.id,
              project_id: p.id,
              title: t.title,
              status: "todo",
              position: (i + 1) * 1000,
              due_date: t.due !== undefined ? iso(addDays(parseDay(start)!, t.due)) : null,
              milestone: !!t.milestone,
              assignee_id: lead?.id ?? null,
              created_by: ctx.user.id,
            })) as never,
          )
          .select("id, title"),
        "Création des tâches du modèle",
      ) as { id: string; title: string }[];
      const ls = await labels(ctx);
      const links = created
        .map((row) => {
          const def = tpl.tasks.find((t) => t.title === row.title);
          const l = def?.label ? ls.find((x) => norm(x.name) === norm(def.label)) : undefined;
          return l ? { task_id: row.id, label_id: l.id } : null;
        })
        .filter((x): x is { task_id: string; label_id: string } => !!x);
      if (links.length) await ctx.db.from("task_labels").insert(links);
    }
    ctx.cache.delete("projects");
    await ctx.log({ verb: "project.created", project_id: p.id, meta: { name: a.name.trim(), template: tpl.id } });
    return {
      text: `Projet **${a.name.trim()}** créé (clé ${p.key})${tpl.tasks.length ? ` avec ${plural(tpl.tasks.length, "tâche de départ", "tâches de départ")} (modèle ${tpl.name})` : ""}.\n${url.project(ctx, p.key)}`,
      data: { id: p.id, key: p.key, tasks_created: tpl.tasks.length, url: url.project(ctx, p.key) },
    };
  },
});

export const projectTools = [listProjects, getProject, createProject];
