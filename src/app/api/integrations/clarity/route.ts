import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/ads/guard";
import { clarityProjectId, clarityTokenInfo, isClarityProjectId } from "@/lib/analytics/clarity-rows";
import { syncClaritySource, type SyncSource } from "@/lib/analytics/sync";
import { supabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({
  workspace_id: z.string().uuid(),
  company_id: z.string().uuid().nullable().optional(),
  project_id: z.string().min(1).max(200),
  name: z.string().max(80).optional(),
  token: z.string().min(20).max(4000),
});

/**
 * POST /api/integrations/clarity : ajoute un projet Microsoft Clarity (admins de l'espace).
 * Le jeton API est rangé côté serveur (analytics_secrets) et n'est jamais renvoyé au navigateur.
 * Sa validité est confirmée par la première synchro, lancée aussitôt (3 des 10 requêtes du jour).
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const b = parsed.data;
  const g = await guard({ id: b.workspace_id }, "admin");
  if (g instanceof NextResponse) return g;

  const projectId = clarityProjectId(b.project_id);
  if (!isClarityProjectId(projectId))
    return NextResponse.json({ error: "Identifiant de projet invalide : copie-le depuis l'adresse du projet dans Clarity (clarity.microsoft.com/projects/view/<identifiant>/…)." }, { status: 400 });
  const token = b.token.trim();
  const info = clarityTokenInfo(token);
  if (!info.ok) return NextResponse.json({ error: info.error }, { status: 400 });

  const admin = supabaseAdmin();
  if (b.company_id) {
    const { data: c } = await admin.from("companies").select("id").eq("id", b.company_id).eq("workspace_id", g.workspace.id).maybeSingle();
    if (!c) return NextResponse.json({ error: "Client introuvable dans cet espace" }, { status: 400 });
  }
  const { data: dup } = await admin.from("analytics_sources").select("id").eq("workspace_id", g.workspace.id).eq("kind", "clarity").eq("external_id", projectId).maybeSingle();
  if (dup) return NextResponse.json({ error: "Ce projet Clarity est déjà ajouté." }, { status: 409 });

  const created = await admin
    .from("analytics_sources")
    .insert({
      workspace_id: g.workspace.id,
      company_id: b.company_id ?? null,
      kind: "clarity",
      external_id: projectId,
      name: b.name?.trim() || `Projet ${projectId}`,
      settings: { token_exp: info.exp },
      created_by: g.userId,
    })
    .select("id, workspace_id, kind, connection_id, external_id, name, settings, first_synced_at, last_synced_at")
    .single();
  if (created.error) return NextResponse.json({ error: created.error.message }, { status: 500 });
  const src = created.data as SyncSource;
  const secret = await admin.from("analytics_secrets").insert({ source_id: src.id, workspace_id: g.workspace.id, token });
  if (secret.error) {
    await admin.from("analytics_sources").delete().eq("id", src.id);
    return NextResponse.json({ error: secret.error.message }, { status: 500 });
  }

  const res = await syncClaritySource(admin, src, token);
  // Jeton refusé par Clarity : le projet n'est pas gardé
  if (!res.ok && res.code === "token") {
    await admin.from("analytics_sources").delete().eq("id", src.id);
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ id: src.id, rows: res.rows ?? 0, warning: res.ok ? null : res.error });
}
