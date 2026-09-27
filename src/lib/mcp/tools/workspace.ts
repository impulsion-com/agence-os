// Outils de l'espace : qui suis-je, recherche transversale.
import { z } from "zod";

import { ROLE_NAME, labels, likeSafe, members, money, plural, stages, statusName, table, url } from "../helpers";
import { defineTool } from "../types";

const whoami = defineTool({
  name: "whoami",
  title: "Espace et utilisateur",
  description:
    "Décrit l'espace de travail et l'utilisateur du jeton : rôle, droits (lecture seule ou écriture), membres (nom, email, rôle), étiquettes des tâches, étapes du pipeline commercial, catalogue de services, sites de tracking et presets UTM. À appeler en premier pour connaître les noms à utiliser dans les autres outils.",
  input: z.object({}),
  run: async (_args, ctx) => {
    const ws = ctx.workspace.id;
    const [ms, ls, st, services, sites, presets, projects] = await Promise.all([
      members(ctx),
      labels(ctx),
      stages(ctx),
      ctx.db.from("services").select("id, name, unit_price, billing").eq("workspace_id", ws).eq("archived", false).order("position"),
      ctx.db.from("tracking_sites").select("id, name, domains").eq("workspace_id", ws).order("name"),
      ctx.db.from("utm_presets").select("id, name").eq("workspace_id", ws).order("position"),
      ctx.db.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws).is("archived_at", null),
    ]);
    const cur = ctx.workspace.currency;
    const text = [
      `# ${ctx.workspace.name}`,
      `Tu es **${ctx.user.name}** (${ctx.user.email}), rôle ${ROLE_NAME[ctx.role]}. Jeton ${ctx.scope === "write" ? "lecture et écriture" : "lecture seule"}${ctx.canWrite ? "" : " : aucune écriture possible"}.`,
      `Devise : ${cur} · ${plural(projects.count ?? 0, "projet actif", "projets actifs")} · ${url.base(ctx)}`,
      "",
      "## Membres",
      table(["Nom", "Email", "Rôle"], ms.map((m) => [m.name, m.email, ROLE_NAME[m.role]])),
      "",
      `## Étiquettes : ${ls.map((l) => l.name).join(", ") || "aucune"}`,
      `## Statuts des tâches : ${["backlog", "todo", "progress", "review", "done"].map((s) => `${s} (${statusName(s)})`).join(", ")}`,
      `## Étapes du pipeline : ${st.map((s) => `${s.name}${s.kind !== "open" ? ` [${s.kind === "won" ? "gagné" : "perdu"}]` : ` ${s.probability} %`}`).join(" → ")}`,
      "",
      "## Services",
      table(["Service", "Prix", "Facturation"], (services.data ?? []).map((s) => [s.name, money(Number(s.unit_price), cur), s.billing === "monthly" ? "mensuel" : "ponctuel"])) || "Aucun service au catalogue.",
      "",
      `## Sites de tracking : ${(sites.data ?? []).map((s) => `${s.name} (${s.domains.join(", ") || "sans domaine"})`).join(" ; ") || "aucun"}`,
      `## Presets UTM : ${(presets.data ?? []).map((p) => p.name).join(", ") || "aucun"}`,
    ].join("\n");
    return {
      text,
      data: {
        workspace: ctx.workspace,
        user: { ...ctx.user, role: ctx.role },
        scope: ctx.scope,
        can_write: ctx.canWrite,
        members: ms,
        labels: ls.map((l) => ({ id: l.id, name: l.name })),
        stages: st.map((s) => ({ id: s.id, name: s.name, kind: s.kind, probability: s.probability })),
        services: (services.data ?? []).map((s) => ({ ...s, unit_price: Number(s.unit_price) })),
        tracking_sites: sites.data ?? [],
        utm_presets: presets.data ?? [],
      },
    };
  },
});

const KINDS = ["tasks", "projects", "companies", "contacts", "deals", "proposals"] as const;

