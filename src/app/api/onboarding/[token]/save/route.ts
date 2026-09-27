import type { NextRequest } from "next/server";

import { countFiles, formProgress, sanitizeAnswers } from "@/lib/onboarding/logic";
import { formByToken, json } from "@/lib/onboarding/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/** POST /api/onboarding/<token>/save : sauvegarde automatique des réponses du client */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return json({ error: "Réponses trop volumineuses" }, 413);
  const admin = supabaseAdmin();
  const form = await formByToken(admin, token);
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  if (form.status === "completed") return json({ error: "Ce formulaire a déjà été envoyé : vos réponses sont entre les mains de l'agence." }, 409);

  const body = (await req.json().catch(() => null)) as { answers?: unknown } | null;
  if (!body?.answers) return json({ error: "Requête invalide" }, 400);
  const answers = sanitizeAnswers(form.sections, body.answers);
  const { data: files } = await admin.from("onboarding_files").select("question_id").eq("form_id", form.id);
  const progress = formProgress(form.sections, answers, countFiles(files ?? []));
  const now = new Date().toISOString();
  const { error } = await admin
    .from("onboarding_forms")
    .update({ answers, progress, status: "in_progress", last_activity_at: now, opened_at: form.opened_at ?? now })
    .eq("id", form.id);
  if (error) return json({ error: "Enregistrement impossible, réessayez dans un instant." }, 500);
  return json({ progress, saved_at: now });
}
