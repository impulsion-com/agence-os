import Link from "next/link";
import { Suspense } from "react";

import { AuthShell, LoginForm } from "@/components/auth/auth-form";
import { inviteFromNext } from "@/lib/portal/invite";

export const metadata = { title: "Connexion" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // Invitation au portail client : la page prend les couleurs de l'agence et l'email de l'invitation
  const invite = await inviteFromNext(next);
  if (invite)
    return (
      <AuthShell
        brand={{ name: invite.workspace, accent: invite.accent }}
        title="Connectez-vous à votre espace client"
        sub={`Pour accéder à l'espace de ${invite.company}.`}
        foot={<>Pas encore de compte ? <Link href={`/signup?next=${encodeURIComponent(invite.next)}`} style={{ color: "var(--accent)" }}>Créer mon accès</Link></>}
      >
        <Suspense>
          <LoginForm invite={invite} />
        </Suspense>
      </AuthShell>
    );
  // Retour vers un portail client (/c/<slug>) : on vouvoie, sans rien dire de l'agence avant la connexion
  if (typeof next === "string" && /^\/c\/[a-z0-9-]+/.test(next))
    return (
      <AuthShell title="Votre espace client" sub="Connectez-vous pour retrouver vos projets, vos créas et vos résultats.">
        <Suspense>
          <LoginForm vous />
        </Suspense>
      </AuthShell>
    );
  return (
    <AuthShell title="Bon retour" sub="Connecte-toi à ton espace agence." foot={<>Pas encore de compte ? <Link href="/signup" style={{ color: "var(--accent)" }}>Créer un compte</Link></>}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
