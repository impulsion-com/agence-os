import type { GroupKey, Priority, ProjectStatus, Role, SortKey, TaskStatus } from "./types";

export const APP_NAME = "Agence OS";

export const STATUSES: { id: TaskStatus; name: string }[] = [
  { id: "backlog", name: "Backlog" },
  { id: "todo", name: "À faire" },
  { id: "progress", name: "En cours" },
  { id: "review", name: "Validation client" },
  { id: "done", name: "Terminé" },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<TaskStatus, { id: TaskStatus; name: string }>;

export const PRIORITIES: { id: Priority; name: string; weight: number }[] = [
  { id: "urgent", name: "Urgent", weight: 4 },
  { id: "high", name: "Haute", weight: 3 },
  { id: "medium", name: "Moyenne", weight: 2 },
  { id: "low", name: "Basse", weight: 1 },
  { id: "none", name: "Sans priorité", weight: 0 },
];
export const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.id, p])) as Record<Priority, { id: Priority; name: string; weight: number }>;

export const PROJECT_STATUS: Record<ProjectStatus, { name: string; color: string }> = {
  planning: { name: "Cadrage", color: "var(--gray)" },
  active: { name: "En cours", color: "var(--blue)" },
  risk: { name: "À risque", color: "var(--red)" },
  hold: { name: "En pause", color: "var(--amber)" },
  complete: { name: "Terminé", color: "var(--green)" },
};

export const ROLES: { id: Role; name: string; desc: string }[] = [
  { id: "owner", name: "Propriétaire", desc: "Tous les droits, facturation et suppression de l'espace" },
  { id: "admin", name: "Admin", desc: "Gère les membres, les réglages et les intégrations" },
  { id: "member", name: "Membre", desc: "Crée et modifie projets, tâches, deals et propositions" },
  { id: "guest", name: "Invité", desc: "Lecture seule, idéal pour un client ou un freelance" },
];
export const ROLE = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<Role, { id: Role; name: string; desc: string }>;

// Couleurs nommées (projets, étiquettes) → variables CSS
export const COLORS: Record<string, string> = {
  indigo: "#5A67D8",
  blue: "#3B82C4",
  violet: "#8662C9",
  teal: "#23918A",
  rose: "#C54B78",
  amber: "#C48A1E",
  green: "#3D8E5F",
  orange: "#C0612B",
  red: "#B23C30",
  slate: "#6B7280",
  gray: "#8A867E",
};
export const colorOf = (c: string | null | undefined) => (c && COLORS[c]) || c || COLORS.gray;

export const SORTS: { id: SortKey; name: string }[] = [
  { id: "manual", name: "Manuel" },
  { id: "priority", name: "Priorité" },
  { id: "due", name: "Échéance" },
  { id: "created", name: "Création" },
  { id: "updated", name: "Mise à jour" },
  { id: "title", name: "Titre" },
];

export const GROUPS: { id: GroupKey; name: string }[] = [
  { id: "status", name: "Statut" },
  { id: "priority", name: "Priorité" },
  { id: "assignee", name: "Responsable" },
  { id: "project", name: "Projet" },
  { id: "label", name: "Étiquette" },
  { id: "none", name: "Aucun" },
];

export const PLATFORMS: { id: string; name: string; color: string }[] = [
  { id: "meta", name: "Meta Ads", color: "#3B82C4" },
  { id: "google", name: "Google Ads", color: "#C48A1E" },
  { id: "tiktok", name: "TikTok Ads", color: "#E1306C" },
  { id: "linkedin", name: "LinkedIn Ads", color: "#23918A" },
  { id: "snapchat", name: "Snapchat Ads", color: "#C48A1E" },
  { id: "pinterest", name: "Pinterest Ads", color: "#B23C30" },
  { id: "chatgpt", name: "ChatGPT Ads", color: "#3D8E5F" },
];

export const DEAL_SOURCES = ["Site web", "Recommandation", "LinkedIn", "Publicité", "Malt", "Événement", "Prospection", "Autre"];

export const INDUSTRIES = ["E-commerce", "SaaS", "Formation", "Immobilier", "Santé", "Restauration", "Services B2B", "Local", "Autre"];

