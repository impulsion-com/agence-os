"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { runDemo } from "@/lib/demo";
import { supabaseBrowser } from "@/lib/supabase/client";
import { slugify } from "@/lib/format";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [demo, setDemo] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const s = touched ? slug : slugify(name);
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (s.length < 2) return setErr("Choisis un nom d'au moins 2 caractères.");
        setBusy(true);
        setErr("");
        const sb = supabaseBrowser();
        const { data: ws, error } = await sb.rpc("create_workspace", { p_name: name.trim(), p_slug: s });
        if (error) {
          setBusy(false);
          return setErr(error.message.includes("duplicate") ? "Cette adresse est déjà prise, choisis-en une autre." : error.message);
        }
        if (demo) await runDemo(ws, "load").catch(() => undefined);
        router.push(`/w/${s}`);
        router.refresh();
      }}
    >
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
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }} className="card">
        <span style={{ padding: 12, display: "flex", gap: 10 }}>
          <input type="checkbox" className="check" checked={demo} onChange={(e) => setDemo(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            <b style={{ fontSize: "var(--fs)" }}>Charger des données d&apos;exemple</b>
            <span className="muted" style={{ display: "block", fontSize: "var(--fs-sm)", marginTop: 2 }}>
              Clients, deals, projets, propositions et un reporting de démonstration pour découvrir l&apos;outil. Supprimables à tout moment.
            </span>
          </span>
        </span>
      </label>
      {err && <p style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }} role="alert">{err}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Création de l'espace…" : "Créer l'espace"}</button>
    </form>
  );
}
