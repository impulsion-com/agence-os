// En-têtes CORS des routes publiques de collecte (appelées depuis les sites suivis).
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, ...headers } });

/** Lit le corps en texte avec une taille maximale (octets). null si trop gros. */
export async function readBody(req: Request, max: number) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) return null;
  const text = await req.text();
  return text.length > max ? null : text;
}
