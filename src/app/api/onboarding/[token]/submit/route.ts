import type { NextRequest } from "next/server";

import { countFiles, formErrors, sanitizeAnswers } from "@/lib/onboarding/logic";
import { appOrigin, formByToken, json, notifyCompleted, runAutomations } from "@/lib/onboarding/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/onboarding/<token>/submit : le client envoie ses réponses.
 * Vérifie les champs obligatoires, clôt le formulaire, lance les automatisations
 * (fiche client, KPI, projet et tâches d'accès) et prévient l'agence.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const admin = supabaseAdmin();
  const form = await formByToken(admin, token);
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  if (form.status === "completed") return json({ ok: true, already: true });

  const body = (await req.json().catch(() => null)) as { answers?: unknown } | null;
  const answers = sanitizeAnswers(form.sections, body?.answers ?? form.answers);
  const { data: files } = await admin.from("onboarding_files").select("question_id").eq("form_id", form.id);
  const errors = formErrors(form.sections, answers, countFiles(files ?? []));
  if (Object.keys(errors).length) {
    await admin.from("onboarding_forms").update({ answers, last_activity_at: new Date().toISOString() }).eq("id", form.id);
    return json({ error: "Quelques réponses obligatoires manquent encore.", errors }, 422);
  }

  const now = new Date().toISOString();
  const { data: closed, error } = await admin
    .from("onboarding_forms")
    .update({ answers, status: "completed", progress: 100, completed_at: now, last_activity_at: now, opened_at: form.opened_at ?? now })
    .eq("id", form.id)
    .neq("status", "completed")
    .select("id");
  if (error) return json({ error: "Envoi impossible, réessayez dans un instant." }, 500);
  if (!closed?.length) return json({ ok: true, already: true });

  // Automatisations : une erreur ici ne doit jamais bloquer le client
  const done = { ...form, answers, status: "completed" as const, completed_at: now };
  try {
    const automation = await runAutomations(admin, done);
    await admin.from("onboarding_forms").update({ automation: JSON.parse(JSON.stringify(automation)), project_id: automation.project_id ?? form.project_id }).eq("id", form.id);
    done.project_id = automation.project_id ?? form.project_id;
  } catch (e) {
    await admin.from("onboarding_forms").update({ automation: { at: now, errors: [e instanceof Error ? e.message : String(e)] } }).eq("id", form.id);
  }
  try {
    await notifyCompleted(admin, done, appOrigin(req));
  } catch {
    // notification best effort
  }
  return json({ ok: true });
}
