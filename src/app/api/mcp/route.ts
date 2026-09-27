import { handleMcpPost, methodNotAllowed } from "@/lib/mcp/server";

// Serveur MCP d'Agence OS (Streamable HTTP, sans état). Authentification :
// en-tête « Authorization: Bearer aos_… » (jeton créé dans Réglages > API et MCP).
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleMcpPost(request);
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
