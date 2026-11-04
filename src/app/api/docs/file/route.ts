import { NextResponse, type NextRequest } from "next/server";

import { DOCS_BUCKET } from "@/lib/docs/types";
import { supabaseServer } from "@/lib/supabase/server";

// Image ou fichier d'une page des Docs : l'adresse enregistrée dans la page reste stable,
// l'URL signée (valable une heure) est créée à chaque lecture avec la session de l'utilisateur.
// La RLS du stockage vérifie qu'il est membre de l'espace (premier dossier du chemin).
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("p") ?? "";
  if (!/^[0-9a-f-]{36}\/docs\/[\w.-]+$/i.test(path)) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from(DOCS_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  const res = NextResponse.redirect(data.signedUrl, 307);
  res.headers.set("Cache-Control", "private, max-age=3000");
  return res;
}
