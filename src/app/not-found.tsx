import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth">
      <div className="auth-card" style={{ textAlign: "center", alignItems: "center" }}>
        <span className="mono faint" style={{ fontSize: 40 }}>404</span>
        <h1>Page introuvable</h1>
        <p className="muted">Cette page n&apos;existe pas ou tu n&apos;y as pas accès.</p>
        <Link href="/" className="btn btn-primary">Retour à l&apos;accueil</Link>
      </div>
    </div>
  );
}
