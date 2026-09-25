import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-form";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Invitation" };

export default async function Invite({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect(`/signup?next=/invite/${token}`);
  const { data: wsId, error } = await sb.rpc("accept_invitation", { p_token: token });
  if (error || !wsId)
    return (
      <AuthShell title="Invitation indisponible" sub="Ce lien a déjà été utilisé ou n'est plus valide. Demande une nouvelle invitation à l'administrateur de l'espace." foot={<Link href="/">Retour à l&apos;accueil</Link>}>
        <span />
      </AuthShell>
    );
  const { data: ws } = await sb.from("workspaces").select("slug").eq("id", wsId).single();
  redirect(`/w/${ws!.slug}`);
}