const search = defineTool({
  name: "search",
  title: "Rechercher",
  description:
    "Recherche plein texte dans l'espace : tâches (titre), projets (nom, clé), clients (nom), contacts (nom, email), deals (titre) et propositions (titre). Renvoie les meilleurs résultats par type avec leurs références (clé de tâche, identifiants) pour enchaîner avec get_task, get_deal, etc.",
  input: z.object({
    query: z.string().min(2).max(80).describe("Texte recherché"),
    types: z.array(z.enum(KINDS)).optional().describe("Types à chercher (tous par défaut)"),
    limit: z.number().int().min(1).max(20).default(6).describe("Résultats maximum par type"),
  }),
  run: async ({ query, types, limit }, ctx) => {
    const q = likeSafe(query);
    const ws = ctx.workspace.id;
    const want = new Set(types?.length ? types : KINDS);
    const like = `%${q}%`;
    const none = Promise.resolve({ data: [] as never[] });
    const [tasks, projects, companies, contacts, deals, proposals] = await Promise.all([
      want.has("tasks") ? ctx.db.from("tasks").select("id, number, title, status, project_id, due_date").eq("workspace_id", ws).is("archived_at", null).ilike("title", like).order("updated_at", { ascending: false }).limit(limit) : none,
      want.has("projects") ? ctx.db.from("projects").select("id, key, name, status").eq("workspace_id", ws).or(`name.ilike.${like},key.ilike.${like}`).limit(limit) : none,
      want.has("companies") ? ctx.db.from("companies").select("id, name, status").eq("workspace_id", ws).ilike("name", like).limit(limit) : none,
      want.has("contacts") ? ctx.db.from("contacts").select("id, first_name, last_name, email, company_id").eq("workspace_id", ws).or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(limit) : none,
      want.has("deals") ? ctx.db.from("deals").select("id, title, value, stage_id").eq("workspace_id", ws).ilike("title", like).limit(limit) : none,
      want.has("proposals") ? ctx.db.from("proposals").select("id, number, title, status").eq("workspace_id", ws).ilike("title", like).limit(limit) : none,
    ]);
    const projectKeys = new Map((await ctx.db.from("projects").select("id, key").eq("workspace_id", ws)).data?.map((p) => [p.id, p.key]) ?? []);
    const st = new Map((await stages(ctx)).map((s) => [s.id, s.name]));
    const out: string[] = [];
    const data: Record<string, unknown[]> = {};
    const tk = (tasks.data ?? []) as { id: string; number: number; title: string; status: string; project_id: string; due_date: string | null }[];
    if (tk.length) {
      data.tasks = tk.map((t) => ({ id: t.id, key: `${projectKeys.get(t.project_id)}-${t.number}`, title: t.title, status: t.status, due_date: t.due_date }));
      out.push("## Tâches", ...tk.map((t) => `- ${projectKeys.get(t.project_id)}-${t.number} · ${t.title} (${statusName(t.status)}${t.due_date ? `, échéance ${t.due_date}` : ""})`));
    }
    const pj = (projects.data ?? []) as { id: string; key: string; name: string; status: string }[];
    if (pj.length) {
      data.projects = pj;
      out.push("## Projets", ...pj.map((p) => `- ${p.key} · ${p.name}`));
    }
    const co = (companies.data ?? []) as { id: string; name: string; status: string }[];
    if (co.length) {
      data.companies = co;
      out.push("## Clients", ...co.map((c) => `- ${c.name} (${c.status === "client" ? "client" : c.status === "lead" ? "prospect" : "ancien client"}) · id ${c.id}`));
    }
    const ct = (contacts.data ?? []) as { id: string; first_name: string; last_name: string; email: string }[];
    if (ct.length) {
      data.contacts = ct;
      out.push("## Contacts", ...ct.map((c) => `- ${`${c.first_name} ${c.last_name}`.trim() || "(sans nom)"} ${c.email ? `<${c.email}>` : ""} · id ${c.id}`));
    }
    const dl = (deals.data ?? []) as { id: string; title: string; value: number; stage_id: string | null }[];
    if (dl.length) {
      data.deals = dl;
      out.push("## Deals", ...dl.map((d) => `- ${d.title} · ${money(Number(d.value), ctx.workspace.currency)} · ${st.get(d.stage_id ?? "") ?? "sans étape"} · id ${d.id}`));
    }
    const pr = (proposals.data ?? []) as { id: string; number: number; title: string; status: string }[];
    if (pr.length) {
      data.proposals = pr;
      out.push("## Propositions", ...pr.map((p) => `- #${p.number} ${p.title} (${p.status})`));
    }
    return { text: out.length ? out.join("\n") : `Aucun résultat pour « ${query} ».`, data };
  },
});

export const workspaceTools = [whoami, search];
