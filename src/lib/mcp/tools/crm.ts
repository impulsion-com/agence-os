// Outils CRM : deals (pipeline), clients, contacts, activités commerciales.
import { z } from "zod";

import { DEAL_SOURCES, INDUSTRIES } from "@/lib/constants";
import { iso, today } from "@/lib/format";
import {
  companiesLite, day, likeSafe, memberName, money, must, norm, parseDateInput, plural, resolveCompany, resolveContact, resolveDeal,
  resolveMember, resolveStage, stages, table, truncate, url, zDate,
} from "../helpers";
import { ToolError, defineTool, type McpContext } from "../types";

const COMPANY_STATUS: Record<string, string> = { lead: "Prospect", client: "Client", former: "Ancien client" };
const KIND_NAME: Record<string, string> = { note: "Note", call: "Appel", email: "Email", meeting: "Rendez-vous", task: "Relance" };
const billingName = (b: string) => (b === "monthly" ? "/mois" : "");
const contactName = (c: { first_name: string; last_name: string; email?: string }) => `${c.first_name} ${c.last_name}`.trim() || c.email || "(sans nom)";

// ---------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------
const listDeals = defineTool({
  name: "list_deals",
  title: "Lister les deals",
  description:
    "Liste les deals du pipeline commercial avec étape, valeur, responsable, client et date de signature prévue. Par défaut les deals ouverts. Donne aussi la valeur totale et la valeur pondérée par la probabilité des étapes.",
  input: z.object({
    status: z.enum(["open", "won", "lost", "all"]).default("open"),
    stage: z.string().optional().describe("Étape (nom ou identifiant)"),
    owner: z.string().optional().describe("Responsable : « me », nom ou email"),
    company: z.string().optional().describe("Client (nom ou identifiant)"),
    query: z.string().max(80).optional().describe("Texte dans le titre"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (a, ctx) => {
    const st = await stages(ctx);
    let q = ctx.db.from("deals").select("id, title, company_id, contact_id, stage_id, owner_id, value, billing, expected_close, closed_at, created_at, source").eq("workspace_id", ctx.workspace.id);
    if (a.stage) q = q.eq("stage_id", (await resolveStage(ctx, a.stage)).id);
    else if (a.status !== "all") {
      const ids = st.filter((s) => s.kind === a.status).map((s) => s.id);
      q = a.status === "open" ? q.or(`stage_id.is.null,stage_id.in.(${ids.join(",") || "00000000-0000-0000-0000-000000000000"})`) : q.in("stage_id", ids);
    }
    if (a.owner) q = q.eq("owner_id", (await resolveMember(ctx, a.owner)).id);
    if (a.company) q = q.eq("company_id", (await resolveCompany(ctx, a.company)).id);
    if (a.query) q = q.ilike("title", `%${likeSafe(a.query)}%`);
    const rows = must(await q.order("created_at", { ascending: false }).limit(a.limit), "Lecture des deals");
    const cos = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const stage = new Map(st.map((s) => [s.id, s]));
    const items = await Promise.all(
      rows.map(async (d) => ({
        id: d.id,
        title: d.title,
        company: cos.get(d.company_id ?? "") ?? null,
        stage: stage.get(d.stage_id ?? "")?.name ?? "Sans étape",
        probability: stage.get(d.stage_id ?? "")?.probability ?? 0,
        value: Number(d.value),
        billing: d.billing,
        owner: await memberName(ctx, d.owner_id),
        expected_close: d.expected_close,
        closed_at: d.closed_at,
      })),
    );
    if (!items.length) return { text: "Aucun deal ne correspond.", data: { deals: [] } };
    const cur = ctx.workspace.currency;
    const total = items.reduce((s, d) => s + d.value, 0);
    const weighted = items.reduce((s, d) => s + (d.value * d.probability) / 100, 0);
    const late = items.filter((d) => !d.closed_at && d.expected_close && d.expected_close < iso(today())).length;
    return {
      text:
        `${plural(items.length, "deal")} · valeur ${money(total, cur)}${a.status === "open" ? ` · pondérée ${money(weighted, cur)}` : ""}${late ? ` · ${late} en retard sur la date prévue` : ""}\n` +
        table(
          ["Deal", "Client", "Étape", "Valeur", "Responsable", a.status === "open" ? "Signature prévue" : "Clos le", "Id"],
          items.map((d) => [truncate(d.title, 60), d.company, d.stage, money(d.value, cur) + billingName(d.billing), d.owner, a.status === "open" ? d.expected_close : d.closed_at?.slice(0, 10) ?? d.expected_close, d.id]),
        ),
      data: { deals: items, total, weighted },
    };
  },
});

const getDeal = defineTool({
  name: "get_deal",
  title: "Détail d'un deal",
  description: "Détail d'un deal (titre ou identifiant) : client, contact, étape, valeur, services, source, dates, activités commerciales récentes et propositions liées.",
  input: z.object({ deal: z.string().describe("Titre ou identifiant du deal") }),
  run: async ({ deal }, ctx) => {
    const d = await resolveDeal(ctx, deal);
    const [acts, props, contact] = await Promise.all([
      ctx.db.from("crm_activities").select("kind, body, due_at, done, author_id, created_at").eq("workspace_id", ctx.workspace.id).eq("deal_id", d.id).order("created_at", { ascending: false }).limit(15),
      ctx.db.from("proposals").select("id, number, title, status").eq("workspace_id", ctx.workspace.id).eq("deal_id", d.id),
      d.contact_id ? ctx.db.from("contacts").select("first_name, last_name, email, phone").eq("id", d.contact_id).eq("workspace_id", ctx.workspace.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const st = (await stages(ctx)).find((s) => s.id === d.stage_id);
    const company = (await companiesLite(ctx)).find((c) => c.id === d.company_id);
    const cur = ctx.workspace.currency;
    const actLines = await Promise.all(
      (acts.data ?? []).map(async (x) => `- ${x.created_at.slice(0, 10)} · ${KIND_NAME[x.kind] ?? x.kind}${x.kind === "task" ? ` (${x.done ? "faite" : `à faire${x.due_at ? ` le ${x.due_at.slice(0, 10)}` : ""}`})` : ""} · ${(await memberName(ctx, x.author_id)) ?? "?"} : ${truncate(x.body, 300)}`),
    );
    const c = contact.data as { first_name: string; last_name: string; email: string; phone: string } | null;
    const text = [
      `# ${d.title}`,
      `Étape : ${st?.name ?? "sans étape"}${st?.kind === "open" ? ` (${st.probability} %)` : ""} · Valeur : ${money(Number(d.value), cur)}${billingName(d.billing)} · Responsable : ${(await memberName(ctx, d.owner_id)) ?? "aucun"}`,
      `Client : ${company?.name ?? "aucun"}${c ? ` · Contact : ${contactName(c)}${c.email ? ` <${c.email}>` : ""}${c.phone ? ` ${c.phone}` : ""}` : ""}`,
      `Source : ${d.source || "-"} · Services : ${d.services.join(", ") || "-"} · Signature prévue : ${day(d.expected_close)}${d.closed_at ? ` · Clos le ${d.closed_at.slice(0, 10)}` : ""}${d.lost_reason ? ` · Raison de la perte : ${d.lost_reason}` : ""}`,
      (props.data ?? []).length ? `\n## Propositions\n${(props.data ?? []).map((p) => `- #${p.number} ${p.title} (${p.status}) ${url.proposal(ctx, p.id)}`).join("\n")}` : "",
      actLines.length ? `\n## Activités récentes\n${actLines.join("\n")}` : "\nAucune activité commerciale.",
      `\n${url.deal(ctx, d.id)}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text,
      data: {
        deal: { id: d.id, title: d.title, stage: st?.name ?? null, stage_kind: st?.kind ?? null, value: Number(d.value), billing: d.billing, company: company?.name ?? null, source: d.source, services: d.services, expected_close: d.expected_close, closed_at: d.closed_at },
        activities: acts.data ?? [],
        proposals: props.data ?? [],
        url: url.deal(ctx, d.id),
      },
    };
  },
});

const createDeal = defineTool({
  name: "create_deal",
  title: "Créer un deal",
  description: `Crée un deal dans le pipeline. Étape par défaut : la première étape ouverte. Sources usuelles : ${DEAL_SOURCES.join(", ")}.`,
  write: true,
  input: z.object({
    title: z.string().min(1).max(200),
    company: z.string().optional().describe("Client existant (nom ou identifiant) ; utilise create_company avant si besoin"),
    contact: z.string().optional().describe("Contact existant (nom, email ou identifiant)"),
    stage: z.string().optional().describe("Étape (nom ou identifiant)"),
    owner: z.string().optional().describe("Responsable (« me » par défaut)"),
    value: z.number().min(0).default(0).describe("Montant du deal"),
    billing: z.enum(["monthly", "one_off"]).default("monthly").describe("monthly = récurrent mensuel, one_off = ponctuel"),
    source: z.string().max(80).optional(),
    services: z.array(z.string().max(80)).max(20).optional().describe("Services concernés (noms du catalogue)"),
    expected_close: zDate("Date de signature prévue").optional(),
  }),
  run: async (a, ctx) => {
    const st = await stages(ctx);
    const stage = a.stage ? await resolveStage(ctx, a.stage) : st.find((s) => s.kind === "open") ?? st[0];
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    const contact = a.contact ? await resolveContact(ctx, a.contact) : null;
    const owner = a.owner ? await resolveMember(ctx, a.owner) : { id: ctx.user.id };
    const { data: last } = stage
      ? await ctx.db.from("deals").select("position").eq("workspace_id", ctx.workspace.id).eq("stage_id", stage.id).order("position", { ascending: false }).limit(1)
      : { data: null };
    const d = must(
      await ctx.db
        .from("deals")
        .insert({
          workspace_id: ctx.workspace.id,
          title: a.title.trim(),
          company_id: company?.id ?? contact?.company_id ?? null,
          contact_id: contact?.id ?? null,
          stage_id: stage?.id ?? null,
          owner_id: owner.id,
          value: a.value,
          billing: a.billing,
          source: a.source ?? "",
          services: a.services ?? [],
          expected_close: parseDateInput(a.expected_close, "expected_close"),
          position: (last?.[0]?.position ?? 0) + 1000,
          closed_at: stage && stage.kind !== "open" ? new Date().toISOString() : null,
        })
        .select("id")
        .single(),
      "Création du deal",
    );
    await ctx.log({ verb: "deal.created", deal_id: d.id, meta: { title: a.title.trim(), value: a.value } });
    return {
      text: `Deal **${a.title.trim()}** créé à l'étape ${stage?.name ?? "-"} (${money(a.value, ctx.workspace.currency)}${billingName(a.billing)}).\n${url.deal(ctx, d.id)}`,
      data: { id: d.id, url: url.deal(ctx, d.id) },
    };
  },
});

const updateDeal = defineTool({
  name: "update_deal",
  title: "Modifier un deal",
  description:
    "Modifie un deal : étape (nom, ou « won » / « lost » pour gagné / perdu), valeur, responsable, date prévue, client, contact, titre, source. Passer en gagné renseigne la date de signature et passe le client en « Client » ; passer en perdu demande une raison (lost_reason). Demande confirmation à l'utilisateur avant de marquer un deal gagné ou perdu.",
  write: true,
  idempotent: true,
  input: z.object({
    deal: z.string().describe("Titre ou identifiant"),
    stage: z.string().optional().describe("Nouvelle étape : nom, identifiant, « won » ou « lost »"),
    lost_reason: z.string().max(500).optional(),
    title: z.string().min(1).max(200).optional(),
    value: z.number().min(0).optional(),
    billing: z.enum(["monthly", "one_off"]).optional(),
    owner: z.string().optional(),
    expected_close: zDate("Date de signature prévue").nullable().optional(),
    company: z.string().nullable().optional(),
    contact: z.string().nullable().optional(),
    source: z.string().max(80).optional(),
  }),
  run: async (a, ctx) => {
    const d = await resolveDeal(ctx, a.deal);
    const st = await stages(ctx);
    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    if (a.title !== undefined) patch.title = a.title.trim();
    if (a.value !== undefined) patch.value = a.value;
    if (a.billing !== undefined) patch.billing = a.billing;
    if (a.source !== undefined) patch.source = a.source;
    if (a.owner !== undefined) patch.owner_id = (await resolveMember(ctx, a.owner)).id;
    if (a.expected_close !== undefined) patch.expected_close = parseDateInput(a.expected_close, "expected_close");
    if (a.company !== undefined) patch.company_id = a.company ? (await resolveCompany(ctx, a.company)).id : null;
    if (a.contact !== undefined) patch.contact_id = a.contact ? (await resolveContact(ctx, a.contact)).id : null;
    for (const k of Object.keys(patch)) changes.push(k.replace("_id", ""));

    const prev = st.find((s) => s.id === d.stage_id);
    const stage = a.stage ? await resolveStage(ctx, a.stage) : null;
    const moving = stage && stage.id !== d.stage_id;
    if (moving) {
      if (stage.kind === "lost" && !a.lost_reason?.trim()) throw new ToolError("Indique la raison de la perte (lost_reason) pour marquer ce deal perdu.");
      patch.stage_id = stage.id;
      patch.closed_at = stage.kind === "open" ? null : new Date().toISOString();
      patch.lost_reason = stage.kind === "lost" ? a.lost_reason!.trim() : "";
    } else if (a.lost_reason !== undefined && prev?.kind === "lost") patch.lost_reason = a.lost_reason.trim();
    if (!Object.keys(patch).length) throw new ToolError("Aucun champ à modifier.");

    must(await ctx.db.from("deals").update(patch as never).eq("id", d.id).eq("workspace_id", ctx.workspace.id), "Mise à jour du deal");
    if (moving) {
      const verb = stage.kind === "won" ? "deal.won" : stage.kind === "lost" ? "deal.lost" : "deal.stage";
      await ctx.log({ verb, deal_id: d.id, meta: { title: (patch.title as string) ?? d.title, from: prev?.name ?? null, to: stage.name, value: Number(patch.value ?? d.value), reason: patch.lost_reason || null } });
      changes.unshift(`étape : ${prev?.name ?? "aucune"} → ${stage.name}`);
      const companyId = (patch.company_id as string | null | undefined) ?? d.company_id;
      if (stage.kind === "won" && companyId) {
        await ctx.db.from("companies").update({ status: "client" }).eq("id", companyId).eq("workspace_id", ctx.workspace.id).neq("status", "client");
        changes.push("client passé au statut Client");
      }
    }
    return {
      text: `Deal **${(patch.title as string) ?? d.title}** mis à jour : ${changes.join(", ")}.${moving && stage.kind === "won" ? " Pense à créer le projet d'onboarding (create_project avec le modèle onboarding) si l'utilisateur le souhaite." : ""}\n${url.deal(ctx, d.id)}`,
      data: { id: d.id, changes, url: url.deal(ctx, d.id) },
    };
  },
});

// ---------------------------------------------------------------------
// Clients (entreprises) et contacts
// ---------------------------------------------------------------------
const listCompanies = defineTool({
  name: "list_companies",
  title: "Lister les clients",
  description: "Liste les clients et prospects (entreprises) avec statut, secteur, responsable, forfait mensuel, deals ouverts et projets actifs.",
  input: z.object({
    status: z.enum(["lead", "client", "former"]).optional().describe("lead = prospect, client, former = ancien client"),
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(300).default(100),
  }),
  run: async (a, ctx) => {
    let q = ctx.db.from("companies").select("id, name, status, industry, owner_id, monthly_retainer, website").eq("workspace_id", ctx.workspace.id);
    if (a.status) q = q.eq("status", a.status);
    if (a.query) q = q.ilike("name", `%${likeSafe(a.query)}%`);
    const rows = must(await q.order("name").limit(a.limit), "Lecture des clients");
    const ids = rows.map((r) => r.id);
    const openStages = (await stages(ctx)).filter((s) => s.kind === "open").map((s) => s.id);
    const [deals, projects] = ids.length
      ? await Promise.all([
          ctx.db.from("deals").select("company_id, stage_id, value").eq("workspace_id", ctx.workspace.id).in("company_id", ids),
          ctx.db.from("projects").select("company_id, status").eq("workspace_id", ctx.workspace.id).in("company_id", ids).is("archived_at", null),
        ])
      : [{ data: [] }, { data: [] }];
    const cur = ctx.workspace.currency;
    const items = await Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        industry: c.industry,
        owner: await memberName(ctx, c.owner_id),
        monthly_retainer: c.monthly_retainer === null ? null : Number(c.monthly_retainer),
        open_deals: (deals.data ?? []).filter((d) => d.company_id === c.id && (!d.stage_id || openStages.includes(d.stage_id))).length,
        active_projects: (projects.data ?? []).filter((p) => p.company_id === c.id && p.status !== "complete").length,
      })),
    );
    if (!items.length) return { text: "Aucun client ne correspond.", data: { companies: [] } };
    return {
      text: table(
        ["Client", "Statut", "Secteur", "Responsable", "Forfait mensuel", "Deals ouverts", "Projets actifs", "Id"],
        items.map((c) => [c.name, COMPANY_STATUS[c.status], c.industry, c.owner, c.monthly_retainer !== null ? money(c.monthly_retainer, cur) : "", c.open_deals || "", c.active_projects || "", c.id]),
      ),
      data: { companies: items },
    };
  },
});

const getCompany = defineTool({
  name: "get_company",
  title: "Fiche client",
  description: "Fiche complète d'un client (nom ou identifiant) : coordonnées, contacts, deals, projets, comptes publicitaires rattachés, objectifs KPI et dernières activités commerciales.",
  input: z.object({ company: z.string().describe("Nom ou identifiant du client") }),
  run: async ({ company }, ctx) => {
    const ref = await resolveCompany(ctx, company);
    const ws = ctx.workspace.id;
    const [c, contacts, deals, projects, accounts, targets, acts] = await Promise.all([
      ctx.db.from("companies").select("*").eq("id", ref.id).eq("workspace_id", ws).single(),
      ctx.db.from("contacts").select("id, first_name, last_name, email, phone, job_title").eq("workspace_id", ws).eq("company_id", ref.id).order("first_name"),
      ctx.db.from("deals").select("id, title, stage_id, value, billing, closed_at").eq("workspace_id", ws).eq("company_id", ref.id).order("created_at", { ascending: false }),
      ctx.db.from("projects").select("key, name, status, archived_at").eq("workspace_id", ws).eq("company_id", ref.id).order("created_at", { ascending: false }),
      ctx.db.from("ad_accounts").select("platform, name, external_id, last_synced_at, sync_error").eq("workspace_id", ws).eq("company_id", ref.id),
      ctx.db.from("kpi_targets").select("metric, target").eq("workspace_id", ws).eq("company_id", ref.id),
      ctx.db.from("crm_activities").select("kind, body, created_at, author_id").eq("workspace_id", ws).eq("company_id", ref.id).order("created_at", { ascending: false }).limit(10),
    ]);
    const co = must(c, "Lecture du client");
    const st = new Map((await stages(ctx)).map((s) => [s.id, s.name]));
    const cur = ctx.workspace.currency;
    const text = [
      `# ${co.name} (${COMPANY_STATUS[co.status]})`,
      [co.industry && `Secteur : ${co.industry}`, co.website && `Site : ${co.website}`, co.monthly_retainer !== null && `Forfait : ${money(Number(co.monthly_retainer), cur)}/mois`, `Responsable : ${(await memberName(ctx, co.owner_id)) ?? "aucun"}`].filter(Boolean).join(" · "),
      co.notes ? `\n${co.notes}` : "",
      (contacts.data ?? []).length ? `\n## Contacts\n${(contacts.data ?? []).map((k) => `- ${contactName(k)}${k.job_title ? ` (${k.job_title})` : ""}${k.email ? ` <${k.email}>` : ""}${k.phone ? ` ${k.phone}` : ""}`).join("\n")}` : "",
      (deals.data ?? []).length ? `\n## Deals\n${(deals.data ?? []).map((d) => `- ${d.title} · ${st.get(d.stage_id ?? "") ?? "sans étape"} · ${money(Number(d.value), cur)}${billingName(d.billing)}`).join("\n")}` : "",
      (projects.data ?? []).length ? `\n## Projets\n${(projects.data ?? []).map((p) => `- ${p.key} · ${p.name} (${p.status}${p.archived_at ? ", archivé" : ""})`).join("\n")}` : "",
      (accounts.data ?? []).length ? `\n## Comptes publicitaires\n${(accounts.data ?? []).map((x) => `- ${x.platform} · ${x.name} (${x.external_id})${x.sync_error ? ` · erreur de synchro : ${x.sync_error}` : x.last_synced_at ? ` · synchro ${x.last_synced_at.slice(0, 10)}` : ""}`).join("\n")}` : "",
      (targets.data ?? []).length ? `\n## Objectifs\n${(targets.data ?? []).map((t) => `${t.metric.toUpperCase()} ${Number(t.target)}`).join(" · ")}` : "",
      (acts.data ?? []).length ? `\n## Dernières activités\n${(await Promise.all((acts.data ?? []).map(async (x) => `- ${x.created_at.slice(0, 10)} · ${KIND_NAME[x.kind]} · ${(await memberName(ctx, x.author_id)) ?? "?"} : ${truncate(x.body, 200)}`))).join("\n")}` : "",
      `\n${url.company(ctx, co.id)}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text,
      data: { company: co, contacts: contacts.data ?? [], deals: deals.data ?? [], projects: projects.data ?? [], ad_accounts: accounts.data ?? [], targets: targets.data ?? [], url: url.company(ctx, co.id) },
    };
  },
});

const createCompany = defineTool({
  name: "create_company",
  title: "Créer un client",
  description: `Crée une entreprise dans le CRM (prospect par défaut). Refuse un doublon de nom. Secteurs usuels : ${INDUSTRIES.join(", ")}.`,
  write: true,
  input: z.object({
    name: z.string().min(1).max(160),
    status: z.enum(["lead", "client", "former"]).default("lead"),
    website: z.string().max(300).optional(),
    industry: z.string().max(80).optional(),
    owner: z.string().optional().describe("Responsable (« me » par défaut)"),
    monthly_retainer: z.number().min(0).optional().describe("Forfait mensuel"),
    notes: z.string().max(5000).optional(),
  }),
  run: async (a, ctx) => {
    const existing = (await companiesLite(ctx)).find((c) => norm(c.name) === norm(a.name));
    if (existing) throw new ToolError(`Le client « ${existing.name} » existe déjà (id ${existing.id}).`);
    const owner = a.owner ? await resolveMember(ctx, a.owner) : { id: ctx.user.id };
    const c = must(
      await ctx.db
        .from("companies")
        .insert({ workspace_id: ctx.workspace.id, name: a.name.trim(), status: a.status, website: a.website ?? "", industry: a.industry ?? "", owner_id: owner.id, monthly_retainer: a.monthly_retainer ?? null, notes: a.notes ?? "" })
        .select("id")
        .single(),
      "Création du client",
    );
    ctx.cache.delete("companies");
    return { text: `Client **${a.name.trim()}** créé (${COMPANY_STATUS[a.status]}).\n${url.company(ctx, c.id)}`, data: { id: c.id, url: url.company(ctx, c.id) } };
  },
});

const listContacts = defineTool({
  name: "list_contacts",
  title: "Lister les contacts",
  description: "Liste les contacts (personnes) du CRM : nom, email, téléphone, poste, client.",
  input: z.object({
    company: z.string().optional().describe("Client (nom ou identifiant)"),
    query: z.string().max(80).optional().describe("Nom ou email"),
    limit: z.number().int().min(1).max(300).default(100),
  }),
  run: async (a, ctx) => {
    let q = ctx.db.from("contacts").select("id, first_name, last_name, email, phone, job_title, company_id").eq("workspace_id", ctx.workspace.id);
    if (a.company) q = q.eq("company_id", (await resolveCompany(ctx, a.company)).id);
    if (a.query) {
      const s = likeSafe(a.query);
      q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const rows = must(await q.order("first_name").limit(a.limit), "Lecture des contacts");
    const cos = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    if (!rows.length) return { text: "Aucun contact ne correspond.", data: { contacts: [] } };
    return {
      text: table(["Nom", "Email", "Téléphone", "Poste", "Client", "Id"], rows.map((c) => [contactName(c), c.email, c.phone, c.job_title, cos.get(c.company_id ?? "") ?? "", c.id])),
      data: { contacts: rows.map((c) => ({ ...c, company: cos.get(c.company_id ?? "") ?? null })) },
    };
  },
});

const createContact = defineTool({
  name: "create_contact",
  title: "Créer un contact",
  description: "Crée un contact dans le CRM, rattaché ou non à un client. Refuse un doublon d'email.",
  write: true,
  input: z.object({
    first_name: z.string().max(80).default(""),
    last_name: z.string().max(80).default(""),
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
    job_title: z.string().max(120).optional(),
    company: z.string().optional().describe("Client (nom ou identifiant)"),
    notes: z.string().max(5000).optional(),
  }),
  run: async (a, ctx) => {
    if (!a.first_name.trim() && !a.last_name.trim() && !a.email) throw new ToolError("Indique au moins un nom ou un email.");
    if (a.email) {
      const { data } = await ctx.db.from("contacts").select("id").eq("workspace_id", ctx.workspace.id).ilike("email", a.email).limit(1);
      if (data?.length) throw new ToolError(`Un contact avec l'email ${a.email} existe déjà (id ${data[0].id}).`);
    }
    const company = a.company ? await resolveCompany(ctx, a.company) : null;
    const c = must(
      await ctx.db
        .from("contacts")
        .insert({ workspace_id: ctx.workspace.id, first_name: a.first_name.trim(), last_name: a.last_name.trim(), email: a.email ?? "", phone: a.phone ?? "", job_title: a.job_title ?? "", company_id: company?.id ?? null, notes: a.notes ?? "" })
        .select("id")
        .single(),
      "Création du contact",
    );
    return { text: `Contact **${contactName({ first_name: a.first_name, last_name: a.last_name, email: a.email })}** créé${company ? ` chez ${company.name}` : ""}.\n${url.contact(ctx, c.id)}`, data: { id: c.id, url: url.contact(ctx, c.id) } };
  },
});

async function scopeOf(ctx: McpContext, a: { deal?: string; company?: string; contact?: string }) {
  const deal = a.deal ? await resolveDeal(ctx, a.deal) : null;
  const contact = a.contact ? await resolveContact(ctx, a.contact) : null;
  const company = a.company ? await resolveCompany(ctx, a.company) : null;
  return { deal_id: deal?.id ?? null, contact_id: contact?.id ?? null, company_id: company?.id ?? deal?.company_id ?? contact?.company_id ?? null, label: deal?.title ?? company?.name ?? (contact ? contactName(contact) : "") };
}

const addCrmActivity = defineTool({
  name: "add_crm_activity",
  title: "Ajouter une activité commerciale",
  description:
    "Ajoute une activité au CRM sur un deal, un client et/ou un contact : note, appel, email, rendez-vous (meeting) ou relance à faire (task, avec échéance). Au moins un deal, client ou contact est requis.",
  write: true,
  input: z.object({
    kind: z.enum(["note", "call", "email", "meeting", "task"]).describe("note, call (appel), email, meeting (rendez-vous), task (relance à faire)"),
    body: z.string().min(1).max(10000),
    deal: z.string().optional(),
    company: z.string().optional(),
    contact: z.string().optional(),
    due_date: zDate("Échéance de la relance (kind = task)").optional(),
  }),
  run: async (a, ctx) => {
    if (!a.deal && !a.company && !a.contact) throw new ToolError("Précise un deal, un client ou un contact.");
    const s = await scopeOf(ctx, a);
    const due = a.kind === "task" ? parseDateInput(a.due_date, "due_date") : null;
    const row = must(
      await ctx.db
        .from("crm_activities")
        .insert({
          workspace_id: ctx.workspace.id,
          kind: a.kind,
          body: a.body.trim(),
          due_at: due ? new Date(`${due}T09:00:00`).toISOString() : null,
          author_id: ctx.user.id,
          deal_id: s.deal_id,
          company_id: s.company_id,
          contact_id: s.contact_id,
        })
        .select("id")
        .single(),
      "Ajout de l'activité",
    );
    return { text: `${KIND_NAME[a.kind]} ajouté${a.kind === "task" || a.kind === "note" ? "e" : ""} sur ${s.label}${due ? ` (échéance ${due})` : ""}.`, data: { id: row.id } };
  },
});

export const crmTools = [listDeals, getDeal, createDeal, updateDeal, listCompanies, getCompany, createCompany, listContacts, createContact, addCrmActivity];
