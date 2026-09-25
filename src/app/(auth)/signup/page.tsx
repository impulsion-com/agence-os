import Link from "next/link";
import { Suspense } from "react";

import { AuthShell, SignupForm } from "@/components/auth/auth-form";

export const metadata = { title: "Créer un compte" };

export default function Signup() {
  return (
    <AuthShell title="Crée ton espace agence" sub="Projets, CRM, propositions et reporting au même endroit." foot={<>Déjà inscrit ? <Link href="/login" style={{ color: "var(--accent)" }}>Se connecter</Link></>}>
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
