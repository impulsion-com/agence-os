import type { NextRequest } from "next/server";

import { oauthStart } from "@/lib/ads/oauth";

/** Départ OAuth Google Analytics 4 (même client OAuth que Google Ads, scope analytics.readonly). */
export async function GET(req: NextRequest) {
  return oauthStart(req, "ga4");
}
