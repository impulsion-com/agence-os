"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { SetPage, SetRow, SetSection } from "./shell";

export function ProfileSettings() {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [name, setName] = useState(ws.me.full_name);
  const [title, setTitle] = useState(ws.me.title);
  const [color, setColor] = useState(ws.me.color);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const dirty = name.trim() !== ws.me.full_name || title.trim() !== ws.me.title || color !== ws.me.color;

  const save = async () => {
    if (!name.trim()) return toast("Ton nom ne peut pas être vide", { error: true });
    setBusy(true);
    await mutate(
      async (sb) => {
        must(await sb.from("profiles").update({ full_name: name.trim(), title: title.trim(), color }).eq("id", ws.me.id).select("id"));
        // Titre affiché dans cet espace : aligné sur le profil quand on en a le droit
        if (ws.isAdmin) await sb.from("workspace_members").update({ title: title.trim() }).eq("workspace_id", ws.workspace.id).eq("user_id", ws.me.id);
      },
      { success: "Profil enregistré" },
    );
    setBusy(false);
  };

  const changePassword = async () => {
    if (pw.length < 8) return toast("Le mot de passe doit faire au moins 8 caractères", { error: true });
    if (pw !== pw2) return toast("Les deux mots de passe ne correspondent pas", { error: true });
    setPwBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return toast(error.message, { error: true });
    setPw("");
    setPw2("");
    toast("Mot de passe modifié");
  };

  return (
    <SetPage title="Profil" lead="Ce que les autres membres voient de toi dans tous tes espaces.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <SetSection title="Identité">
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: "1px solid var(--divider)" }}>
            <Avatar profile={{ full_name: name || "?", color }} size={56} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "var(--fs-md)" }}>{name || "Sans nom"}</div>
              <div className="faint" style={{ fontSize: "var(--fs-sm)" }}>{title || "Aucun titre"}</div>
            </div>
          </div>
          <SetRow label="Nom complet" htmlFor="pf-name">
            <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </SetRow>
          <SetRow label="Titre" hint="Ton rôle dans l'agence, affiché sur ta fiche et dans les listes." htmlFor="pf-title">
            <input id="pf-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Media buyer, Creative strategist…" />
          </SetRow>
          <SetRow label="Couleur de l'avatar">
            <div className="swatches" role="radiogroup" aria-label="Couleur de l'avatar">
              {Object.entries(COLORS).map(([k, v]) => {
                const on = color.toLowerCase() === v.toLowerCase();
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={k}
                    className={`swatch sm${on ? " on" : ""}`}
                    style={{ ["--c" as string]: v }}
                    onClick={() => setColor(v)}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </SetRow>
          <SetRow label="Email" hint="L'adresse de connexion ne se modifie pas ici.">
            <input className="input" value={ws.me.email} readOnly aria-readonly style={{ color: "var(--text-3)" }} />
          </SetRow>
          <div className="set-actions" style={{ paddingTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>
              Enregistrer
            </button>
            {dirty && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setName(ws.me.full_name);
                  setTitle(ws.me.title);
                  setColor(ws.me.color);
                }}
              >
                Annuler
              </button>
            )}
          </div>
        </SetSection>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          changePassword();
        }}
      >
        <SetSection title="Mot de passe">
          <input type="email" autoComplete="username" value={ws.me.email} readOnly hidden />
          <SetRow label="Nouveau mot de passe" hint="8 caractères minimum." htmlFor="pf-pw">
            <input id="pf-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </SetRow>
          <SetRow label="Confirmation" htmlFor="pf-pw2">
            <input id="pf-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </SetRow>
          <div className="set-actions" style={{ paddingTop: 16 }}>
            <button type="submit" className="btn" disabled={!pw || pwBusy}>
              Changer le mot de passe
            </button>
          </div>
        </SetSection>
      </form>
    </SetPage>
  );
}
