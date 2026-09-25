import Link from "next/link";
import { Suspense } from "react";

import { AuthShell, LoginForm } from "@/components/auth/auth-form";

export const metadata = { title: "Connexion" };

export default function Login() {
  return (
    <AuthShell title="Bon retour" sub="Connecte-toi à ton espace agence." foot={<>Pas encore de compte ? <Link href="/signup" style={{ color: "var(--accent)" }}>Créer un compte</Link></>}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
