import { after, type NextRequest } from "next/server";

import { BOT_UA } from "@/lib/tracking/channels";
import { CORS, json, preflight, readBody } from "@/lib/tracking/cors";
import { HitSchema, clientIp, ingestHit, originAllowed, rateLimited, siteByPublicKey } from "@/lib/tracking/ingest";

// POST /api/t/collect : pages vues, points de contact, identifications et évènements envoyés par /t.js.
// Corps JSON envoyé en text/plain (sendBeacon, pas de pré-vol CORS). Réponse immédiate, travail dans after().
const ok = () => new Response(null, { status: 204, headers: CORS });

export async function POST(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return ok();
  const text = await readBody(req, 16_384);
  if (text === null) return json({ error: "trop volumineux" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }
  const parsed = HitSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "requête invalide" }, 400);
  const hit = parsed.data;
  if (rateLimited(`${hit.k}|${clientIp(req)}`)) return json({ error: "trop de requêtes" }, 429);

  const site = await siteByPublicKey(hit.k);
  if (!site) return json({ error: "clé inconnue" }, 404);
  if (!originAllowed(site, req.headers.get("origin"))) return json({ error: "domaine non autorisé" }, 403);

  // Pays seulement (en-tête Vercel), jamais l'adresse IP
  const country = req.headers.get("x-vercel-ip-country")?.slice(0, 2).toUpperCase() || null;
  after(() => ingestHit(site, hit, { ua, country }).catch((e) => console.error("[tracking] collecte", e)));
  return ok();
}

export const OPTIONS = preflight;
