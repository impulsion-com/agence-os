"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LayoutDashboard, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Menu, Modal, type MenuItem } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePortal } from "./context";

type Theme = "system" | "light" | "dark";

// Préférence locale au navigateur (même clé que l'app : le script du layout racine la restaure sans flash)
function readTheme(): Theme {
  try {
    const t = JSON.parse(localStorage.getItem("aos-prefs") || "{}").theme;
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}
function applyTheme(t: Theme) {
  const d = document.documentElement;
  if (t === "system") delete d.dataset.theme;
  else d.dataset.theme = t;
  try {
    const p = JSON.parse(localStorage.getItem("aos-prefs") || "{}");
    localStorage.setItem("aos-prefs", JSON.stringify({ ...p, theme: t }));
  } catch {}
}

/** Menu du compte : nom, mot de passe, thème, déconnexion. En aperçu, simple retour à l'espace de travail. */
export function AccountMenu() {
  const { ctx, preview } = usePortal();
  const router = useRouter();
  const [modal, setModal] = useState<"name" | "password" | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);

  const pick = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
  };
  const cur = theme ?? "system";
  const themes: MenuItem[] = [
    { label: "Thème", heading: true },
    { label: "Automatique", icon: <Monitor size={14} />, checked: cur === "system", onSelect: () => pick("system") },
    { label: "Clair", icon: <Sun size={14} />, checked: cur === "light", onSelect: () => pick("light") },
    { label: "Sombre", icon: <Moon size={14} />, checked: cur === "dark", onSelect: () => pick("dark") },
  ];

  const items: MenuItem[] = preview
    ? [
        { label: ctx.user.name || ctx.user.email, heading: true },
        { label: "Retour à l'espace de travail", icon: <LayoutDashboard size={14} />, onSelect: () => router.push(`/w/${ctx.workspace.slug}`) },
        { label: "", separator: true },
        ...themes,
      ]
    : [
        { label: ctx.user.email, heading: true },
        { label: "Modifier mon nom", icon: <UserRound size={14} />, onSelect: () => setModal("name") },
        { label: "Changer de mot de passe", icon: <KeyRound size={14} />, onSelect: () => setModal("password") },
        { label: "", separator: true },
        ...themes,
        { label: "", separator: true },
        {
          label: "Se déconnecter",
          icon: <LogOut size={14} />,
          onSelect: async () => {
            await supabaseBrowser().auth.signOut();
            router.push("/login");
            router.refresh();
          },
        },
      ];

  return (
    <>
      <Menu
        align="end"
        width={240}
        items={items}
        trigger={(open, isOpen) => (
          <button
            type="button"
            className="ptl-me"
            onClick={(e) => {
              setTheme(readTheme());
              open(e);
            }}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label="Mon compte"
          >
            <Avatar profile={{ full_name: ctx.user.name || ctx.user.email, color: ctx.user.color }} size={28} title={false} />
            <ChevronDown size={13} />
          </button>
        )}
      />
      {modal === "name" && <NameModal onClose={() => setModal(null)} />}
      {modal === "password" && <PasswordModal onClose={() => setModal(null)} />}
    </>
  );
}

function NameModal({ onClose }: { onClose: () => void }) {
  const { ctx } = usePortal();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(ctx.user.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = name.trim();
    if (v.length < 2) return;
    setBusy(true);
    // Son propre profil uniquement (policy « profil modifiable »)
    const { error } = await supabaseBrowser().from("profiles").update({ full_name: v.slice(0, 120) }).eq("id", ctx.user.id);
    setBusy(false);
    if (error) return toast("Enregistrement impossible, réessayez.", { error: true });
    toast("Nom mis à jour");
    router.refresh();
    onClose();
  };
  return (
    <Modal
      title="Modifier mon nom"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || name.trim().length < 2} onClick={() => void save()}>Enregistrer</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="ptl-name">Nom affiché</label>
        <input
          id="ptl-name"
          className="input lg"
          autoFocus
          autoComplete="name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <span className="hint">C&apos;est le nom que l&apos;agence voit sur vos commentaires et vos validations.</span>
      </div>
    </Modal>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (pw.length < 8) return setErr("Choisissez un mot de passe d'au moins 8 caractères.");
    if (pw !== pw2) return setErr("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    setErr("");
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(/different from the old/i.test(error.message) ? "Le nouveau mot de passe doit être différent de l'ancien." : "Changement impossible, réessayez.");
    toast("Mot de passe mis à jour");
    onClose();
  };
  return (
    <Modal
      title="Changer de mot de passe"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !pw || !pw2} onClick={() => void save()}>Enregistrer</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="ptl-pw">Nouveau mot de passe</label>
        <input id="ptl-pw" className="input lg" type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ptl-pw2">Confirmation</label>
        <input
          id="ptl-pw2"
          className="input lg"
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      </div>
      {err && <p role="alert" style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }}>{err}</p>}
    </Modal>
  );
}
