import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Domaine court personnalisé (ex. go.agence.fr) : réécrit vers /l/<code> par next.config.ts, sans session
const SHORT_HOST = (process.env.NEXT_PUBLIC_SHORT_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export async function proxy(request: NextRequest) {
  if (SHORT_HOST && request.headers.get("host") === SHORT_HOST) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  // Liens courts (/l/), script (/t.js) et collecte (/api/t/) ne passent pas par la session : latence minimale
  matcher: ["/((?!_next/static|_next/image|favicon.ico|l/|t\\.js|api/t/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
