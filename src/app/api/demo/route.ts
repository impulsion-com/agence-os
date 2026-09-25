import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

// Le jeu de démo complet (dont ~24 000 visiteurs de tracking) dépasse le délai de 8 s
// de l'API Supabase : la base se charge avec les droits de l'utilisateur, puis liens et
// tracking passent par le service role, le tracking découpé par client et par tranche de jours.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { workspace_id: ws, action } = (await request.json().catch(() => ({}))) as { workspace_id?: string; action?: string };
  if (!ws || (action !== "load" && action !== "clear")) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin", { ws });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux admins de l'espace" }, { status: 403 });

  const admin = supabaseAdmin();
  const steps =
    action === "load"
      ? [
          () => sb.rpc("load_demo_data", { ws }),
          () => admin.rpc("_demo_links", { ws }),
          // Tracking : 60 jours par client, en morceaux de 20 jours (chacun < 8 s)
          ...["Maison Lumen", "Kalia Cosmetics"].flatMap((company) =>
            [[60, 41], [40, 21], [20, 0]].map(([from, to]) => () => admin.rpc("demo_tracking_seed_part", { ws, p_company: company, p_from: from, p_to: to })),
          ),
        ]
      : [() => sb.rpc("clear_demo_tracking", { ws }), () => sb.rpc("clear_demo_links", { ws }), () => sb.rpc("clear_demo_data", { ws })];
  for (const step of steps) {
    const { error } = await step();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
