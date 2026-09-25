import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";

// Racine : envoie vers le dernier espace de travail, ou l'onboarding.
export default async function Root() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data } = await sb
    .from("workspace_members")
    .select("workspace:workspaces(slug)")
    .eq("user_id", auth.user.id)
    .order("joined_at", { ascending: false })
    .limit(1);
  const slug = (data?.[0]?.workspace as unknown as { slug: string } | null)?.slug;
  redirect(slug ? `/w/${slug}` : "/onboarding");
}
