// Registre des outils MCP d'Agence OS : un fichier par domaine.
//
// Ajouter les outils d'un module (bibliothèque créa, rendez-vous, onboarding, signature…) :
//   1. créer src/lib/mcp/tools/<module>.ts qui exporte un tableau `export const <module>Tools = [defineTool({…}), …]` ;
//   2. l'ajouter à DOMAINS ci-dessous, avec le libellé affiché dans Réglages > API et MCP.
// Règles : noms en anglais snake_case et uniques, descriptions et sorties en français,
// `write: true` pour tout outil qui modifie la base, et TOUJOURS filtrer par ctx.workspace.id.
import type { ModuleId } from "@/lib/modules";
import type { AnyTool } from "../types";
import { attributionTools } from "./attribution";
import { crmTools } from "./crm";
import { linkTools } from "./links";
import { projectTools } from "./projects";
import { proposalTools } from "./proposals";
import { reportingTools } from "./reporting";
import { taskTools } from "./tasks";
import { workspaceTools } from "./workspace";

// `module` : les outils n'apparaissent que si ce module est activé dans l'espace (Réglages > Modules)
export const DOMAINS: { label: string; tools: AnyTool[]; module?: ModuleId }[] = [
  { label: "Espace", tools: workspaceTools },
  { label: "Projets", tools: projectTools, module: "projects" },
  { label: "Tâches", tools: taskTools, module: "projects" },
  { label: "CRM", tools: crmTools, module: "crm" },
  { label: "Propositions", tools: proposalTools, module: "proposals" },
  { label: "Reporting", tools: reportingTools, module: "reporting" },
  { label: "Attribution", tools: attributionTools, module: "tracking" },
  { label: "Liens trackés", tools: linkTools, module: "links" },
];

export const TOOL_MODULE = new Map<string, ModuleId | undefined>(DOMAINS.flatMap((d) => d.tools.map((t) => [t.name, d.module] as const)));

export const TOOLS: AnyTool[] = DOMAINS.flatMap((d) => d.tools);

// Garde-fou au chargement : un nom en double casserait le choix des outils par le modèle
const names = new Set<string>();
for (const t of TOOLS) {
  if (names.has(t.name)) throw new Error(`Outil MCP en double : ${t.name}`);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(t.name)) throw new Error(`Nom d'outil MCP invalide : ${t.name}`);
  names.add(t.name);
}
