"use client";

import "@/styles/portal.css";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { APP_NAME } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Page autonome du portail (invitation, accès indisponible) : carte centrée aux couleurs de l'agence. */
export function PortalSolo({ agency, accent, children }: { agency?: string | null; accent?: string | null; children: ReactNode }) {
  const name = agency?.trim() || APP_NAME;
  return (
    <div className="ptl-solo" data-ptl-accent={accent || "indigo"}>
      <div className="ptl-solo-card">
        <div className="hd">
          <span className="ptl-mark" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
          {name}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Déconnexion puis redirection (changer de compte pour une invitation, quitter une page sans accès). */
export function SignOutButton({ to = "/login", label = "Se déconnecter", primary }: { to?: string; label?: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-lg btn-block${primary ? " btn-primary" : ""}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();
        router.push(to);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
