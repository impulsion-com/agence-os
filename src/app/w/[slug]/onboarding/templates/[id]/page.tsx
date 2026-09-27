import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TemplateEditor } from "@/components/onboarding/template-editor";
import type { OnboardingSettings, OnboardingTemplate } from "@/lib/onboarding/types";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

type Props = { params: Promise<{ slug: string; id: string }> };

export const metadata: Metadata = { title: "Modèle d'onboarding" };

export default async function TemplatePage({ params }: Props) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const [{ data: tpl }, { data: settings }, { count }] = await Promise.all([
    sb.from("onboarding_templates").select("*").eq("id", id).eq("workspace_id", ws.workspace.id).maybeSingle(),
    sb.from("onboarding_settings").select("*").eq("workspace_id", ws.workspace.id).maybeSingle(),
    sb.from("onboarding_forms").select("id", { count: "exact", head: true }).eq("template_id", id),
  ]);
  if (!tpl) notFound();
  return <TemplateEditor template={tpl as unknown as OnboardingTemplate} settings={settings as OnboardingSettings | null} usedBy={count ?? 0} />;
}
