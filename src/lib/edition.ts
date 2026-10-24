// Éditions d'Agence OS : un seul code, trois portes d'entrée selon ce que l'élève veut piloter.
// NEXT_PUBLIC_EDITION fixe les modules proposés à la création d'un espace, le nom affiché et
// la liste des réglages de la page Installation. Les autres modules restent activables dans
// Réglages > Modules : passer d'une édition à l'autre ne demande ni migration ni nouvelle base.
import { ALL_MODULES, type ModuleId } from "./modules";

export type EditionId = "tracking" | "freelance" | "projet" | "complete";

export interface EditionDef {
  id: EditionId;
  /** Nom complet affiché (connexion, menu) */
  name: string;
  /** Suffixe ajouté à « Agence OS », vide pour l'édition complète */
  suffix: string;
  desc: string;
  modules: ModuleId[];
}

export const EDITIONS: EditionDef[] = [
  {
    id: "tracking",
    name: "Agence OS Tracking",
    suffix: "Tracking",
    desc: "Reporting Meta et Google, attribution first-party, analyse créa et liens trackés.",
    modules: ["reporting", "creatives", "tracking", "links"],
  },
  {
    id: "freelance",
    name: "Agence OS Freelance",
    suffix: "Freelance",
    desc: "CRM, propositions signées en ligne, rendez-vous, onboarding et portail client.",
    modules: ["crm", "proposals", "onboarding", "booking", "portal"],
  },
  {
    id: "projet",
    name: "Agence OS Projet",
    suffix: "Projet",
    desc: "Projets clients, tâches, calendrier, timeline et validation par le client.",
    modules: ["projects", "portal"],
  },
  {
    id: "complete",
    name: "Agence OS",
    suffix: "",
    desc: "Tout : performance, commercial et production.",
    modules: ALL_MODULES,
  },
];

export const EDITION = Object.fromEntries(EDITIONS.map((e) => [e.id, e])) as Record<EditionId, EditionDef>;

/** Édition de cette installation (variable publique, lisible côté navigateur). Par défaut : complète. */
export function currentEdition(): EditionDef {
  const id = process.env.NEXT_PUBLIC_EDITION?.trim().toLowerCase();
  return EDITION[id as EditionId] ?? EDITION.complete;
}
