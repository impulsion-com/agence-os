import Link from "next/link";
import { Suspense } from "react";

import { AuthShell, SignupForm } from "@/components/auth/auth-form";
import { inviteFromNext } from "@/lib/portal/invite";

export const metadata = { title: "Créer un compte" };

export default async function Signup({ searchParams }: PageProps<"/signup">) {
  // Invitation au portail client : la page prend les couleurs de l'agence et l'email de l'invitation
  const invite = await inviteFromNext((await searchParams).next);
  if (invite)
    return (
      <AuthShell
        brand={{ name: invite.workspace, accent: invite.accent }}
        title="Créez votre accès client"
        sub={`${invite.workspace} vous invite à suivre ${invite.company}. Choisissez un mot de passe : c'est tout.`}
        foot={<>Déjà un compte ? <Link href={`/login?next=${encodeURIComponent(invite.next)}`} style={{ color: "var(--accent)" }}>Se connecter</Link></>}
      >
        <Suspense>
          <SignupForm invite={invite} />
        </Suspense>
      </AuthShell>
    );
  return (
    <AuthShell title="Crée ton espace agence" sub="Projets, CRM, propositions et reporting au même endroit." foot={<>Déjà inscrit ? <Link href="/login" style={{ color: "var(--accent)" }}>Se connecter</Link></>}>
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
