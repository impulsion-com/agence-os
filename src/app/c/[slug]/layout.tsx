import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PortalShell } from "@/components/portal/shell";
import { PortalSolo, SignOutButton } from "@/components/portal/solo";
import { loadPortalContext } from "@/lib/portal/load";

export async function generateMetadata({ params }: LayoutProps<"/c/[slug]">): Promise<Metadata> {
  const { ctx } = await loadPortalContext((await params).slug);
  return {
    title: ctx ? { default: `Espace client · ${ctx.workspace.name}`, template: `%s · ${ctx.workspace.name}` } : { absolute: "Espace client" },
    robots: { index: false, follow: false },
  };
}

/**
 * Portail client d'un espace : coque dédiée, sans la barre latérale de l'application.
 * Le contexte vient de portal_context (session de l'utilisateur) : sans portail ici, on n'affiche
 * rien de l'espace, pas même son nom.
 */
export default async function PortalLayout({ children, params }: LayoutProps<"/c/[slug]">) {
  const { slug } = await params;
  const { ctx, cookie } = await loadPortalContext(slug);

  if (!ctx || !ctx.portals.length)
    return (
      <PortalSolo agency={ctx?.workspace.name} accent={ctx?.workspace.accent}>
        <h1>Accès indisponible</h1>
        {ctx?.preview ? (
          <p>Cet espace n&apos;a pas encore de client. Créez un client, puis ouvrez son portail depuis sa fiche.</p>
        ) : (
          <p>
            {ctx?.user.email ? (
              <>
                Le compte <b>{ctx.user.email}</b> n&apos;a pas d&apos;espace client ouvert ici pour le moment.
              </>
            ) : (
              "Ce compte n'a pas accès à cet espace client."
            )}{" "}
            Si vous avez reçu une invitation, ouvrez le lien de l&apos;email avec le compte invité. Sinon, contactez votre agence.
          </p>
        )}
        <div className="acts">
          {ctx?.preview ? (
            <Link className="btn btn-primary btn-lg btn-block" href={`/w/${slug}/crm/companies`}>
              Voir les clients
            </Link>
          ) : (
            <>
              <Link className="btn btn-primary btn-lg btn-block" href="/">
                Retour à l&apos;accueil
              </Link>
              <SignOutButton label="Changer de compte" to={`/login?next=${encodeURIComponent(`/c/${slug}`)}`} />
            </>
          )}
        </div>
      </PortalSolo>
    );

  return (
    <Suspense>
      <PortalShell ctx={ctx} cookieCompany={cookie}>
        {children}
      </PortalShell>
    </Suspense>
  );
}
