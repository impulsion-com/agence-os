import type { NextRequest } from "next/server";

import { countFiles, formProgress, MAX_FILE_SIZE } from "@/lib/onboarding/logic";
import { BUCKET, formByToken, json } from "@/lib/onboarding/server";
import type { OnboardingForm } from "@/lib/onboarding/types";
import { supabaseAdmin } from "@/lib/supabase/server";

type Admin = ReturnType<typeof supabaseAdmin>;

async function touch(admin: Admin, form: OnboardingForm) {
  const { data: files } = await admin.from("onboarding_files").select("question_id").eq("form_id", form.id);
  const progress = formProgress(form.sections, form.answers ?? {}, countFiles(files ?? []));
  const now = new Date().toISOString();
  await admin
    .from("onboarding_forms")
    .update({ progress, status: "in_progress", last_activity_at: now, opened_at: form.opened_at ?? now })
    .eq("id", form.id);
  return progress;
}

/** POST : confirme un fichier envoyé via l'URL signée et l'enregistre */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const admin = supabaseAdmin();
  const form = await formByToken(admin, token);
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  if (form.status === "completed") return json({ error: "Ce formulaire a déjà été envoyé." }, 409);

  const b = (await req.json().catch(() => null)) as { question_id?: string; path?: string; name?: string; size?: number; mime?: string } | null;
  const q = form.sections.flatMap((s) => s.questions).find((x) => x.id === b?.question_id);
  const prefix = `${form.workspace_id}/onboarding/${form.id}/`;
  if (!b || !q || q.type !== "file" || !b.path?.startsWith(prefix) || b.path.includes("..") || !b.name) return json({ error: "Requête invalide" }, 400);

  const { data: exists } = await admin.storage.from(BUCKET).exists(b.path);
  if (!exists) return json({ error: "Le fichier n'a pas été reçu, réessayez." }, 400);

  const { data: file, error } = await admin
    .from("onboarding_files")
    .insert({
      workspace_id: form.workspace_id,
      form_id: form.id,
      question_id: q.id,
      name: b.name.slice(0, 200),
      path: b.path,
      size: Math.min(Math.max(0, Number(b.size) || 0), MAX_FILE_SIZE),
      mime: (b.mime ?? "").slice(0, 120),
    })
    .select("id, question_id, name, size, mime")
    .single();
  if (error) return json({ error: "Enregistrement du fichier impossible." }, 500);
  return json({ file, progress: await touch(admin, form) });
}

/** DELETE : retire un fichier déposé par le client */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const admin = supabaseAdmin();
  const form = await formByToken(admin, token);
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  if (form.status === "completed") return json({ error: "Ce formulaire a déjà été envoyé." }, 409);

  const b = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!b?.id) return json({ error: "Requête invalide" }, 400);
  const { data: file } = await admin.from("onboarding_files").select("id, path").eq("id", b.id).eq("form_id", form.id).maybeSingle();
  if (!file) return json({ error: "Fichier introuvable" }, 404);
  await admin.storage.from(BUCKET).remove([file.path]);
  await admin.from("onboarding_files").delete().eq("id", file.id);
  return json({ ok: true, progress: await touch(admin, form) });
}
