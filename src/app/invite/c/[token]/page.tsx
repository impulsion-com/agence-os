import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartColumn, CircleCheck, FolderOpen } from "lucide-react";

import { PortalSolo, SignOutButton } from "@/components/portal/solo";
import { supabaseAnon, supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Invitation à votre espace client" }, robots: { index: false, follow: false } };

interface InvitationInfo {
  email: string;
  workspace: string;
  accent: string;
  company: string;
  valid: boolean;
}

/**
 * Lien d'invitation d'un client. Non connecté : page d'accueil aux couleurs de l'agence, puis
 * inscription ou connexion avec l'email de l'invitation. Connecté : acceptation (la base vérifie
 * que l'email du compte est celui de l'invitation), puis redirection vers le portail.
 */
export default async function ClientInvitePage({ params }: PageProps<"/invite/c/[token]">) {
  const { token } = await params;
  const { data } = /^[0-9a-f]{16,64}$/i.test(token) ? await supabaseAnon().rpc("client_invitation_info", { p_token: token }) : { data: null };
  const inv = data as unknown as InvitationInfo | null;

  if (!inv || !inv.valid)
    return (
      <PortalSolo agency={inv?.workspace} accent={inv?.accent}>
        <h1>Ce lien n&apos;est plus valide</h1>
        <p>
          L&apos;invitation a été révoquée ou le lien est incomplet. Demandez un nouveau lien à {inv?.workspace ?? "votre agence"} : il vous sera renvoyé en
          quelques secondes.
        </p>
        <div className="acts">
          <Link className="btn btn-lg btn-block" href="/login">
            J&apos;ai déjà un accès : me connecter
          </Link>
        </div>
      </PortalSolo>
    );

  const next = `/invite/c/${token}`;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();

  if (!auth.user)
    return (
      <PortalSolo agency={inv.workspace} accent={inv.accent}>
        <h1>{inv.workspace} vous ouvre votre espace client</h1>
        <p>
          Un seul endroit pour suivre le travail mené pour <b>{inv.company}</b>, sans chercher dans vos emails.
        </p>
        <div className="box">
          <ul>
            <li>
              <ChartColumn size={16} /> Consultez vos résultats publicitaires et vos rapports
            </li>
            <li>
              <CircleCheck size={16} /> Validez les créas et les étapes du projet en un clic
            </li>
            <li>
              <FolderOpen size={16} /> Retrouvez et déposez vos fichiers et documents
            </li>
          </ul>
        </div>
        <div className="acts">
          <Link className="btn btn-primary btn-lg btn-block" href={`/signup?next=${encodeURIComponent(next)}`}>
            Créer mon accès
          </Link>
          <Link className="btn btn-lg btn-block" href={`/login?next=${encodeURIComponent(next)}`}>
            J&apos;ai déjà un compte
          </Link>
        </div>
        <p className="fine">
          Invitation personnelle, réservée à <b>{inv.email}</b>
        </p>
      </PortalSolo>
    );

  const res = await sb.rpc("accept_client_invitation", { p_token: token });
  const ok = res.data as unknown as { slug?: string; company_id?: string } | null;
  if (!res.error && ok?.slug) redirect(`/c/${ok.slug}?company=${ok.company_id}`);

  // Refus 42501 : le compte connecté n'est pas celui de l'invitation
  if (res.error?.code === "42501")
    return (
      <PortalSolo agency={inv.workspace} accent={inv.accent}>
        <h1>Ce n&apos;est pas le bon compte</h1>
        <p>
          Vous êtes connecté avec <b>{auth.user.email}</b>, alors que cette invitation est destinée à <b>{inv.email}</b>. Changez de compte pour accéder à
          l&apos;espace client de {inv.company}.
        </p>
        <div className="acts">
          <SignOutButton primary label={`Continuer avec ${inv.email}`} to={`/login?next=${encodeURIComponent(next)}`} />
          <SignOutButton label="Créer un accès avec cette adresse" to={`/signup?next=${encodeURIComponent(next)}`} />
        </div>
      </PortalSolo>
    );

  return (
    <PortalSolo agency={inv.workspace} accent={inv.accent}>
      <h1>Invitation indisponible</h1>
      <p>L&apos;invitation n&apos;a pas pu être acceptée. Réessayez dans un instant ou demandez un nouveau lien à {inv.workspace}.</p>
      <div className="acts">
        <Link className="btn btn-primary btn-lg btn-block" href={next}>
          Réessayer
        </Link>
      </div>
    </PortalSolo>
  );
}
