// Outils Tâches : lister, détailler, créer, modifier, commenter.
import { z } from "zod";

import { PRIORITY } from "@/lib/constants";
import { addDays, iso, parseDay, today } from "@/lib/format";
import type { Priority, Task } from "@/lib/types";
import {
  day, labels, likeSafe, memberName, must, parseDateInput, priorityName, projectsLite, resolveAssignee, resolveLabels, resolveMember,
  resolveProject, resolveTask, statusName, table, truncate, url, zDate,
} from "../helpers";
import { ToolError, defineTool, type McpContext } from "../types";

const STATUSES = ["backlog", "todo", "progress", "review", "done"] as const;
const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
const STATUS_HELP = "backlog, todo (à faire), progress (en cours), review (validation client), done (terminé)";

type TaskRow = Pick<Task, "id" | "number" | "title" | "status" | "priority" | "assignee_id" | "due_date" | "project_id" | "updated_at" | "created_at" | "milestone">;

const listTasks = defineTool({
  name: "list_tasks",
  title: "Lister les tâches",
  description:
    "Liste les tâches avec filtres : statut, responsable (« me » pour soi, « none » pour non assignées), projet, échéance (overdue = en retard, today, week = 7 prochains jours, none = sans échéance), priorité, étiquette, texte. Les tâches terminées sont exclues sauf si le filtre de statut les demande ou include_done = true.",
  input: z.object({
    status: z.array(z.enum(STATUSES)).optional().describe(`Statuts : ${STATUS_HELP}`),
    assignee: z.string().optional().describe("Responsable : « me », « none », nom ou email"),
    project: z.string().optional().describe("Projet : clé, nom ou identifiant"),
    due: z.enum(["overdue", "today", "week", "none"]).optional(),
    priority: z.array(z.enum(PRIORITIES)).optional(),
    label: z.string().optional().describe("Nom d'étiquette"),
    query: z.string().max(80).optional().describe("Texte contenu dans le titre"),
    include_done: z.boolean().default(false),
    sort: z.enum(["due", "priority", "updated", "created"]).default("due"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (a, ctx) => {
    const t0 = iso(today());
    let q = ctx.db
      .from("tasks")
      .select("id, number, title, status, priority, assignee_id, due_date, project_id, updated_at, created_at, milestone")
      .eq("workspace_id", ctx.workspace.id)
      .is("archived_at", null);
    if (a.status?.length) q = q.in("status", a.status);
    else if (!a.include_done) q = q.neq("status", "done");
    if (a.assignee) {
      const id = await resolveAssignee(ctx, a.assignee);
      q = id ? q.eq("assignee_id", id) : q.is("assignee_id", null);
    }
    if (a.project) q = q.eq("project_id", (await resolveProject(ctx, a.project)).id);
    if (a.priority?.length) q = q.in("priority", a.priority);
    if (a.query) q = q.ilike("title", `%${likeSafe(a.query)}%`);
    if (a.due === "overdue") q = q.lt("due_date", t0).neq("status", "done");
    if (a.due === "today") q = q.eq("due_date", t0);
    if (a.due === "week") q = q.gte("due_date", t0).lte("due_date", iso(addDays(today(), 7)));
    if (a.due === "none") q = q.is("due_date", null);
    if (a.label) {
      const [l] = await resolveLabels(ctx, [a.label]);
      const ids = must(await ctx.db.from("task_labels").select("task_id").eq("label_id", l.id)).map((x) => x.task_id);
      if (!ids.length) return { text: "Aucune tâche ne porte cette étiquette.", data: { tasks: [] } };
      q = q.in("id", ids.slice(0, 1000));
    }
    q =
      a.sort === "updated" ? q.order("updated_at", { ascending: false })
      : a.sort === "created" ? q.order("created_at", { ascending: false })
      : q.order("due_date", { ascending: true, nullsFirst: false });
    const rows = must(await q.limit(a.sort === "priority" ? 1000 : a.limit), "Lecture des tâches") as TaskRow[];
    const sorted = a.sort === "priority" ? [...rows].sort((x, y) => PRIORITY[y.priority as Priority].weight - PRIORITY[x.priority as Priority].weight || (x.due_date ?? "9").localeCompare(y.due_date ?? "9")).slice(0, a.limit) : rows;
    const keys = new Map((await projectsLite(ctx)).map((p) => [p.id, p]));
    const items = await Promise.all(
      sorted.map(async (t) => ({
        id: t.id,
        key: `${keys.get(t.project_id)?.key}-${t.number}`,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: await memberName(ctx, t.assignee_id),
        due_date: t.due_date,
        overdue: !!t.due_date && t.status !== "done" && t.due_date < t0,
        project: keys.get(t.project_id)?.name ?? null,
      })),
    );
    if (!items.length) return { text: "Aucune tâche ne correspond.", data: { tasks: [] } };
    return {
      text:
        `${items.length} tâche${items.length > 1 ? "s" : ""}${items.length === a.limit ? " (limite atteinte)" : ""}\n` +
        table(
          ["Clé", "Titre", "Statut", "Priorité", "Responsable", "Échéance", "Projet"],
          items.map((t) => [t.key, truncate(t.title, 80), statusName(t.status), t.priority === "none" ? "" : priorityName(t.priority), t.assignee, t.due_date ? `${t.due_date}${t.overdue ? " (en retard)" : ""}` : "", t.project]),
        ),
      data: { tasks: items },
    };
  },
});

const getTask = defineTool({
  name: "get_task",
  title: "Détail d'une tâche",
  description: "Détail complet d'une tâche (clé ACME-12 ou identifiant) : description, statut, priorité, responsable, dates, étiquettes, sous-tâches, dépendances et derniers commentaires.",
  input: z.object({ task: z.string().describe("Clé (ex. ACME-12) ou identifiant de la tâche") }),
  run: async ({ task }, ctx) => {
    const { task: t, project, key } = await resolveTask(ctx, task);
    const [tl, subs, comments, deps] = await Promise.all([
      ctx.db.from("task_labels").select("label_id").eq("task_id", t.id),
      ctx.db.from("subtasks").select("title, done, assignee_id, position").eq("task_id", t.id).order("position"),
      ctx.db.from("comments").select("body, author_id, created_at").eq("task_id", t.id).eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(20),
      ctx.db.from("task_dependencies").select("depends_on_id").eq("task_id", t.id),
    ]);
    const ls = await labels(ctx);
    const labelNames = (tl.data ?? []).map((x) => ls.find((l) => l.id === x.label_id)?.name).filter(Boolean) as string[];
    const depIds = (deps.data ?? []).map((d) => d.depends_on_id);
    const depRows = depIds.length ? (await ctx.db.from("tasks").select("number, title, status, project_id").eq("workspace_id", ctx.workspace.id).in("id", depIds)).data ?? [] : [];
    const pk = new Map((await projectsLite(ctx)).map((p) => [p.id, p.key]));
    const cs = [...(comments.data ?? [])].reverse();
    const commentLines = await Promise.all(cs.map(async (c) => `- **${(await memberName(ctx, c.author_id)) ?? "?"}** (${c.created_at.slice(0, 16).replace("T", " ")}) : ${truncate(c.body, 600)}`));
    const subLines = (subs.data ?? []).map((s) => `- [${s.done ? "x" : " "}] ${s.title}`);
    const text = [
      `# ${key} · ${t.title}`,
      `Projet : ${project.name} · Statut : ${statusName(t.status)} · Priorité : ${priorityName(t.priority)} · Responsable : ${(await memberName(ctx, t.assignee_id)) ?? "aucun"}`,
      `Début : ${day(t.start_date)} · Échéance : ${day(t.due_date)}${t.milestone ? " · Jalon" : ""}${t.recurrence ? ` · Récurrente (${t.recurrence})` : ""}${labelNames.length ? ` · Étiquettes : ${labelNames.join(", ")}` : ""}`,
      t.description ? `\n${t.description}` : "\n(sans description)",
      subLines.length ? `\n## Sous-tâches\n${subLines.join("\n")}` : "",
      depRows.length ? `\n## Bloquée par\n${depRows.map((d) => `- ${pk.get(d.project_id)}-${d.number} · ${d.title} (${statusName(d.status)})`).join("\n")}` : "",
      commentLines.length ? `\n## Commentaires${(comments.data ?? []).length === 20 ? " (20 derniers)" : ""}\n${commentLines.join("\n")}` : "",
      `\n${url.task(ctx, project.key, t.id)}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text,
      data: {
        id: t.id, key, title: t.title, description: t.description, status: t.status, priority: t.priority,
        assignee: await memberName(ctx, t.assignee_id), start_date: t.start_date, due_date: t.due_date, labels: labelNames,
        project: { id: project.id, key: project.key, name: project.name },
        subtasks: (subs.data ?? []).map((s) => ({ title: s.title, done: s.done })),
        comments: await Promise.all(cs.map(async (c) => ({ author: await memberName(ctx, c.author_id), body: c.body, created_at: c.created_at }))),
        url: url.task(ctx, project.key, t.id),
      },
    };
  },
});

const createTask = defineTool({
  name: "create_task",
  title: "Créer une tâche",
  description: `Crée une tâche dans un projet. Statuts : ${STATUS_HELP}. Priorités : urgent, high, medium, low, none.`,
  write: true,
  input: z.object({
    project: z.string().describe("Projet : clé, nom ou identifiant"),
    title: z.string().min(1).max(300),
    description: z.string().max(20000).optional().describe("Description (Markdown)"),
    status: z.enum(STATUSES).default("todo"),
    priority: z.enum(PRIORITIES).default("none"),
    assignee: z.string().optional().describe("Responsable : « me », nom ou email"),
    due_date: zDate("Échéance").optional(),
    start_date: zDate("Début").optional(),
    labels: z.array(z.string()).optional().describe("Noms d'étiquettes existantes"),
    milestone: z.boolean().optional(),
    subtasks: z.array(z.string().min(1).max(300)).max(30).optional().describe("Titres de sous-tâches à créer"),
  }),
  run: async (a, ctx) => {
    const project = await resolveProject(ctx, a.project);
    if (project.archived_at) throw new ToolError(`Le projet ${project.key} est archivé.`);
    const assignee = a.assignee ? (await resolveMember(ctx, a.assignee)).id : null;
    const ls = a.labels?.length ? await resolveLabels(ctx, a.labels) : [];
    const created = await insertTask(ctx, {
      project_id: project.id,
      title: a.title.trim(),
      description: a.description ?? "",
      status: a.status,
      priority: a.priority,
      assignee_id: assignee,
      due_date: parseDateInput(a.due_date, "due_date"),
      start_date: parseDateInput(a.start_date, "start_date"),
      milestone: !!a.milestone,
      label_ids: ls.map((l) => l.id),
    });
    if (a.subtasks?.length)
      await ctx.db.from("subtasks").insert(a.subtasks.map((title, i) => ({ task_id: created.id, title, position: (i + 1) * 1000 })));
    const key = `${project.key}-${created.number}`;
    await ctx.log({ verb: "task.created", project_id: project.id, task_id: created.id, meta: { title: created.title, key } });
    return {
      text: `Tâche **${key}** créée : ${created.title}\n${url.task(ctx, project.key, created.id)}`,
      data: { id: created.id, key, url: url.task(ctx, project.key, created.id) },
    };
  },
});

interface NewTask {
  project_id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  due_date: string | null;
  start_date: string | null;
  milestone?: boolean;
  recurrence?: string | null;
  label_ids?: string[];
}

/** Insère une tâche en fin de projet (numéro attribué par le déclencheur), avec ses étiquettes. */
async function insertTask(ctx: McpContext, t: NewTask) {
  const last = (await ctx.db.from("tasks").select("position").eq("project_id", t.project_id).order("position", { ascending: false }).limit(1)).data;
  const { label_ids, ...rest } = t;
  const row = must(
    await ctx.db
      .from("tasks")
      .insert({ ...rest, workspace_id: ctx.workspace.id, position: (last?.[0]?.position ?? 0) + 1000, created_by: ctx.user.id } as never)
      .select("id, number, title")
      .single(),
    "Création de la tâche",
  ) as { id: string; number: number; title: string };
  if (label_ids?.length) await ctx.db.from("task_labels").insert(label_ids.map((label_id) => ({ task_id: row.id, label_id })));
  return row;
}

function shiftDay(d: string | null, r: string) {
  if (!d) return null;
  const x = parseDay(d)!;
  if (r === "monthly") return iso(new Date(x.getFullYear(), x.getMonth() + 1, x.getDate()));
  return iso(addDays(x, { daily: 1, weekly: 7, biweekly: 14 }[r] ?? 7));
}

const updateTask = defineTool({
  name: "update_task",
  title: "Modifier une tâche",
  description: `Modifie une tâche (clé ACME-12 ou identifiant) : titre, description, statut (${STATUS_HELP}), priorité, responsable (« none » pour retirer), dates (null pour effacer), étiquettes (remplacer, ajouter ou retirer), archivage. Seuls les champs fournis changent. Terminer une tâche récurrente crée l'occurrence suivante.`,
  write: true,
  idempotent: true,
  input: z.object({
    task: z.string().describe("Clé (ex. ACME-12) ou identifiant"),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(20000).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignee: z.string().nullable().optional().describe("« me », nom, email, ou null / « none » pour retirer"),
    due_date: zDate("Échéance").nullable().optional(),
    start_date: zDate("Début").nullable().optional(),
    labels: z.array(z.string()).optional().describe("Remplace toutes les étiquettes"),
    add_labels: z.array(z.string()).optional(),
    remove_labels: z.array(z.string()).optional(),
    milestone: z.boolean().optional(),
    archived: z.boolean().optional().describe("true pour archiver, false pour désarchiver"),
  }),
  run: async (a, ctx) => {
    const { task: t, project, key } = await resolveTask(ctx, a.task);
    const patch: Record<string, unknown> = {};
    if (a.title !== undefined) patch.title = a.title.trim();
    if (a.description !== undefined) patch.description = a.description;
    if (a.status !== undefined) patch.status = a.status;
    if (a.priority !== undefined) patch.priority = a.priority;
    const assignee = await resolveAssignee(ctx, a.assignee);
    if (assignee !== undefined) patch.assignee_id = assignee;
    if (a.due_date !== undefined) patch.due_date = parseDateInput(a.due_date, "due_date");
    if (a.start_date !== undefined) patch.start_date = parseDateInput(a.start_date, "start_date");
    if (a.milestone !== undefined) patch.milestone = a.milestone;
    if (a.archived !== undefined) patch.archived_at = a.archived ? new Date().toISOString() : null;
    const labelOps = a.labels !== undefined || a.add_labels?.length || a.remove_labels?.length;
    if (!Object.keys(patch).length && !labelOps) throw new ToolError("Aucun champ à modifier.");

    if (Object.keys(patch).length) must(await ctx.db.from("tasks").update(patch as never).eq("id", t.id).eq("workspace_id", ctx.workspace.id), "Mise à jour de la tâche");

    const changes: string[] = [];
    if (labelOps) {
      const current = must(await ctx.db.from("task_labels").select("label_id").eq("task_id", t.id)).map((x) => x.label_id);
      let next = new Set(current);
      if (a.labels !== undefined) next = new Set((await resolveLabels(ctx, a.labels)).map((l) => l.id));
      for (const l of a.add_labels?.length ? await resolveLabels(ctx, a.add_labels) : []) next.add(l.id);
      for (const l of a.remove_labels?.length ? await resolveLabels(ctx, a.remove_labels) : []) next.delete(l.id);
      const add = [...next].filter((x) => !current.includes(x));
      const del = current.filter((x) => !next.has(x));
      if (del.length) await ctx.db.from("task_labels").delete().eq("task_id", t.id).in("label_id", del);
      if (add.length) await ctx.db.from("task_labels").insert(add.map((label_id) => ({ task_id: t.id, label_id })));
      const ls = await labels(ctx);
      changes.push(`étiquettes : ${[...next].map((id) => ls.find((l) => l.id === id)?.name).join(", ") || "aucune"}`);
    }

    const meta = { title: (patch.title as string) ?? t.title, key };
    if (a.status && a.status !== t.status) {
      await ctx.log({ verb: a.status === "done" ? "task.completed" : "task.status", project_id: t.project_id, task_id: t.id, meta: { ...meta, from: t.status, to: a.status } });
      changes.push(`statut : ${statusName(t.status)} → ${statusName(a.status)}`);
    }
    if (assignee !== undefined && assignee !== t.assignee_id) {
      await ctx.log({ verb: "task.assigned", project_id: t.project_id, task_id: t.id, meta: { ...meta, from: t.assignee_id, to: assignee } });
      changes.push(`responsable : ${(await memberName(ctx, assignee)) ?? "aucun"}`);
    }
    for (const k of ["title", "description", "priority", "due_date", "start_date", "milestone", "archived_at"] as const)
      if (k in patch) changes.push(k === "priority" ? `priorité : ${priorityName(String(patch[k]))}` : k === "archived_at" ? (patch[k] ? "archivée" : "désarchivée") : k === "description" ? "description mise à jour" : `${k} : ${patch[k] ?? "effacé"}`);

    // Tâche récurrente terminée : occurrence suivante
    let next: string | null = null;
    if (a.status === "done" && t.status !== "done" && t.recurrence) {
      const tl = must(await ctx.db.from("task_labels").select("label_id").eq("task_id", t.id)).map((x) => x.label_id);
      const n = await insertTask(ctx, {
        project_id: t.project_id, title: t.title, description: t.description, status: "todo", priority: t.priority,
        assignee_id: t.assignee_id, start_date: shiftDay(t.start_date, t.recurrence), due_date: shiftDay(t.due_date ?? iso(today()), t.recurrence),
        recurrence: t.recurrence, milestone: t.milestone, label_ids: tl,
      });
      await ctx.db.from("tasks").update({ recurrence: null }).eq("id", t.id);
      next = `${project.key}-${n.number}`;
      changes.push(`occurrence suivante créée : ${next}`);
    }
    return {
      text: `Tâche **${key}** mise à jour : ${changes.join(" ; ")}.\n${url.task(ctx, project.key, t.id)}`,
      data: { id: t.id, key, changes, next_occurrence: next, url: url.task(ctx, project.key, t.id) },
    };
  },
});

const addComment = defineTool({
  name: "add_comment",
  title: "Commenter une tâche",
  description: "Ajoute un commentaire (Markdown) sur une tâche, au nom de l'utilisateur du jeton. Le responsable et l'auteur de la tâche sont notifiés.",
  write: true,
  input: z.object({
    task: z.string().describe("Clé (ex. ACME-12) ou identifiant"),
    body: z.string().min(1).max(10000),
  }),
  run: async ({ task, body }, ctx) => {
    const { task: t, project, key } = await resolveTask(ctx, task);
    const c = must(
      await ctx.db.from("comments").insert({ workspace_id: ctx.workspace.id, task_id: t.id, author_id: ctx.user.id, body: body.trim() }).select("id").single(),
      "Ajout du commentaire",
    );
    await ctx.log({ verb: "task.commented", project_id: t.project_id, task_id: t.id, meta: { title: t.title, key, excerpt: body.trim().slice(0, 140) } });
    return { text: `Commentaire ajouté sur **${key}**.\n${url.task(ctx, project.key, t.id)}`, data: { id: c.id, task: key } };
  },
});

export const taskTools = [listTasks, getTask, createTask, updateTask, addComment];
