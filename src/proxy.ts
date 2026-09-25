import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Liens courts (/l/), script (/t.js) et collecte (/api/t/) ne passent pas par la session : latence minimale
  matcher: ["/((?!_next/static|_next/image|favicon.ico|l/|t\\.js|api/t/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
