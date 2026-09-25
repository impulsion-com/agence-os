import type { NextRequest } from "next/server";

import { oauthCallback } from "@/lib/ads/oauth";

export async function GET(req: NextRequest) {
  return oauthCallback(req, "meta");
}
