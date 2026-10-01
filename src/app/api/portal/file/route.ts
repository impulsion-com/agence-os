import { NextResponse, type NextRequest } from "next/server";

import { PORTAL_BUCKET } from "@/lib/portal/files";
import { UUID } from "@/lib/portal/nav";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const refused = () => NextResponse.json({ error: "Fichier introuvable" }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/portal/file?company=<id>&kind=file|task|asset&id=<id>[&task=<id>][&download=1]
 *
 * Délivre un fichier du Storage privé à un client du portail. La décision d'accès est prise par la
 * base, avec la session de l'utilisateur : une RPC portal_*_path renvoie le chemin seulement si le
 * fichier est partagé avec cette entreprise et que la fonctionnalité est ouverte. Le service role ne
 * sert qu'ensuite, à signer une URL de courte durée vers ce chemin précis. Refus et fichier inexistant
 * donnent la même réponse.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const company = sp.get("company") ?? "";
  const kind = sp.get("kind") ?? "file";
  const id = sp.get("id") ?? "";
  const task = sp.get("task") ?? "";
  if (!UUID.test(company) || !UUID.test(id) || !["file", "task", "asset"].includes(kind) || (kind === "task" && !UUID.test(task))) return refused();

  const sb = await supabaseServer();
  const res =
    kind === "asset"
      ? await sb.rpc("portal_asset_path", { p_company: company, p_asset: id })
      : kind === "task"
        ? await sb.rpc("portal_task_file_path", { p_company: company, p_task: task, p_file: id })
        : await sb.rpc("portal_file_path", { p_company: company, p_file: id });
  const file = res.data as { path?: string; name?: string; mime?: string } | null;
  if (res.error || !file?.path) return refused();

  // Les vidéos se lisent par plages : l'URL doit vivre le temps de la lecture
  const ttl = (file.mime ?? "").startsWith("video/") ? 1800 : 300;
  const { data, error } = await supabaseAdmin()
    .storage.from(PORTAL_BUCKET)
    .createSignedUrl(file.path, ttl, sp.get("download") === "1" ? { download: file.name || true } : undefined);
  if (error || !data?.signedUrl) return refused();

  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    // Le navigateur peut réutiliser la redirection tant que l'URL signée est valable, jamais un cache partagé
    headers: { "Cache-Control": `private, max-age=${ttl - 60}`, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
  });
}
