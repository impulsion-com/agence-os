"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { TaskCreateModal, type TaskDefaults } from "@/components/tasks/task-create-modal";
import { ProjectCreateModal } from "@/components/projects/project-create-modal";
import { DealCreateModal, type DealDefaults } from "@/components/crm/deal-create-modal";
import { ProposalCreateModal, type ProposalDefaults } from "@/components/proposals/proposal-create-modal";
import { InviteModal } from "@/components/shell/invite-modal";

type Create =
  | { kind: "task"; defaults?: TaskDefaults }
  | { kind: "project" }
  | { kind: "deal"; defaults?: DealDefaults }
  | { kind: "proposal"; defaults?: ProposalDefaults }
  | { kind: "invite" };

interface UI {
  create: (c: Create) => void;
  palette: boolean;
  setPalette: (v: boolean) => void;
}

const UICtx = createContext<UI>({ create: () => {}, palette: false, setPalette: () => {} });

// Couches globales : modales de création et palette de commandes.
export function UIProvider({ children }: { children: ReactNode }) {
  const [c, setC] = useState<Create | null>(null);
  const [palette, setPalette] = useState(false);
  const close = useCallback(() => setC(null), []);
  return (
    <UICtx.Provider value={{ create: setC, palette, setPalette }}>
      {children}
      {c?.kind === "task" && <TaskCreateModal defaults={c.defaults} onClose={close} />}
      {c?.kind === "project" && <ProjectCreateModal onClose={close} />}
      {c?.kind === "deal" && <DealCreateModal defaults={c.defaults} onClose={close} />}
      {c?.kind === "proposal" && <ProposalCreateModal defaults={c.defaults} onClose={close} />}
      {c?.kind === "invite" && <InviteModal onClose={close} />}
    </UICtx.Provider>
  );
}

export const useUI = () => useContext(UICtx);
