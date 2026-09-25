import { AuthShell, ResetForm } from "@/components/auth/auth-form";

export const metadata = { title: "Nouveau mot de passe" };

export default function Reset() {
  return (
    <AuthShell title="Nouveau mot de passe">
      <ResetForm />
    </AuthShell>
  );
}
