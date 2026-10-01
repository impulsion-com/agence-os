// Navigation du portail client : onglets selon les fonctionnalités ouvertes, entreprise courante, liens.
// Pur (client et serveur) : le layout ne reçoit pas les paramètres d'URL, la coque les lit côté client
// et les pages côté serveur, avec la même règle (pickPortal).

import type { PortalContext, PortalFeature, PortalInfo } from "./types";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PortalTab {
  id: "home" | "performance" | "tasks" | "creatives" | "files" | "documents";
  name: string;
  path: string; // relatif à /c/<slug>
  icon: string;
  // l'onglet s'affiche si au moins une de ces fonctionnalités est ouverte (aucune = toujours)
  any: PortalFeature[];
}

export const PORTAL_TABS: PortalTab[] = [
  { id: "home", name: "Accueil", path: "", icon: "house", any: [] },
  { id: "performance", name: "Performance", path: "performance", icon: "chart-column", any: ["reporting"] },
  { id: "tasks", name: "Projet", path: "tasks", icon: "list-checks", any: ["tasks"] },
  { id: "creatives", name: "Créas", path: "creatives", icon: "palette", any: ["creatives"] },
  { id: "files", name: "Fichiers", path: "files", icon: "paperclip", any: ["files"] },
  { id: "documents", name: "Documents", path: "documents", icon: "file-text", any: ["documents", "onboarding", "booking"] },
];

export const tabsFor = (p: PortalInfo | null) => PORTAL_TABS.filter((t) => !t.any.length || t.any.some((f) => p?.features.includes(f)));

export const can = (p: PortalInfo | null | undefined, f: PortalFeature) => !!p?.features.includes(f);

/** Cookie de mémorisation de l'entreprise choisie, par espace. */
export const companyCookie = (slug: string) => `aos-portal-${slug}`;

/**
 * Entreprise courante : paramètre ?company=<id> s'il désigne un portail de la liste, sinon le cookie,
 * sinon le premier portail. Un identifiant inconnu est ignoré (jamais d'accès par simple paramètre :
 * la liste vient de portal_context, et chaque fonction portal_* revérifie de toute façon).
 */
export function pickPortal(ctx: PortalContext, param: string | null | undefined, cookie: string | null | undefined): PortalInfo | null {
  const find = (id: string | null | undefined) => (id && UUID.test(id) ? ctx.portals.find((p) => p.company_id === id) : undefined);
  return find(param) ?? find(cookie) ?? ctx.portals[0] ?? null;
}

/** Faut-il garder ?company= dans les liens ? (plusieurs entreprises, ou aperçu par un membre) */
export const needsCompanyParam = (ctx: PortalContext) => ctx.preview || ctx.portals.length > 1;

/** Lien interne du portail : /c/<slug>/<path>, avec l'entreprise si nécessaire. `path` peut porter sa propre query. */
export function portalHref(ctx: PortalContext, companyId: string | null, path = "") {
  const [p, query = ""] = path.replace(/^\/+/, "").split("?");
  const q = new URLSearchParams(query);
  if (companyId && needsCompanyParam(ctx)) q.set("company", companyId);
  const qs = q.toString();
  return `/c/${ctx.workspace.slug}${p ? `/${p}` : ""}${qs ? `?${qs}` : ""}`;
}

/** URL de la route serveur qui délivre un fichier (redirige vers une URL signée courte). */
export function fileUrl(companyId: string, kind: "file" | "task" | "asset", id: string, opt: { task?: string; download?: boolean } = {}) {
  const q = new URLSearchParams({ company: companyId, kind, id });
  if (opt.task) q.set("task", opt.task);
  if (opt.download) q.set("download", "1");
  return `/api/portal/file?${q}`;
}

/** Un lien de notification est un chemin relatif au portail : on refuse tout ce qui sortirait de /c/<slug>. */
export function safePortalLink(link: string | null | undefined) {
  if (!link) return null;
  const l = link.replace(/^\/+/, "");
  if (!/^[a-z-]*(\?[A-Za-z0-9_=&%.-]*)?$/.test(l)) return null;
  const [p] = l.split("?");
  return PORTAL_TABS.some((t) => t.path === p) ? l : null;
}
