// Portail client, côté agence : libellés des fonctionnalités, des modes de partage et des validations.
// (Le portail que voit le client vit dans src/lib/portal et src/components/portal.)
import type { ModuleId } from "@/lib/modules";
import type { ClientReview, PortalFeature, PortalMode, Project, Task } from "@/lib/types";

export interface PortalFeatureDef {
  id: PortalFeature;
  name: string;
  desc: string;
  icon: string;
  // module de l'espace dont dépend la fonctionnalité
  module: ModuleId;
}

// Même ordre que portal_all_features() en base
export const PORTAL_FEATURES: PortalFeatureDef[] = [
  { id: "reporting", name: "Performance", desc: "Tableau de bord publicitaire et rapports publiés", icon: "chart-column", module: "reporting" },
  { id: "tasks", name: "Projet et tâches", desc: "Tâches visibles, commentaires partagés et validations", icon: "list-checks", module: "projects" },
  { id: "creatives", name: "Créas à valider", desc: "Concepts envoyés en validation, avec approbation ou demande de modification", icon: "palette", module: "creatives" },
  { id: "files", name: "Fichiers", desc: "Fichiers partagés par l'agence et dépôt de documents", icon: "paperclip", module: "projects" },
  { id: "documents", name: "Documents et signature", desc: "Propositions à consulter et à signer", icon: "file-signature", module: "proposals" },
  { id: "onboarding", name: "Onboarding", desc: "Formulaire d'accueil et checklist des accès", icon: "list-checks", module: "onboarding" },
  { id: "booking", name: "Rendez-vous", desc: "Prise de rendez-vous avec l'agence", icon: "calendar", module: "booking" },
];
export const PORTAL_FEATURE = Object.fromEntries(PORTAL_FEATURES.map((f) => [f.id, f])) as Record<PortalFeature, PortalFeatureDef>;
export const ALL_PORTAL_FEATURES = PORTAL_FEATURES.map((f) => f.id);

/** Remet une liste de fonctionnalités dans l'ordre d'affichage, sans doublon ni valeur inconnue. */
export const sortFeatures = (list: readonly string[]) => ALL_PORTAL_FEATURES.filter((f) => list.includes(f));

/** Résumé court : « Toutes », « Performance, Fichiers » ou « 4 fonctionnalités ». */
export function featureSummary(list: readonly string[] | null, all: readonly string[]) {
  if (list === null) return "Toutes celles du portail";
  const on = sortFeatures(list).filter((f) => all.includes(f));
  if (!on.length) return "Aucune";
  if (on.length === all.length) return "Toutes celles du portail";
  return on.length <= 2 ? on.map((f) => PORTAL_FEATURE[f].name).join(", ") : `${on.length} fonctionnalités`;
}

export const PORTAL_MODES: { id: PortalMode; name: string; desc: string }[] = [
  { id: "none", name: "Aucune tâche", desc: "Le client ne voit pas ce projet, ni ses fichiers" },
  { id: "selected", name: "Tâches cochées", desc: "Seulement les tâches marquées « Visible par le client »" },
  { id: "all", name: "Toutes les tâches", desc: "Tout le projet, sauf les commentaires internes" },
];
export const PORTAL_MODE = Object.fromEntries(PORTAL_MODES.map((m) => [m.id, m])) as Record<PortalMode, (typeof PORTAL_MODES)[number]>;

/** Une tâche est-elle visible sur le portail ? (même règle que portal_task_visible en base) */
export function taskVisibleToClient(t: Pick<Task, "client_visible" | "archived_at">, p: Pick<Project, "company_id" | "portal_mode" | "archived_at"> | undefined) {
  if (!p || !p.company_id || p.archived_at || t.archived_at) return false;
  return p.portal_mode === "all" || (p.portal_mode === "selected" && !!t.client_visible);
}

export const CLIENT_REVIEWS: { id: ClientReview; name: string; short: string; color: string }[] = [
  { id: "pending", name: "En attente du client", short: "En attente", color: "var(--amber)" },
  { id: "approved", name: "Approuvée par le client", short: "Approuvée", color: "var(--green)" },
  { id: "changes", name: "Modifications demandées", short: "Modifications demandées", color: "var(--red)" },
];
export const CLIENT_REVIEW = Object.fromEntries(CLIENT_REVIEWS.map((r) => [r.id, r])) as Record<ClientReview, (typeof CLIENT_REVIEWS)[number]>;

/** Adresse du portail d'un client, vue par l'agence (aperçu) ou envoyée au client. */
export const portalPath = (slug: string, companyId?: string | null, link = "") => {
  const [path, query = ""] = link.split("?");
  const q = new URLSearchParams(query);
  if (companyId) q.set("company", companyId);
  const qs = q.toString();
  return `/c/${slug}${path ? `/${path}` : ""}${qs ? `?${qs}` : ""}`;
};

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
