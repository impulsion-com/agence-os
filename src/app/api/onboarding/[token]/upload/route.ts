import type { NextRequest } from "next/server";

import { MAX_FILES_PER_FORM, MAX_FILE_SIZE } from "@/lib/onboarding/logic";
import { BUCKET, formByToken, json } from "@/lib/onboarding/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const safeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80) || "fichier";

/**
 * POST /api/onboarding/<token>/upload : URL signée d'upload vers le bucket privé.
 * Le navigateur du client envoie ensuite le fichier directement au stockage,
 * puis confirme par POST /api/onboarding/<token>/files.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const admin = supabaseAdmin();
  const form = await formByToken(admin, token);
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  if (form.status === "completed") return json({ error: "Ce formulaire a déjà été envoyé." }, 409);

  const body = (await req.json().catch(() => null)) as { question_id?: string; name?: string; size?: number } | null;
  const q = form.sections.flatMap((s) => s.questions).find((x) => x.id === body?.question_id);
  if (!q || q.type !== "file" || !body?.name) return json({ error: "Requête invalide" }, 400);
  if (!body.size || body.size > MAX_FILE_SIZE) return json({ error: `Fichier trop lourd : ${Math.round(MAX_FILE_SIZE / 1048576)} Mo maximum. Pour une vidéo plus lourde, partagez plutôt un lien.` }, 413);

  const { count } = await admin.from("onboarding_files").select("id", { count: "exact", head: true }).eq("form_id", form.id);
  if ((count ?? 0) >= MAX_FILES_PER_FORM) return json({ error: `Limite de ${MAX_FILES_PER_FORM} fichiers atteinte. Partagez plutôt un lien vers un dossier.` }, 429);

  const path = `${form.workspace_id}/onboarding/${form.id}/${crypto.randomUUID().slice(0, 8)}-${safeName(body.name)}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return json({ error: "Envoi impossible pour le moment, réessayez." }, 500);
  return json({ path: data.path, token: data.token });
}
