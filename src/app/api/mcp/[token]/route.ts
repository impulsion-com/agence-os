import { handleMcpPost, methodNotAllowed } from "@/lib/mcp/server";

// Variante « URL secrète » pour les connecteurs qui n'acceptent pas d'en-tête
// (connecteur personnalisé de Claude.ai, Claude Desktop, Cowork) : /api/mcp/aos_…
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleMcpPost(request, decodeURIComponent(token));
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
