import type { NextRequest } from "next/server";
import { z } from "zod";

import { emailEnabled } from "@/lib/email";
import { appOrigin, json, portalRecipients, sendClientNotice, type ClientNotice } from "@/lib/portal-admin/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { PortalFeature } from "@/lib/types";

const Body = z.object({ kind: z.enum(["task", "creative", "report"]), ids: z.array(z.string().uuid()).min(1).max(50) });

interface Group {
  workspace: string;
  company: string;
  titles: string[];
  ids: string[];
}

/**
 * POST /api/portal-admin/notify : email récapitulatif vers le client quand l'agence lui demande une
 * validation (tâche, créa) ou publie un rapport. Appelé par l'app après l'action ; la notification
 * dans le portail est créée par les triggers de la base, que l'email soit configuré ou non.
 *
 * L'état est relu en base avec les droits du membre connecté : on n'envoie rien pour une tâche
 * masquée, une créa non soumise ou un rapport non publié.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requête invalide" }, 400);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "Connexion requise" }, 401);
  if (!emailEnabled()) return json({ sent: 0, emailEnabled: false });
  const { kind, ids } = parsed.data;

  // Éléments réellement concernés, regroupés par client
  const groups = new Map<string, Group>();
  const add = (workspace: string, company: string | null, title: string, id: string) => {
    if (!company) return;
    const g = groups.get(company) ?? { workspace, company, titles: [], ids: [] };
    g.titles.push(title);
    g.ids.push(id);
    groups.set(company, g);
  };
  if (kind === "task") {
    const { data } = await sb
      .from("tasks")
      .select("id, title, workspace_id, status, client_visible, archived_at, project:projects(company_id, portal_mode, archived_at)")
      .in("id", ids);
    for (const t of data ?? []) {
      const p = t.project as unknown as { company_id: string | null; portal_mode: string; archived_at: string | null } | null;
      const visible = !!p && !p.archived_at && !t.archived_at && (p.portal_mode === "all" || (p.portal_mode === "selected" && t.client_visible));
      if (t.status === "review" && visible) add(t.workspace_id, p!.company_id, t.title, t.id);
    }
  } else if (kind === "creative") {
    const { data } = await sb.from("creative_concepts").select("id, title, workspace_id, company_id, client_review").in("id", ids);
    for (const c of data ?? []) if (c.client_review === "pending") add(c.workspace_id, c.company_id, c.title, c.id);
  } else {
    const { data } = await sb.from("reports").select("id, title, workspace_id, company_id, shared").in("id", ids);
    for (const r of data ?? []) if (r.shared) add(r.workspace_id, r.company_id, r.title, r.id);
  }
  if (!groups.size) return json({ sent: 0, emailEnabled: true });

  const feature: PortalFeature = kind === "task" ? "tasks" : kind === "creative" ? "creatives" : "reporting";
  const { data: me } = await sb.from("profiles").select("email").eq("id", auth.user.id).single();
  let sent = 0;
  let error: string | undefined;
  for (const g of groups.values()) {
    const { data: canWrite } = await sb.rpc("can_write", { ws: g.workspace });
    if (!canWrite) return json({ error: "Réservé aux membres de l'espace" }, 403);
    const to = await portalRecipients(sb, g.company, feature);
    if (!to.length) continue;
    const { data: ws } = await sb.from("workspaces").select("name, slug").eq("id", g.workspace).single();
    if (!ws) continue;
    const n = g.titles.length;
    const one = n === 1;
    const notice: ClientNotice =
      kind === "task"
        ? {
            subject: one ? `À valider : ${g.titles[0]}` : `${n} éléments attendent votre validation`,
            title: one ? "Un élément attend votre validation" : "Des éléments attendent votre validation",
            intro: `${ws.name} a besoin de votre retour pour avancer. Vous pouvez valider ou demander une modification en un clic depuis votre espace client.`,
            items: g.titles,
            cta: { label: "Ouvrir mon espace client", link: one ? `tasks?task=${g.ids[0]}` : "tasks" },
          }
        : kind === "creative"
          ? {
              subject: one ? `Créa à valider : ${g.titles[0]}` : `${n} créas à valider`,
              title: one ? "Une créa attend votre validation" : "Des créas attendent votre validation",
              intro: `${ws.name} vous propose ${one ? "une nouvelle créa" : "de nouvelles créas"}. Vous pouvez l'approuver ou demander des modifications depuis votre espace client.`,
              items: g.titles,
              cta: { label: one ? "Voir la créa" : "Voir les créas", link: one ? `creatives?c=${g.ids[0]}` : "creatives" },
            }
          : {
              subject: one ? `Nouveau rapport : ${g.titles[0]}` : `${n} nouveaux rapports disponibles`,
              title: one ? "Votre rapport est disponible" : "Vos rapports sont disponibles",
              intro: `${ws.name} vient de publier ${one ? "un rapport" : "des rapports"} dans votre espace client.`,
              items: g.titles,
              cta: { label: one ? "Consulter le rapport" : "Consulter les rapports", link: one ? `performance?report=${g.ids[0]}` : "performance" },
            };
    const r = await sendClientNotice({ to, agency: ws.name, origin: appOrigin(req), slug: ws.slug, companyId: g.company, notice, replyTo: me?.email });
    sent += r.sent;
    error = r.error ?? error;
  }
  return json({ sent, error, emailEnabled: true });
}
