// Modules activables par espace de travail. Désactiver un module masque ses menus,
// actions et pages ; les données sont conservées et réapparaissent à la réactivation.
// Ce n'est pas une barrière de sécurité (la RLS reste la seule), c'est de l'ergonomie.

export type ModuleId =
  | "projects"
  | "crm"
  | "proposals"
  | "onboarding"
  | "booking"
  | "portal"
  | "reporting"
  | "tracking"
  | "links"
  | "creatives";

export interface ModuleDef {
  id: ModuleId;
  name: string;
  icon: string;
  group: "Production" | "Commercial" | "Performance";
  desc: string;
  // ce que l'élève y trouve, en quelques mots
  includes: string[];
  // modules nécessaires au bon fonctionnement
  requires?: ModuleId[];
  // préfixes de routes (relatifs à /w/<slug>) appartenant au module
  routes: string[];
}

export const MODULES: ModuleDef[] = [
  {
    id: "projects",
    name: "Gestion de projet",
    icon: "folder-kanban",
    group: "Production",
    desc: "Projets clients, tâches, tableau, liste, calendrier et timeline.",
    includes: ["Projets et modèles", "Tâches et sous-tâches", "Calendrier et timeline", "Mes tâches"],
    routes: ["/projects", "/tasks", "/my-tasks", "/calendar", "/timeline", "/overview", "/favorites"],
  },
  {
    id: "creatives",
    name: "Bibliothèque créa",
    icon: "palette",
    group: "Production",
    desc: "Concepts, angles, hooks, briefs créateurs et performance par annonce.",
    includes: ["Concepts et variantes", "Kanban de production", "Analyse créative et fatigue", "Veille concurrentielle et recommandations IA"],
    routes: ["/creatives"],
  },
  {
    id: "crm",
    name: "CRM",
    icon: "handshake",
    group: "Commercial",
    desc: "Pipeline de deals, contacts, relances et prévisionnel.",
    includes: ["Pipeline de deals", "Contacts", "Relances et activités"],
    routes: ["/crm", "/crm/deals", "/crm/contacts", "/settings/pipeline"],
  },
  {
    id: "proposals",
    name: "Propositions",
    icon: "file-signature",
    group: "Commercial",
    desc: "Devis par blocs, catalogue de services et signature électronique.",
    includes: ["Éditeur de propositions", "Signature électronique", "Catalogue de services"],
    routes: ["/proposals", "/settings/services"],
  },
  {
    id: "onboarding",
    name: "Onboarding client",
    icon: "list-checks",
    group: "Commercial",
    desc: "Formulaire d'accueil par lien : brief, fichiers et checklist des accès.",
    includes: ["Formulaires par lien", "Checklist des accès", "Modèles"],
    routes: ["/onboarding"],
  },
  {
    id: "booking",
    name: "Rendez-vous",
    icon: "calendar",
    group: "Commercial",
    desc: "Pages de réservation, Google Agenda, rappels ; chaque RDV arrive au CRM.",
    includes: ["Pages de réservation", "Disponibilités", "Connecteur Cal.com"],
    requires: ["crm"],
    routes: ["/booking"],
  },
  {
    id: "portal",
    name: "Portail client",
    icon: "door-open",
    group: "Commercial",
    desc: "Un espace à ton nom où chaque client suit ses tâches, valide ses créas et retrouve ses rapports.",
    includes: ["Accès par invitation, client par client", "Tâches, commentaires et fichiers partagés", "Validation des créas et des livrables"],
    routes: ["/portal"],
  },
  {
    id: "reporting",
    name: "Reporting",
    icon: "chart-column",
    group: "Performance",
    desc: "Meta Ads et Google Ads synchronisés, tableaux de bord et rapports clients.",
    includes: ["Connexions Meta et Google", "Tableau de bord par client", "Rapports partagés"],
    routes: ["/reporting", "/settings/integrations"],
  },
  {
    id: "tracking",
    name: "Attribution",
    icon: "mouse-pointer-click",
    group: "Performance",
    desc: "Script first-party, parcours clients et ROAS réel face aux plateformes.",
    includes: ["Script de tracking", "Modèles d'attribution", "Parcours clients"],
    routes: ["/tracking"],
  },
  {
    id: "links",
    name: "Liens trackés",
    icon: "link",
    group: "Performance",
    desc: "Générateur d'UTM, liens courts, QR codes et statistiques de clics.",
    includes: ["Générateur UTM", "Raccourcisseur et QR codes", "Conventions UTM"],
    routes: ["/links", "/settings/utm"],
  },
];

export const MODULE = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleDef>;
export const ALL_MODULES = MODULES.map((m) => m.id);

// Profils de départ proposés à la création d'un espace et dans les réglages
export const PRESETS: { id: string; name: string; desc: string; icon: string; modules: ModuleId[] }[] = [
  { id: "all", name: "Agence complète", desc: "Tout, de la prospection au reporting", icon: "sparkles", modules: ALL_MODULES },
  {
    id: "freelance",
    name: "Media buyer freelance",
    desc: "Trouver des clients, livrer, prouver les résultats",
    icon: "target",
    modules: ["projects", "crm", "proposals", "onboarding", "booking", "portal", "reporting", "links"],
  },
  { id: "crm", name: "CRM seul", desc: "Pipeline, contacts, propositions et rendez-vous", icon: "handshake", modules: ["crm", "proposals", "booking"] },
  { id: "projects", name: "Gestion de projet seule", desc: "Projets, tâches, calendrier et timeline", icon: "folder-kanban", modules: ["projects"] },
  {
    id: "performance",
    name: "Pilotage de la performance",
    desc: "Reporting, attribution, liens et créas",
    icon: "chart-column",
    modules: ["reporting", "tracking", "links", "creatives"],
  },
];

/** Liste nettoyée : ids connus uniquement ; null / vide en base = tout activé (espaces existants). */
export function readModules(raw: unknown): ModuleId[] {
  if (!Array.isArray(raw)) return ALL_MODULES;
  const ids = raw.filter((x): x is ModuleId => typeof x === "string" && x in MODULE);
  return ids.length ? ids : ALL_MODULES;
}

/** Ajoute les dépendances manquantes (activer Rendez-vous active le CRM). */
export function withRequirements(ids: ModuleId[]): ModuleId[] {
  const set = new Set(ids);
  for (const id of ids) for (const r of MODULE[id].requires ?? []) set.add(r);
  return ALL_MODULES.filter((m) => set.has(m));
}

/** Retire aussi les modules qui dépendent de celui qu'on désactive. */
export function withoutModule(ids: ModuleId[], off: ModuleId): ModuleId[] {
  return ids.filter((m) => m !== off && !(MODULE[m].requires ?? []).includes(off));
}

/** Module propriétaire d'un chemin (relatif à /w/<slug>), le plus spécifique d'abord. */
export function moduleOfPath(rel: string): ModuleId | null {
  // La liste des clients est partagée par tous les modules (voir needsCompanies)
  if (rel === "/crm/companies" || rel.startsWith("/crm/companies/")) return null;
  let best: { id: ModuleId; len: number } | null = null;
  for (const m of MODULES)
    for (const r of m.routes)
      if ((rel === r || rel.startsWith(r + "/")) && (!best || r.length > best.len)) best = { id: m.id, len: r.length };
  return best?.id ?? null;
}

/** Les clients (entreprises) servent à presque tous les modules : la liste reste visible dès qu'un module en a besoin. */
export const needsCompanies = (on: ModuleId[]) => on.some((m) => m !== "links");
