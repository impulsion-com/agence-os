import type { NextRequest } from "next/server";
import { z } from "zod";

import { json, runAutomations } from "@/lib/onboarding/server";
import type { OnboardingForm } from "@/lib/onboarding/types";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ form_id: z.string().uuid() });

/** POST /api/onboarding/automate : relance les automatisations d'un formulaire terminé (sans doublon de tâches) */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requête invalide" }, 400);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "Connexion requise" }, 401);
  const { data: form } = await sb.from("onboarding_forms").select("*").eq("id", parsed.data.form_id).maybeSingle();
  if (!form) return json({ error: "Formulaire introuvable" }, 404);
  const { data: canWrite } = await sb.rpc("can_write", { ws: form.workspace_id });
  if (!canWrite) return json({ error: "Action réservée aux membres de l'espace" }, 403);
  if (form.status !== "completed") return json({ error: "Le formulaire n'est pas encore terminé" }, 409);

  const admin = supabaseAdmin();
  const automation = await runAutomations(admin, form as unknown as OnboardingForm);
  await admin
    .from("onboarding_forms")
    .update({ automation: JSON.parse(JSON.stringify(automation)), project_id: automation.project_id ?? form.project_id })
    .eq("id", form.id);
  return json({ automation });
}
