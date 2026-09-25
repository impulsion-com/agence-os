"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { useWorkspace } from "@/lib/workspace/context";
import { TeamModal } from "../team-modal";
import { TeamsGrid } from "../teams";
import { SetPage, SetSection } from "./shell";

export function TeamsSettings({ openByTeam }: { openByTeam: Record<string, number> }) {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  return (
    <SetPage title="Équipes" lead="Regroupe les membres par métier et rattache-leur des projets. Un membre appartient à une équipe au plus." wide>
      <SetSection
        title={`${ws.teams.length} équipe${ws.teams.length > 1 ? "s" : ""}`}
        action={
          ws.isAdmin ? (
            <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
              <Plus size={13} />
              Nouvelle équipe
            </button>
          ) : undefined
        }
      >
        <div style={{ paddingTop: 12 }}>
          <TeamsGrid openByTeam={openByTeam} />
        </div>
      </SetSection>
      {creating && <TeamModal onClose={() => setCreating(false)} />}
    </SetPage>
  );
}
