// Outils Portail client : état des portails et partage d'une tâche avec le client.
import { z } from "zod";

import { PORTAL_FEATURE, PORTAL_MODE, sortFeatures } from "@/lib/portal-admin/features";
import type { PortalMode } from "@/lib/types";
import { companiesLite, day, must, plural, resolveCompany, resolveTask, table, url } from "../helpers";
import { ToolError, defineTool } from "../types";

const listClientPortals = defineTool({
  name: "list_client_portals",
  title: "Lister les portails clients",
  description:
    "Liste les portails clients de l'espace : activé ou non, fonctionnalités ouvertes, personnes ayant accès, dernière connexion, invitations en attente, créas en attente de validation et modifications demandées par le client. Filtre facultatif sur un client.",
  input: z.object({
    company: z.string().optional().describe("Client : nom ou identifiant"),
    enabled_only: z.boolean().default(false).describe("Seulement les portails activés"),
  }),
  run: async (a, ctx) => {
    const ws = ctx.workspace.id;
    const only = a.company ? (await resolveCompany(ctx, a.company)).id : null;
    let q = ctx.db.from("client_portals").select("company_id, enabled, features, welcome, updated_at").eq("workspace_id", ws);
    if (only) q = q.eq("company_id", only);
    if (a.enabled_only) q = q.eq("enabled", true);
    const portals = must(await q, "Lecture des portails");
    if (!portals.length) return { text: only ? "Ce client n'a pas encore de portail." : "Aucun portail client configuré dans cet espace.", data: { portals: [] } };
    const ids = portals.map((p) => p.company_id);
    const [users, invites, concepts] = await Promise.all([
      ctx.db.from("client_users").select("company_id, last_seen_at, profile:profiles(full_name, email)").eq("workspace_id", ws).in("company_id", ids),
      ctx.db.from("client_invitations").select("company_id, email").eq("workspace_id", ws).in("company_id", ids).is("accepted_at", null).is("revoked_at", null),
      ctx.db.from("creative_concepts").select("company_id, client_review").eq("workspace_id", ws).in("company_id", ids).not("client_review", "is", null),
    ]);
    const names = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const items = portals
      .map((p) => {
        const people = (users.data ?? []).filter((u) => u.company_id === p.company_id);
        const seen = people.map((u) => u.last_seen_at).filter(Boolean).sort().at(-1) ?? null;
        return {
          company_id: p.company_id,
          company: names.get(p.company_id) ?? "?",
          enabled: p.enabled,
          features: sortFeatures(p.features),
          people: people.map((u) => {
            const pr = u.profile as unknown as { full_name: string; email: string } | null;
            return { name: pr?.full_name || pr?.email || "?", email: pr?.email ?? "", last_seen_at: u.last_seen_at };
          }),
          pending_invitations: (invites.data ?? []).filter((i) => i.company_id === p.company_id).map((i) => i.email),
          last_seen_at: seen,
          creatives_pending: (concepts.data ?? []).filter((c) => c.company_id === p.company_id && c.client_review === "pending").length,
          changes_requested: (concepts.data ?? []).filter((c) => c.company_id === p.company_id && c.client_review === "changes").length,
          settings_url: `${url.company(ctx, p.company_id)}?tab=portal`,
        };
      })
      .sort((x, y) => x.company.localeCompare(y.company, "fr"));
    return {
      text:
        `${plural(items.length, "portail client", "portails clients")}\n` +
        table(
          ["Client", "Portail", "Fonctionnalités", "Personnes", "Invitations", "Dernière connexion", "Créas en attente", "Modifications demandées"],
          items.map((i) => [
            i.company,
            i.enabled ? "Activé" : "Désactivé",
            i.features.map((f) => PORTAL_FEATURE[f].name).join(", ") || "Aucune",
            i.people.map((u) => u.name).join(", ") || "Personne",
            i.pending_invitations.length,
            i.last_seen_at ? day(i.last_seen_at) : "Jamais",
            i.creatives_pending,
            i.changes_requested,
          ]),
        ),
      data: { portals: items },
    };
  },
});

const setTaskClientVisibility = defineTool({
  name: "set_task_client_visibility",
  title: "Rendre une tâche visible ou non par le client",
  description:
    "Coche ou décoche « Visible par le client » sur une tâche (portail client). N'a d'effet que si le projet est rattaché à un client et partage ses « tâches cochées » ; le client ne voit jamais les commentaires internes. Une tâche visible en « Validation client » déclenche une notification au client.",
  input: z.object({
    task: z.string().describe("Tâche : clé (ex. LUM-12) ou identifiant"),
    visible: z.boolean().describe("true = visible par le client, false = masquée"),
  }),
  write: true,
  idempotent: true,
  run: async (a, ctx) => {
    const { task, project, key } = await resolveTask(ctx, a.task);
    const p = must(await ctx.db.from("projects").select("company_id, portal_mode").eq("id", project.id).eq("workspace_id", ctx.workspace.id).single(), "Lecture du projet");
    if (!p.company_id) throw new ToolError(`Le projet ${project.name} n'est rattaché à aucun client : ses tâches ne peuvent pas être partagées sur un portail.`);
    const mode = p.portal_mode as PortalMode;
    must(await ctx.db.from("tasks").update({ client_visible: a.visible }).eq("id", task.id).eq("workspace_id", ctx.workspace.id).select("id"), "Mise à jour de la tâche");
    const { data: portal } = await ctx.db.from("client_portals").select("enabled, features").eq("company_id", p.company_id).maybeSingle();
    const effective = mode === "all" || (mode === "selected" && a.visible);
    const notes: string[] = [];
    if (mode !== "selected") notes.push(`Le projet est en mode « ${PORTAL_MODE[mode].name} » : ${mode === "all" ? "toutes ses tâches sont déjà visibles" : "aucune tâche n'est montrée au client"}, quel que soit ce réglage.`);
    if (effective && !portal?.enabled) notes.push("Le portail de ce client n'est pas activé : il ne voit rien pour l'instant.");
    else if (effective && !portal?.features.includes("tasks")) notes.push("La fonctionnalité « Projet et tâches » n'est pas ouverte sur le portail de ce client.");
    return {
      text: `${key} « ${task.title} » : ${a.visible ? "cochée visible par le client" : "masquée au client"}.${notes.length ? "\n" + notes.join("\n") : ""}\n${url.task(ctx, project.key, task.id)}`,
      data: { id: task.id, key, client_visible: a.visible, visible_on_portal: effective && !!portal?.enabled && portal.features.includes("tasks"), portal_mode: mode },
    };
  },
});

export const portalTools = [listClientPortals, setTaskClientVisibility];
