"use client";

import { useState } from "react";

import { SetPage, SetSection } from "@/components/workspace/settings/shell";
import { MODULE, type ModuleId } from "@/lib/modules";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { ModuleSelector } from "./module-selector";

const names = (ids: ModuleId[]) => ids.map((i) => MODULE[i].name).join(", ");

// Réglages > Modules : chaque changement est enregistré tout de suite, avec annulation.
export function ModulesSettings() {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [value, setValue] = useState<ModuleId[]>(ws.modules);
  const save = (next: ModuleId[], msg: string) => {
    const prev = value;
    setValue(next);
    void mutate(async (sb) => must(await sb.from("workspaces").update({ modules: next }).eq("id", ws.workspace.id)), {
      success: msg,
      undo: async () => {
        setValue(prev);
        const { supabaseBrowser } = await import("@/lib/supabase/client");
        await supabaseBrowser().from("workspaces").update({ modules: prev }).eq("id", ws.workspace.id);
      },
    });
  };
  return (
    <SetPage
      title="Modules"
      wide
      lead={
        ws.isAdmin
          ? "Active seulement ce dont tu as besoin : les menus, les actions et l'accueil s'adaptent pour tout l'espace. Rien n'est supprimé quand tu désactives un module, tes données réapparaissent à la réactivation."
          : "Les modules activés dans cet espace. Seuls les propriétaires et admins peuvent les modifier."
      }
    >
      <SetSection title="Fonctionnalités de l'espace">
        <ModuleSelector
          value={value}
          disabled={!ws.isAdmin}
          onChange={(next, c) => {
            if (!c) return save(next, "Profil appliqué");
            const m = MODULE[c.id].name;
            const also = c.also.length ? ` (et ${names(c.also)})` : "";
            save(next, `${m}${also} ${c.on ? "activé" : "désactivé"}${c.also.length ? "s" : ""}`);
          }}
        />
      </SetSection>
      <SetSection title="Toujours inclus">
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Accueil, boîte de réception, recherche, clients, membres, équipes, activité, réglages, et le serveur MCP (ses outils suivent les modules activés).
        </p>
      </SetSection>
    </SetPage>
  );
}
