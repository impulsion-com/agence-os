import type { NextRequest } from "next/server";

import { download, fail, generatePdf, pdfFilename, proposalByToken, signatureOf } from "@/lib/signature/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 30;

/**
 * PDF signé (document figé + signatures + certificat), accessible avec le lien de la
 * proposition : le client depuis la page publique, l'agence depuis l'app.
 * `?inline=1` pour l'afficher dans le navigateur au lieu de le télécharger.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/signature/[token]/pdf">) {
  const { token } = await ctx.params;
  const admin = supabaseAdmin();
  const p = await proposalByToken(admin, token);
  if (!p) return fail("Proposition introuvable.", 404);
  const sig = await signatureOf(admin, p.id);
  if (!sig) return fail("Cette proposition n'est pas encore signée.", 404);

  let bytes = await download(admin, sig.pdf_path);
  if (!bytes) {
    try {
      bytes = await generatePdf(admin, sig);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Génération du PDF impossible.", 500);
    }
  }
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${pdfFilename(p.number)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
