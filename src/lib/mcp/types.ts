// Types du serveur MCP d'Agence OS : contexte d'un appel et définition d'un outil.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Database, Json } from "@/lib/database.types";
import type { Role } from "@/lib/types";

export type AdminDB = SupabaseClient<Database>;

/** Contexte d'un appel, résolu à partir du jeton (utilisateur, espace, rôle, portée). */
export interface McpContext {
  /** Client service role : chaque requête DOIT filtrer par ctx.workspace.id */
  db: AdminDB;
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; slug: string; currency: string };
  role: Role;
  scope: "read" | "write";
  /** Écriture autorisée : jeton en lecture+écriture ET rôle autre qu'invité */
  canWrite: boolean;
  tokenId: string;
  /** URL publique de l'application, sans barre finale (liens vers les objets) */
  appUrl: string;
  /** Cache par requête (membres, étiquettes…) */
  cache: Map<string, unknown>;
  /** Journalise une écriture dans `activity` (acteur = utilisateur du jeton) */
  log: (row: { verb: string; project_id?: string | null; task_id?: string | null; deal_id?: string | null; meta?: Record<string, unknown> }) => Promise<void>;
}

/** Résultat d'un outil : texte compact (Markdown) + données structurées facultatives. */
export interface ToolResult {
  text: string;
  data?: Record<string, unknown> | Json;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  /** Nom en anglais snake_case, unique */
  name: string;
  /** Titre court en français */
  title: string;
  /** Description en français, lue par le modèle pour choisir l'outil */
  description: string;
  input: S;
  /** Outil d'écriture : masqué et refusé pour un jeton lecture seule ou un invité */
  write?: boolean;
  /** Appel répété sans effet supplémentaire (indication pour le client) */
  idempotent?: boolean;
  run: (args: z.output<S>, ctx: McpContext) => Promise<ToolResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;

/** Déclare un outil avec l'inférence des arguments depuis le schéma zod. */
export function defineTool<S extends z.ZodObject>(t: ToolDef<S>): AnyTool {
  return t as AnyTool;
}

/** Erreur « métier » renvoyée telle quelle au modèle (isError: true). */
export class ToolError extends Error {}
