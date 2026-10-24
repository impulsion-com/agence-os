import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/ads/guard";
import { cronStatus, publicAppUrl } from "@/lib/setup/checks";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/setup/cron { ws, action: "install" | "uninstall" } : programme les tâches planifiées dans Supabase
 * (pg_cron + pg_net, migration 0120). L'URL et le secret viennent des variables du serveur, jamais de la requête.
 */
export async function POST(req: NextRequest) {
  const { ws, action } = (await req.json().catch(() => ({}))) as { ws?: string; action?: string };
  if (action !== "install" && action !== "uninstall") return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  const g = await guard({ slug: ws }, "admin");
  if (g instanceof NextResponse) return g;

  const admin = supabaseAdmin();
  if (action === "uninstall") {
    const { error } = await admin.rpc("cron_uninstall");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ jobs: await cronStatus() });
  }
  const url = publicAppUrl();
  const secret = process.env.CRON_SECRET?.trim();
  if (!url || !/^https:\/\//.test(url)) return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL doit être l'adresse publique en https de l'app : Supabase ne peut pas appeler localhost." }, { status: 400 });
  if (!secret || secret.length < 16) return NextResponse.json({ error: "Ajoute d'abord CRON_SECRET (16 caractères minimum) dans les variables du serveur, puis redéploie." }, { status: 400 });
  const { error } = await admin.rpc("cron_install", { p_app_url: url, p_secret: secret });
  if (error) return NextResponse.json({ error: error.message.includes("cron_install") ? "Migration 0120 non appliquée : mets la base à jour d'abord." : error.message }, { status: 500 });
  return NextResponse.json({ jobs: await cronStatus() });
}
