import type { NextRequest } from "next/server";

import { CORS, json, preflight } from "@/lib/tracking/cors";
import { siteByPublicKey } from "@/lib/tracking/ingest";
import { normalizeDomain } from "@/lib/tracking/settings";

// GET /api/t/config?k=pk_… : réglages publics lus par le script (domaines, consentement, formulaires).
export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get("k") ?? "";
  if (!/^pk_[a-f0-9]{8,64}$/.test(k)) return json({ error: "clé invalide" }, 400);
  const site = await siteByPublicKey(k);
  if (!site) return json({ error: "clé inconnue" }, 404, { "Cache-Control": "public, max-age=60" });
  return json(
    { d: site.domains.map(normalizeDomain).filter(Boolean), c: site.settings.consent, f: site.settings.capture_forms },
    200,
    { ...CORS, "Cache-Control": "public, max-age=300" },
  );
}

export const OPTIONS = preflight;
