import type { NextRequest } from "next/server";

import { oauthStart } from "@/lib/ads/oauth";

export async function GET(req: NextRequest) {
  return oauthStart(req, "meta");
}
