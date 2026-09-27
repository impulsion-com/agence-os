import type { Metadata } from "next";

import { OnboardingHome, type FormRow, type Tab } from "@/components/onboarding/onboarding-home";
import { emailEnabled } from "@/lib/email";
import type { OnboardingSettings, OnboardingTemplate } from "@/lib/onboarding/types";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Onboarding clients" };

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const [forms, templates, settings] = await Promise.all([
    sb
      .from("onboarding_forms")
      .select("id, title, company_id, contact_id, template_id, status, progress, token, sections, answers, verified, sent_at, opened_at, last_activity_at, completed_at, reminded_at, remind_count, created_by")
      .eq("workspace_id", ws.workspace.id)
      .order("created_at", { ascending: false }),
    sb.from("onboarding_templates").select("*").eq("workspace_id", ws.workspace.id).order("position").order("created_at"),
    sb.from("onboarding_settings").select("*").eq("workspace_id", ws.workspace.id).maybeSingle(),
  ]);
  const contactIds = [...new Set((forms.data ?? []).map((f) => f.contact_id).filter(Boolean) as string[])];
  const { data: contacts } = contactIds.length
    ? await sb.from("contacts").select("id, first_name, last_name, email").in("id", contactIds)
    : { data: [] };
  const tab: Tab = sp.tab === "templates" || sp.tab === "settings" ? sp.tab : "forms";

  return (
    <OnboardingHome
      tab={tab}
      forms={(forms.data ?? []) as unknown as FormRow[]}
      templates={(templates.data ?? []) as unknown as OnboardingTemplate[]}
      settings={(settings.data as OnboardingSettings | null) ?? null}
      contacts={contacts ?? []}
      emailOn={emailEnabled()}
    />
  );
}
