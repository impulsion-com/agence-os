"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Logo } from "@/components/shell/sidebar";
import { APP_NAME } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";

export function AuthShell({ title, sub, children, foot }: { title: string; sub?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <Logo size={26} />
          {APP_NAME}
        </div>
        <div>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {children}
        {foot && <p className="faint" style={{ fontSize: "var(--fs-sm)", textAlign: "center" }}>{foot}</p>}
      </div>
    </div>
  );
}

const msg = (e: string) =>
  ({
    "Invalid login credentials": "Email ou mot de passe incorrect.",
    "User already registered": "Un compte existe déjà avec cet email.",
    "Email not confirmed": "Confirme d'abord ton adresse email (lien reçu par mail).",
  })[e] ?? e;

export function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

function Strength({ pw }: { pw: string }) {
  const s = strength(pw);
  const labels = ["Trop court", "Faible", "Correct", "Bon", "Excellent"];
  const colors = ["var(--red)", "var(--red)", "var(--amber)", "var(--green)", "var(--green)"];
  if (!pw) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", gap: 3, flex: 1 }}>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i < s ? colors[s] : "var(--surface-3)" }} />
        ))}
      </div>
      <span style={{ fontSize: "var(--fs-xs)", color: colors[s] }}>{labels[s]}</span>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
        setBusy(false);
        if (error) return setErr(msg(error.message));
        router.push(params.get("next") || "/");
        router.refresh();
      }}
    >
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input lg" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password" style={{ display: "flex", justifyContent: "space-between" }}>
          Mot de passe
          <Link href="/forgot" className="faint" style={{ fontWeight: 400 }}>Oublié ?</Link>
        </label>
        <input id="password" className="input lg" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {err && <p className="err" style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }} role="alert">{err}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = params.get("next") || "/onboarding";
  if (sent)
    return (
      <div className="card" style={{ padding: 16 }}>
        <b>Vérifie ta boîte mail</b>
        <p className="muted" style={{ marginTop: 6 }}>Un lien de confirmation a été envoyé à {email}. Clique dessus pour activer ton compte.</p>
      </div>
    );
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (strength(password) < 2) return setErr("Choisis un mot de passe plus solide (8 caractères minimum).");
        setBusy(true);
        setErr("");
        const { data, error } = await supabaseBrowser().auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        setBusy(false);
        if (error) return setErr(msg(error.message));
        if (data.session) {
          router.push(next);
          router.refresh();
        } else setSent(true);
      }}
    >
      <div className="field">
        <label htmlFor="name">Nom complet</label>
        <input id="name" className="input lg" autoComplete="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Camille Martin" />
      </div>
      <div className="field">
        <label htmlFor="email">Email professionnel</label>
        <input id="email" className="input lg" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="camille@agence.fr" />
      </div>
      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <input id="password" className="input lg" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Strength pw={password} />
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }} role="alert">{err}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Création…" : "Créer mon compte"}</button>
    </form>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  if (sent)
    return <div className="card" style={{ padding: 16 }}><p className="muted">Si un compte existe pour {email}, un lien de réinitialisation vient d&apos;être envoyé.</p></div>;
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/reset` });
        setSent(true);
      }}
    >
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input lg" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-lg btn-block">Envoyer le lien</button>
    </form>
  );
}

export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (strength(password) < 2) return setErr("Choisis un mot de passe plus solide.");
        const { error } = await supabaseBrowser().auth.updateUser({ password });
        if (error) return setErr(msg(error.message));
        router.push("/");
      }}
    >
      <div className="field">
        <label htmlFor="password">Nouveau mot de passe</label>
        <input id="password" className="input lg" type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <Strength pw={password} />
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }}>{err}</p>}
      <button className="btn btn-primary btn-lg btn-block">Enregistrer</button>
    </form>
  );
}
