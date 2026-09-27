import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";

import { PublicForm } from "@/components/onboarding/public-form";
import { formByToken, loadPublic, TOKEN_RE } from "@/lib/onboarding/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

// Toujours rendu à la demande : la première visite marque le formulaire « ouvert ».
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/**
 * Page publique d'un formulaire d'onboarding. Lecture en service role par jeton.
 * Un membre connecté de l'espace voit un aperçu : rien n'est enregistré ni compté.
 */
const load = cache(async (token: string) => {
  if (!TOKEN_RE.test(token)) return null;
  const admin = supabaseAdmin();
  const form = await formByToken(admin, token);
  if (!form) return null;

  let preview = false;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (auth.user) {
    const { data } = await sb.rpc("is_member", { ws: form.workspace_id });
    preview = !!data;
  }
  if (!preview && !form.opened_at) {
    const now = new Date().toISOString();
    await admin.from("onboarding_forms").update({ opened_at: now }).eq("id", form.id);
  }
  return loadPublic(admin, form, preview);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const d = await load(token);
  return {
    title: d ? { absolute: `${d.title} · ${d.agency.name}` } : "Formulaire introuvable",
    robots: { index: false, follow: false },
  };
}

export default async function OnboardingFormPage({ params }: Props) {
  const { token } = await params;
  const d = await load(token);
  if (!d) notFound();
  return <PublicForm data={d} />;
}
