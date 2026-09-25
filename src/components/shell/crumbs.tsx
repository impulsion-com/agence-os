"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { useWorkspace } from "@/lib/workspace/context";

export interface Crumb {
  label: string;
  href?: string;
}

const NAMES: Record<string, string> = {
  inbox: "Boîte de réception", "my-tasks": "Mes tâches", favorites: "Favoris", search: "Recherche", overview: "Vue d'ensemble",
  projects: "Projets", tasks: "Tâches", calendar: "Calendrier", timeline: "Timeline", members: "Membres", teams: "Équipes",
  activity: "Activité", archive: "Archives", settings: "Réglages", crm: "Pipeline", companies: "Clients & prospects",
  contacts: "Contacts", deals: "Deals", proposals: "Propositions", services: "Catalogue de services", reporting: "Reporting",
  reports: "Rapports", connections: "Connexions publicitaires",
};

const Ctx = createContext<{ set: (c: Crumb[] | null) => void; value: Crumb[] | null }>({ set: () => {}, value: null });

export function CrumbsProvider({ children }: { children: ReactNode }) {
  const [value, set] = useState<Crumb[] | null>(null);
  const path = usePathname();
  // Réinitialise la surcharge à chaque navigation
  useEffect(() => set(null), [path]);
  return <Ctx.Provider value={{ value, set }}>{children}</Ctx.Provider>;
}

/** Surcharge le fil d'Ariane depuis une page (ex. nom du projet) */
export function SetCrumbs({ items }: { items: Crumb[] }) {
  const { set } = useContext(Ctx);
  const key = JSON.stringify(items);
  useEffect(() => {
    set(JSON.parse(key));
  }, [key, set]);
  return null;
}

export function useCrumbs(): Crumb[] {
  const { value } = useContext(Ctx);
  const ws = useWorkspace();
  const path = usePathname();
  if (value) return value;
  const parts = path.replace(ws.base, "").split("/").filter(Boolean);
  if (!parts.length) return [{ label: "Accueil" }];
  const out: Crumb[] = [];
  let href = ws.base;
  for (const p of parts) {
    href += "/" + p;
    if (NAMES[p]) out.push({ label: NAMES[p], href });
  }
  return out.length ? out : [{ label: "Accueil" }];
}
