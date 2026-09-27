import { after, type NextRequest } from "next/server";
import { z } from "zod";

import { sha256 } from "@/lib/signature/crypto";
import {
  BUCKET, appOrigin, clientInfo, fail, generatePdf, logEvent, parsePng, proposalByToken, sendSignedEmails, signatureOf, FR } from "@/lib/signature/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 30;

const Body = z.object({
  name: z.string().trim().min(2, "Indique ton nom.").max(120),
  role: z.string().trim().max(120).default(""),
  method: z.enum(["drawn", "typed"]),
  image: z.string().max(900_000),
});

/** Contre-signature par l'agence (membre connecté avec droit d'écriture sur l'espace). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signature/[token]/countersign">) {
  const { token } = await ctx.params;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return fail("Non authentifié.", 401);

  const parsed = Body.safeParse(await req.json().catch(() => null), FR);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides.");
  const png = parsePng(parsed.data.image);
  if (!png) return fail("La signature n'est pas lisible, merci de la refaire.");

  const admin = supabaseAdmin();
  const p = await proposalByToken(admin, token);
  if (!p) return fail("Proposition introuvable.", 404);
  const { data: canWrite } = await sb.rpc("can_write", { ws: p.workspace_id });
  if (!canWrite) return fail("Tu n'as pas les droits pour contre-signer dans cet espace.", 403);

  const sig = await signatureOf(admin, p.id);
  if (!sig) return fail("Le client n'a pas encore signé.", 409);
  if (sig.countersigned_at) return fail("Déjà contre-signée.", 409);

  const path = `${p.workspace_id}/${p.id}/signature-agence.png`;
  const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
  if (up.error) return fail("Enregistrement de la signature impossible.", 500);

  const info = clientInfo(req.headers);
  const at = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("proposal_signatures")
    .update({
      countersigned_at: at,
      countersigner_id: auth.user.id,
      countersigner_name: parsed.data.name,
      countersigner_role: parsed.data.role,
      countersign_method: parsed.data.method,
      countersign_path: path,
      countersign_hash: sha256(png),
      countersign_ip_trunc: info.ip_trunc,
      countersign_user_agent: info.user_agent,
    })
    .eq("id", sig.id)
    .is("countersigned_at", null)
    .select("*")
    .maybeSingle();
  if (error || !updated) return fail(error?.message ?? "Déjà contre-signée.", 409);

  await logEvent(admin, p, "countersigned", info, { name: parsed.data.name, by: auth.user.id });
  await admin.from("activity").insert({
    workspace_id: p.workspace_id,
    deal_id: p.deal_id,
    actor_id: auth.user.id,
    verb: "proposal.countersigned",
    meta: { proposal_id: p.id, number: p.number, title: p.title, name: parsed.data.name },
  });

  let pdf: Uint8Array | null = null;
  try {
    pdf = await generatePdf(admin, updated);
  } catch (e) {
    console.error("[signature] PDF", e);
  }
  const origin = appOrigin(req.headers);
  after(() => sendSignedEmails(admin, updated, pdf, origin, token, "countersigned").catch((e) => console.error("[signature] emails", e)));
  return Response.json({ ok: true, countersigned_at: at });
}
