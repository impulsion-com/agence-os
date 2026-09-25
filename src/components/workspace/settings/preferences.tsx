"use client";

import { useState } from "react";
import { Check, CircleCheck, Monitor, Moon, Sun } from "lucide-react";

import { applyPrefs } from "@/lib/prefs";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Accent, Prefs } from "@/lib/types";
import { SetPage, SetRow, SetSection } from "./shell";

// Teintes claires des accents (alignées sur globals.css) pour les pastilles
export const ACCENTS: { id: Accent; name: string; color: string }[] = [
  { id: "indigo", name: "Indigo", color: "#4b5bd6" },
  { id: "blue", name: "Bleu", color: "#2f6cd4" },
  { id: "violet", name: "Violet", color: "#7348cc" },
  { id: "teal", name: "Sarcelle", color: "#1a7f7a" },
  { id: "rose", name: "Rose", color: "#b93d68" },
  { id: "graphite", name: "Graphite", color: "#34332f" },
];

const HOMES = [
  { id: "", name: "Accueil" },
  { id: "inbox", name: "Boîte de réception" },
  { id: "my-tasks", name: "Mes tâches" },
  { id: "projects", name: "Projets" },
  { id: "overview", name: "Vue d'ensemble" },
  { id: "crm", name: "Pipeline commercial" },
  { id: "reporting", name: "Reporting" },
];

function ThemePreview({ kind }: { kind: "light" | "dark" | "system" }) {
  const pane = (k: "light" | "dark") => (
    <div className={`tprev ${k}`} style={{ flex: 1, border: 0, borderRadius: 0 }}>
      <div className="s"><i /><i style={{ width: "70%" }} /><i style={{ width: "50%" }} /></div>
      <div className="m"><i style={{ width: "60%" }} /><i /><span className="a" /></div>
    </div>
  );
  if (kind === "system")
    return (
      <div className="tprev" style={{ display: "flex" }}>
        {pane("light")}
        {pane("dark")}
      </div>
    );
  return <div className={`tprev ${kind}`} style={{ padding: 0 }}>{pane(kind)}</div>;
}

export function PreferencesSettings() {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [p, setP] = useState<Prefs>(ws.me.prefs ?? {});

  const set = (patch: Partial<Prefs>) => {
    const next = { ...p, ...patch };
    for (const k of Object.keys(patch) as (keyof Prefs)[]) if (patch[k] === undefined) delete next[k];
    setP(next);
    applyPrefs(next, ws.workspace.accent);
    mutate(async (sb) => must(await sb.from("profiles").update({ prefs: next as never }).eq("id", ws.me.id).select("id")), { success: "Préférences enregistrées" });
  };

  const theme = p.theme ?? "system";
  const accent = p.accent;
  const wsAccent = ACCENTS.find((a) => a.id === ws.workspace.accent) ?? ACCENTS[0];

  return (
    <SetPage title="Préférences" lead="Réglages d'affichage propres à ton compte, appliqués immédiatement sur tous tes appareils.">
      <SetSection title="Thème">
        <div className="theme-cards" role="radiogroup" aria-label="Thème">
          {([
            ["light", "Clair", <Sun key="s" size={14} />],
            ["dark", "Sombre", <Moon key="m" size={14} />],
            ["system", "Système", <Monitor key="y" size={14} />],
          ] as const).map(([id, name, icon]) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} className={`theme-card${theme === id ? " on" : ""}`} onClick={() => set({ theme: id })}>
              <ThemePreview kind={id} />
              <span className="lbl">
                {icon}
                {name}
                {theme === id && <CircleCheck size={15} className="ok" />}
              </span>
            </button>
          ))}
        </div>
      </SetSection>

      <SetSection title="Couleur d'accent">
        <SetRow label="Accent" hint="Boutons principaux, sélection et focus.">
          <div className="swatches" role="radiogroup" aria-label="Couleur d'accent">
            {ACCENTS.map((a) => {
              const on = (accent ?? ws.workspace.accent) === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={a.name}
                  title={a.name + (a.id === ws.workspace.accent ? " (défaut de l'espace)" : "")}
                  className={`swatch${on ? " on" : ""}`}
                  style={{ ["--c" as string]: a.color }}
                  onClick={() => set({ accent: a.id })}
                >
                  {on && <Check size={13} strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </SetRow>
        <div className="accent-prev" aria-label="Aperçu">
          <button type="button" className="btn btn-primary btn-sm" tabIndex={-1}>Bouton principal</button>
          <span className="badge" style={{ ["--c" as string]: "var(--accent)" }}>Sélection</span>
          <input type="checkbox" className="toggle" checked readOnly tabIndex={-1} aria-hidden />
          <input type="checkbox" className="check" checked readOnly tabIndex={-1} aria-hidden />
          <span className="count accent">3</span>
          <span style={{ color: "var(--accent)", fontWeight: 500, fontSize: "var(--fs-sm)" }}>Lien actif</span>
          {accent && accent !== ws.workspace.accent && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => set({ accent: undefined })}>
              Revenir à l&apos;accent de l&apos;espace ({wsAccent.name})
            </button>
          )}
        </div>
      </SetSection>

      <SetSection title="Affichage">
        <SetRow label="Densité" hint="Hauteur des lignes dans les listes et marge des cartes du tableau.">
          <span className="seg" role="radiogroup" aria-label="Densité">
            {([
              ["comfortable", "Confortable"],
              ["compact", "Compacte"],
            ] as const).map(([id, name]) => (
              <button key={id} type="button" role="radio" aria-checked={(p.density ?? "comfortable") === id} className={(p.density ?? "comfortable") === id ? "on" : ""} onClick={() => set({ density: id })}>
                {name}
              </button>
            ))}
          </span>
        </SetRow>
        <SetRow label="Ouverture des tâches" hint="Dans un tiroir sur la page courante, ou en pleine page.">
          <span className="seg" role="radiogroup" aria-label="Ouverture des tâches">
            {([
              ["drawer", "Tiroir"],
              ["page", "Pleine page"],
            ] as const).map(([id, name]) => (
              <button key={id} type="button" role="radio" aria-checked={(p.openTasks ?? "drawer") === id} className={(p.openTasks ?? "drawer") === id ? "on" : ""} onClick={() => set({ openTasks: id })}>
                {name}
              </button>
            ))}
          </span>
        </SetRow>
      </SetSection>

      <SetSection title="Dates et navigation">
        <SetRow label="Début de semaine" hint="Calendriers, sélecteurs de date et statistiques hebdomadaires.">
          <span className="seg" role="radiogroup" aria-label="Début de semaine">
            {([
              [1, "Lundi"],
              [0, "Dimanche"],
            ] as const).map(([id, name]) => (
              <button key={id} type="button" role="radio" aria-checked={(p.weekStart ?? 1) === id} className={(p.weekStart ?? 1) === id ? "on" : ""} onClick={() => set({ weekStart: id })}>
                {name}
              </button>
            ))}
          </span>
        </SetRow>
        <SetRow label="Page d'accueil" hint="La page ouverte quand tu arrives dans l'espace." htmlFor="pref-home">
          <select id="pref-home" className="select" value={p.home ?? ""} onChange={(e) => set({ home: e.target.value || undefined })}>
            {HOMES.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </SetRow>
      </SetSection>
    </SetPage>
  );
}
