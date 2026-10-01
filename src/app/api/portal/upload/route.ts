import { NextResponse, type NextRequest } from "next/server";

import { PORTAL_BUCKET, PORTAL_MAX_SIZE, isPortalUploadPath, portalUploadPath } from "@/lib/portal/files";
import { UUID } from "@/lib/portal/nav";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Message lisible pour le client ; un refus d'accès ne dit jamais pourquoi
const message = (e: { code?: string; message?: string } | null, fallback: string) =>
  e?.code === "22023" || (e?.code === "42501" && e.message?.startsWith("Aperçu")) ? e.message! : fallback;

type Target = { workspace_id: string; project_id: string };

/** Le projet appartient-il à l'entreprise, et l'utilisateur peut-il y déposer ? Décidé par la base, avec sa session. */
async function target(company: string, project: string) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("portal_upload_target", { p_company: company, p_project: project });
  return { sb, target: (data as Target | null) ?? null, error };
}

/**
 * POST /api/portal/upload : URL signée d'envoi vers le bucket privé, pour un fichier de 50 Mo au plus.
 * Le navigateur envoie ensuite le fichier directement au Storage, puis confirme par PUT.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { company?: string; project?: string; name?: string; size?: number } | null;
  if (!b || !UUID.test(b.company ?? "") || !UUID.test(b.project ?? "") || !b.name?.trim()) return json({ error: "Requête invalide" }, 400);
  const size = Number(b.size);
  if (!Number.isFinite(size) || size <= 0) return json({ error: "Ce fichier est vide." }, 400);
  if (size > PORTAL_MAX_SIZE) return json({ error: "Fichier trop lourd : 50 Mo maximum. Pour un fichier plus lourd, partagez plutôt un lien." }, 413);

  const t = await target(b.company!, b.project!);
  if (!t.target) return json({ error: message(t.error, "Dépôt impossible sur ce projet.") }, 403);

  const path = portalUploadPath(t.target.workspace_id, t.target.project_id, b.name);
  const { data, error } = await supabaseAdmin().storage.from(PORTAL_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return json({ error: "Envoi impossible pour le moment, réessayez." }, 500);
  return json({ path: data.path, token: data.token });
}

/**
 * PUT /api/portal/upload : confirme un fichier envoyé. portal_file_add (session de l'utilisateur) revérifie
 * le projet, n'accepte qu'un chemin de dépôt du portail, lit la taille réelle dans le Storage et crée la
 * pièce jointe avec client_visible = true.
 */
export async function PUT(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { company?: string; project?: string; path?: string; name?: string; mime?: string } | null;
  if (!b || !UUID.test(b.company ?? "") || !UUID.test(b.project ?? "") || !b.path || !b.name?.trim()) return json({ error: "Requête invalide" }, 400);

  const t = await target(b.company!, b.project!);
  if (!t.target) return json({ error: message(t.error, "Dépôt impossible sur ce projet.") }, 403);
  if (!isPortalUploadPath(b.path, t.target.workspace_id, t.target.project_id)) return json({ error: "Requête invalide" }, 400);

  const { data, error } = await t.sb.rpc("portal_file_add", {
    p_company: b.company!,
    p_project: b.project!,
    p_path: b.path,
    p_name: b.name.trim().slice(0, 200),
    p_mime: (b.mime ?? "").slice(0, 120),
  });
  if (error) {
    // Fichier refusé (trop lourd…) : on ne garde pas l'objet, sauf s'il est déjà rattaché à une pièce jointe
    const admin = supabaseAdmin();
    const { count } = await admin.from("attachments").select("id", { count: "exact", head: true }).eq("path", b.path);
    if (!count) await admin.storage.from(PORTAL_BUCKET).remove([b.path]);
    return json({ error: message(error, "Enregistrement du fichier impossible.") }, error.code === "22023" ? 400 : 403);
  }
  return json({ file: data });
}

/** DELETE /api/portal/upload : retire un fichier que l'utilisateur a lui-même déposé. */
export async function DELETE(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { company?: string; file?: string } | null;
  if (!b || !UUID.test(b.company ?? "") || !UUID.test(b.file ?? "")) return json({ error: "Requête invalide" }, 400);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("portal_file_remove", { p_company: b.company!, p_file: b.file! });
  const path = (data as { path?: string } | null)?.path;
  if (error || !path) return json({ error: message(error, "Fichier introuvable") }, 404);
  // Le chemin vient de la base, pour une pièce que la RPC vient de retirer : c'est un dépôt du portail de cet utilisateur
  await supabaseAdmin().storage.from(PORTAL_BUCKET).remove([path]);
  return json({ ok: true });
}
