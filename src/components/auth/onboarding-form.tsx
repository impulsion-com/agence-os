"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ModuleSelector } from "@/components/modules/module-selector";
import { runDemo } from "@/lib/demo";
import { PRESETS, type ModuleId } from "@/lib/modules";
import { supabaseBrowser } from "@/lib/supabase/client";
import { slugify } from "@/lib/format";

// Création d'un espace en deux étapes : nom de l'agence, puis modules à activer.
export function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [modules, setModules] = useState<ModuleId[]>(PRESETS.find((p) => p.id === "freelance")!.modules);
  const [demo, setDemo] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const s = touched ? slug : slugify(name);

  const create = async () => {
    setBusy(true);
    setErr("");
    const sb = supabaseBrowser();
    const { data: ws, error } = await sb.rpc("create_workspace", { p_name: name.trim(), p_slug: s });
    if (error) {
      setBusy(false);
      setStep(1);
      return setErr(error.message.includes("duplicate") ? "Cette adresse est déjà prise, choisis-en une autre." : error.message);
    }
    await sb.from("workspaces").update({ modules }).eq("id", ws);
    if (demo) await runDemo(ws, "load").catch(() => undefined);
    router.push(`/w/${s}`);
    router.refresh();
  };

  if (step === 2)
    return (
      <form
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div>
          <p className="faint" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Étape 2 sur 2</p>
          <h2 style={{ fontSize: "var(--fs-xl)", marginTop: 4 }}>Qu&apos;est-ce que tu veux piloter ?</h2>
          <p className="muted" style={{ marginTop: 4 }}>Choisis un profil ou coche les modules un par un. Tu pourras en ajouter ou en retirer à tout moment dans Réglages &gt; Modules.</p>
        </div>
        <ModuleSelector value={modules} onChange={(next) => setModules(next)} compact />
        <label className="card" style={{ cursor: "pointer" }}>
          <span style={{ padding: 12, display: "flex", gap: 10 }}>
            <input type="checkbox" className="check" checked={demo} onChange={(e) => setDemo(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <b style={{ fontSize: "var(--fs)" }}>Charger des données d&apos;exemple</b>
              <span className="muted" style={{ display: "block", fontSize: "var(--fs-sm)", marginTop: 2 }}>
                Une agence fictive (clients, deals, projets, reporting…) pour découvrir l&apos;outil. Supprimables à tout moment.
              </span>
            </span>
          </span>
        </label>
        {err && <p style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }} role="alert">{err}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-lg" onClick={() => setStep(1)} disabled={busy}>
            <ArrowLeft size={15} />
            Retour
          </button>
          <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={busy}>
            {busy ? (demo ? "Création de l'espace et des exemples (environ 30 s)…" : "Création de l'espace…") : "Créer l'espace"}
          </button>
        </div>
      </form>
    );

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (s.length < 2) return setErr("Choisis un nom d'au moins 2 caractères.");
        setErr("");
        setStep(2);
      }}
    >
      <p className="faint" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Étape 1 sur 2</p>
      <div className="field">
        <label htmlFor="ws-name">Nom de l&apos;agence</label>
        <input id="ws-name" className="input lg" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio Acquisition" />
      </div>
      <div className="field">
        <label htmlFor="ws-slug">Adresse de l&apos;espace</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="faint mono">/w/</span>
          <input id="ws-slug" className="input lg mono" value={s} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} />
        </div>
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }} role="alert">{err}</p>}
      <button className="btn btn-primary btn-lg btn-block">Continuer</button>
    </form>
  );
}
