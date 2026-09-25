import type { NextRequest } from "next/server";

import { json, preflight, readBody } from "@/lib/tracking/cors";
import { ConversionSchema, bearer, clientIp, rateLimited, recordConversion, siteBySecretKey } from "@/lib/tracking/ingest";

/**
 * POST /api/t/conversion (Authorization: Bearer sk_…)
 * { email | anon_id, type: "purchase" | "lead" | "booking" | …, value, currency, order_id, ts, name, phone, props }
 * Idempotente par (type, order_id) : un renvoi répond 200 { duplicate: true }.
 */
export async function POST(req: NextRequest) {
  const key = bearer(req);
  if (!key) return json({ error: "Clé secrète manquante (Authorization: Bearer sk_…)" }, 401);
  if (rateLimited(`sk|${key.slice(0, 12)}|${clientIp(req)}`, 600)) return json({ error: "Trop de requêtes" }, 429);
  const site = await siteBySecretKey(key);
  if (!site) return json({ error: "Clé secrète invalide" }, 401);

  const text = await readBody(req, 16_384);
  if (text === null) return json({ error: "Corps trop volumineux" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }
  const parsed = ConversionSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Requête invalide", details: parsed.error.issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`) }, 400);

  const res = await recordConversion(site, parsed.data, "api");
  if (!res.ok) return json({ error: res.error }, res.status);
  return json({ ok: true, duplicate: res.duplicate, id: res.duplicate ? undefined : res.id }, res.status);
}

export const OPTIONS = preflight;
