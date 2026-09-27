import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OnboardingResponses } from "@/components/onboarding/responses";
import { emailEnabled } from "@/lib/email";
import type { OnboardingFile, OnboardingForm } from "@/lib/onboarding/types";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

type Props = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data } = /^[0-9a-f-]{36}$/.test(id) ? await sb.from("onboarding_forms").select("title").eq("id", id).maybeSingle() : { data: null };
  return { title: data?.title ?? "Onboarding" };
}

export default async function OnboardingFormPage({ params }: Props) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const { data: form } = await sb.from("onboarding_forms").select("*").eq("id", id).eq("workspace_id", ws.workspace.id).maybeSingle();
  if (!form) notFound();
  const [files, contact, template] = await Promise.all([
    sb.from("onboarding_files").select("*").eq("form_id", form.id).order("created_at"),
    form.contact_id ? sb.from("contacts").select("id, first_name, last_name, email, phone").eq("id", form.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    form.template_id ? sb.from("onboarding_templates").select("id, name").eq("id", form.template_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <OnboardingResponses
      form={form as unknown as OnboardingForm}
      files={(files.data ?? []) as OnboardingFile[]}
      contact={contact.data}
      template={template.data}
      emailOn={emailEnabled()}
    />
  );
}