// Modèles de projet orientés agence : tâches de départ [titre, statut, label, décalage échéance en jours]
export interface ProjectTemplate {
  id: string;
  name: string;
  icon: string;
  desc: string;
  tasks: { title: string; label?: string; due?: number; milestone?: boolean }[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: "blank", name: "Projet vide", icon: "folder", desc: "Aucune tâche de départ", tasks: [] },
  {
    id: "onboarding",
    name: "Onboarding client",
    icon: "briefcase",
    desc: "Accès, kick-off, tracking et premier plan média",
    tasks: [
      { title: "Récupérer les accès (Business Manager, Google Ads, GA4, GTM)", label: "Client", due: 2 },
      { title: "Réunion de lancement et questionnaire client", label: "Client", due: 3 },
      { title: "Audit du tracking et des conversions", label: "Tracking", due: 5 },
      { title: "Recherche concurrents et Ad Library", label: "Créa", due: 6 },
      { title: "Plan média et répartition du budget", label: "Média", due: 8 },
      { title: "Validation du plan par le client", label: "Client", due: 10, milestone: true },
    ],
  },
  {
    id: "meta-launch",
    name: "Lancement Meta Ads",
    icon: "megaphone",
    desc: "Du brief créa à la mise en ligne des campagnes",
    tasks: [
      { title: "Vérifier Pixel + API de conversions", label: "Tracking", due: 2 },
      { title: "Définir 3 angles marketing et personas", label: "Créa", due: 3 },
      { title: "Brief créa : 6 concepts (statiques + UGC)", label: "Créa", due: 5 },
      { title: "Rédaction des textes publicitaires (3 variantes)", label: "Copy", due: 6 },
      { title: "Production des créas", label: "Créa", due: 9 },
      { title: "Structure de campagne et audiences", label: "Média", due: 10 },
      { title: "Mise en ligne des campagnes", label: "Média", due: 11, milestone: true },
      { title: "Premier point d'optimisation J+7", label: "Reporting", due: 18 },
    ],
  },
  {
    id: "google-audit",
    name: "Audit Google Ads",
    icon: "target",
    desc: "Audit complet et restitution au client",
    tasks: [
      { title: "Vérifier le suivi des conversions", label: "Tracking", due: 2 },
      { title: "Analyse structure, mots-clés et termes de recherche", label: "Média", due: 4 },
      { title: "Analyse des annonces et composants", label: "Copy", due: 5 },
      { title: "Analyse des pages de destination", label: "Landing", due: 6 },
      { title: "Rédaction du rapport d'audit", label: "Reporting", due: 8 },
      { title: "Restitution au client", label: "Client", due: 10, milestone: true },
    ],
  },
  {
    id: "creative-sprint",
    name: "Sprint créa mensuel",
    icon: "palette",
    desc: "Recherche, concepts, production et test",
    tasks: [
      { title: "Analyse des créas gagnantes du mois", label: "Reporting", due: 2 },
      { title: "Veille concurrentielle et tendances", label: "Créa", due: 3 },
      { title: "8 nouveaux concepts (hooks + angles)", label: "Créa", due: 5 },
      { title: "Scripts UGC et briefs créateurs", label: "Copy", due: 7 },
      { title: "Production et montage", label: "Créa", due: 12 },
      { title: "Validation client", label: "Client", due: 14 },
      { title: "Lancement du test créa", label: "Média", due: 15, milestone: true },
    ],
  },
  {
    id: "monthly-report",
    name: "Suivi mensuel client",
    icon: "chart-column",
    desc: "Optimisations hebdo et rapport de fin de mois",
    tasks: [
      { title: "Optimisation semaine 1", label: "Média", due: 7 },
      { title: "Optimisation semaine 2", label: "Média", due: 14 },
      { title: "Optimisation semaine 3", label: "Média", due: 21 },
      { title: "Rapport mensuel et recommandations", label: "Reporting", due: 28 },
      { title: "Point mensuel avec le client", label: "Client", due: 30, milestone: true },
    ],
  },
];

export const PROJECT_ICONS = [
  "folder", "megaphone", "target", "palette", "briefcase", "rocket", "globe", "smartphone",
  "shopping-bag", "clapperboard", "pen-tool", "chart-column", "sparkles", "layers", "zap", "heart",
];
