import "server-only";

import { z } from "zod";

import { APP_NAME } from "@/lib/constants";
import type { Json } from "@/lib/database.types";
import { AuthError, authenticate, readToken } from "./auth";
import { LIMITS, clientIp, hit, peek } from "./rate-limit";
import { TOOLS } from "./tools";
import { ToolError, type AnyTool, type McpContext } from "./types";

// Serveur MCP en Streamable HTTP, mode sans état : chaque POST porte un message
// JSON-RPC (ou un lot) et reçoit sa réponse en application/json. Pas de flux SSE.

export const SERVER_VERSION = "1.0.0";
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = "2025-06-18";
const MAX_BODY = 1_000_000;

type Id = string | number | null;
interface RpcMessage {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

function instructions(ctx: McpContext) {
  return [
    `${APP_NAME} : espace de travail de l'agence « ${ctx.workspace.name} » (gestion de projet, CRM, propositions commerciales, reporting Meta et Google Ads, attribution, liens trackés).`,
    `Tu agis au nom de ${ctx.user.name || ctx.user.email} (${ctx.role}). ${ctx.canWrite ? "Lecture et écriture autorisées." : "Accès en lecture seule : aucun outil d'écriture n'est disponible."}`,
    "Commence par whoami pour connaître les membres, étiquettes, étapes du pipeline et services. Les références acceptent un identifiant, une clé de tâche (ACME-12), une clé de projet ou un nom (sans ambiguïté). « me » désigne l'utilisateur du jeton.",
    `Dates au format AAAA-MM-JJ (ou « aujourd'hui », « demain », « +7 »). Montants dans la devise de l'espace (${ctx.workspace.currency}).`,
    "Chaque réponse contient un résumé en Markdown et des liens vers l'application : cite-les à l'utilisateur quand c'est utile. Confirme avec l'utilisateur avant une écriture importante (deal gagné ou perdu, création en série).",
  ].join("\n");
}

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------
const schemaCache = new Map<string, unknown>();
function inputSchema(t: AnyTool) {
  if (!schemaCache.has(t.name)) {
    const s = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete s.$schema;
    schemaCache.set(t.name, s);
  }
  return schemaCache.get(t.name);
}

const visible = (ctx: McpContext) => TOOLS.filter((t) => !t.write || ctx.canWrite);

function describe(t: AnyTool) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchema(t),
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write || !!t.idempotent, openWorldHint: false },
  };
}

function zodMessage(err: z.ZodError) {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "arguments"} : ${i.message}`)
    .join(" ; ");
}

async function callTool(ctx: McpContext, params: Record<string, unknown>, structured: boolean) {
  const name = String(params.name ?? "");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: { code: -32602, message: `Outil inconnu : ${name}` } };
  const text = (s: string, isError = false, data?: unknown) => ({
    result: { content: [{ type: "text", text: s }], ...(structured && data ? { structuredContent: data } : {}), ...(isError ? { isError: true } : {}) },
  });
  if (tool.write && !ctx.canWrite) {
    return text(
      ctx.role === "guest"
        ? "Refusé : ton rôle dans l'espace est « Invité », en lecture seule."
        : "Refusé : ce jeton est en lecture seule. Crée un jeton « Lecture et écriture » dans Réglages > API et MCP.",
      true,
    );
  }
  if (tool.write) {
    const wait = hit(`w:${ctx.tokenId}`, LIMITS.writesPerToken);
    if (wait) return text(`Trop d'écritures en une minute : réessaie dans ${wait} s.`, true);
  }
  const parsed = tool.input.safeParse(params.arguments ?? {});
  if (!parsed.success) return text(`Arguments invalides : ${zodMessage(parsed.error)}`, true);
  try {
    const out = await tool.run(parsed.data, ctx);
    return text(out.text, false, out.data);
  } catch (e) {
    if (e instanceof ToolError) return text(e.message, true);
    console.error(`[mcp] ${tool.name}`, e);
    return text(`Erreur interne pendant ${tool.name} : ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

async function handle(msg: RpcMessage, ctx: McpContext, structured: boolean) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return fail(null, -32600, "Requête JSON-RPC invalide");
  // Réponse ou notification du client : rien à renvoyer
  if (typeof msg.method !== "string") return null;
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  const id = msg.id ?? null;
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "agence-os", title: APP_NAME, version: SERVER_VERSION },
        instructions: instructions(ctx),
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: visible(ctx).map(describe) });
    case "tools/call": {
      const r = await callTool(ctx, params, structured);
      return "error" in r ? fail(id, r.error.code, r.error.message) : ok(id, r.result);
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fail(id, -32601, `Méthode non prise en charge : ${msg.method}`);
  }
}

// ---------------------------------------------------------------------
// Point d'entrée HTTP
// ---------------------------------------------------------------------
export async function handleMcpPost(request: Request, pathToken?: string | null): Promise<Response> {
  const ip = clientIp(request);
  if (peek(`f:${ip}`, LIMITS.failuresPerIp)) return json(fail(null, -32000, "Trop de tentatives, réessaie dans une minute."), 429, { "Retry-After": "60" });

  const ctype = request.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) return json(fail(null, -32700, "Content-Type attendu : application/json"), 415);

  let base: Awaited<ReturnType<typeof authenticate>>;
  try {
    base = await authenticate(readToken(request, pathToken), request);
  } catch (e) {
    if (e instanceof AuthError) {
      hit(`f:${ip}`, LIMITS.failuresPerIp);
      return json(fail(null, -32001, e.message), e.status, e.status === 401 ? { "WWW-Authenticate": `Bearer realm="agence-os", error="invalid_token"` } : {});
    }
    throw e;
  }

  const wait = hit(`t:${base.tokenId}`, LIMITS.perToken);
  if (wait) return json(fail(null, -32000, `Limite de ${LIMITS.perToken} appels par minute atteinte, réessaie dans ${wait} s.`), 429, { "Retry-After": String(wait) });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(fail(null, -32600, "Requête trop volumineuse"), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(fail(null, -32700, "JSON invalide"), 400);
  }

  const ctx: McpContext = {
    ...base,
    cache: new Map(),
    log: async (row) => {
      await base.db.from("activity").insert({
        workspace_id: base.workspace.id,
        actor_id: base.user.id,
        verb: row.verb,
        project_id: row.project_id ?? null,
        task_id: row.task_id ?? null,
        deal_id: row.deal_id ?? null,
        meta: { ...(row.meta ?? {}), via: "mcp" } as Json,
      });
    },
  };

  // structuredContent : à partir de la version 2025-06-18 du protocole
  const version = request.headers.get("mcp-protocol-version") ?? "";
  const structured = version >= "2025-06-18";

  if (Array.isArray(body)) {
    if (!body.length) return json(fail(null, -32600, "Lot vide"), 400);
    const out = (await Promise.all(body.slice(0, 20).map((m) => handle(m as RpcMessage, ctx, structured)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const res = await handle(body as RpcMessage, ctx, structured);
  return res ? json(res) : new Response(null, { status: 202 });
}

export function methodNotAllowed() {
  return json(fail(null, -32000, "Ce serveur MCP est sans état : utilise POST (Streamable HTTP, réponses JSON)."), 405, { Allow: "POST" });
}
