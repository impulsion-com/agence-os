import Link from "next/link";

import { AuthShell, ForgotForm } from "@/components/auth/auth-form";

export const metadata = { title: "Mot de passe oublié" };

export default function Forgot() {
  return (
    <AuthShell title="Mot de passe oublié" sub="On t'envoie un lien pour en choisir un nouveau." foot={<Link href="/login">Retour à la connexion</Link>}>
      <ForgotForm />
    </AuthShell>
  );
}
