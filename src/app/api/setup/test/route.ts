import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/ads/guard";
import { runCheck } from "@/lib/setup/checks";
import { requestOrigin } from "@/lib/setup/origin";
import type { CheckId } from "@/lib/setup/types";

const IDS: CheckId[] = ["app_url", "schema", "cron", "meta", "google", "resend", "anthropic"];

/** POST /api/setup/test { ws, check } : teste un réglage du serveur (admins de l'espace). Ne renvoie aucun secret. */
export async function POST(req: NextRequest) {
  const { ws, check } = (await req.json().catch(() => ({}))) as { ws?: string; check?: CheckId };
  if (!check || !IDS.includes(check)) return NextResponse.json({ error: "Vérification inconnue" }, { status: 400 });
  const g = await guard({ slug: ws }, "admin");
  if (g instanceof NextResponse) return g;
  return NextResponse.json(await runCheck(check, requestOrigin(req.headers, req.nextUrl.origin)));
}
