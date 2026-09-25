import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-form";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Bienvenue" };

export default async function Onboarding({ searchParams }: PageProps<"/onboarding">) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login?next=/onboarding");
  const { new: isNew } = await searchParams;
  if (!isNew) {
    const { data } = await sb.from("workspace_members").select("workspace:workspaces(slug)").eq("user_id", auth.user.id).limit(1);
    const slug = (data?.[0]?.workspace as unknown as { slug: string } | null)?.slug;
    if (slug) redirect(`/w/${slug}`);
  }
  return (
    <AuthShell title="Crée ton espace agence" sub="Un espace = une agence. Tu pourras inviter ton équipe ensuite.">
      <OnboardingForm />
    </AuthShell>
  );
}
