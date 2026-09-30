import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/ads/guard";
import { supabaseAdmin } from "@/lib/supabase/server";
import { AI_TAG_LIMIT, AiError, aiEnabled, recommend } from "@/lib/creatives/ai";
import { IntelError, intelErrMsg, resolveToken, searchPages, syncIntel, tagCompetitorAds, tagConcepts, testToken } from "@/lib/creatives/intel-server";
import { buildRecoInput } from "@/lib/creatives/reco-input";

// Veille concurrentielle et IA de la bibliothèque créa : actions serveur.
// Le jeton Meta n'est jamais renvoyé au navigateur.
export const maxDuration = 300;

const Country = z.string().regex(/^[A-Z]{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("token_test"), workspace_id: z.uuid(), token: z.string().min(20).max(1000).optional() }),
  z.object({ action: z.literal("token_save"), workspace_id: z.uuid(), token: z.string().min(20).max(1000) }),
  z.object({ action: z.literal("token_delete"), workspace_id: z.uuid() }),
  z.object({ action: z.literal("search_pages"), workspace_id: z.uuid(), q: z.string().min(2).max(100), countries: z.array(Country).max(10).default(["FR"]) }),
  z.object({ action: z.literal("sync"), workspace_id: z.uuid(), watch_id: z.uuid().optional() }),
  z.object({ action: z.literal("tag"), workspace_id: z.uuid(), scope: z.enum(["ads", "concepts", "all"]).default("all"), company_id: z.uuid().optional() }),
  z.object({ action: z.literal("recommend"), workspace_id: z.uuid(), company_id: z.uuid() }),
]);

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const NO_AI = "L'IA n'est pas configurée : ajoute ANTHROPIC_API_KEY dans les variables d'environnement.";

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Requête invalide");
  const b = parsed.data;
  const admin = supabaseAdmin();
  const adminOnly = b.action === "token_test" || b.action === "token_save" || b.action === "token_delete";
  const g = await guard({ id: b.workspace_id }, adminOnly ? "admin" : "write");
  if (g instanceof NextResponse) return g;
  const ws = g.workspace.id;

  try {
    switch (b.action) {
      case "token_test": {
        const token = b.token ?? (await resolveToken(admin, ws))?.token;
        if (!token) return bad("Aucun jeton à tester : colle un jeton ou connecte Meta dans le reporting.");
        const t = await testToken(token);
        // Test du jeton enregistré : on garde le résultat
        if (!b.token) {
          const { data: s } = await admin.from("creative_intel_settings").select("access_token").eq("workspace_id", ws).maybeSingle();
          if (s?.access_token)
            await admin.from("creative_intel_settings").update({ token_ok: t.ok, token_error: t.error, token_checked_at: new Date().toISOString(), ...(t.expires_at ? { token_expires_at: t.expires_at } : {}) }).eq("workspace_id", ws);
        }
        return NextResponse.json({ ok: t.ok, label: t.label, expires_at: t.expires_at, error: t.error, code: t.code });
      }
      case "token_save": {
        const token = b.token.trim();
        const t = await testToken(token);
        if (!t.user_id) return bad(t.error ?? "Jeton invalide");
        const { error } = await admin.from("creative_intel_settings").upsert({
          workspace_id: ws,
          access_token: token,
          token_label: t.label,
          token_user_id: t.user_id,
          token_expires_at: t.expires_at,
          token_checked_at: new Date().toISOString(),
          token_ok: t.ok,
          token_error: t.error,
          updated_by: g.userId,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: t.ok, label: t.label, expires_at: t.expires_at, error: t.error, code: t.code });
      }
      case "token_delete": {
        await admin.from("creative_intel_settings").delete().eq("workspace_id", ws);
        return NextResponse.json({ ok: true });
      }
      case "search_pages": {
        const tok = await resolveToken(admin, ws);
        if (!tok) return bad("Aucun jeton Meta : configure la source des données de la veille.");
        return NextResponse.json({ pages: await searchPages(tok.token, b.q, b.countries) });
      }
      case "sync": {
        const r = await syncIntel(ws, { watchId: b.watch_id });
        const errors = r.results.filter((x) => !x.ok).map((x) => (x.ok ? "" : x.error));
        return NextResponse.json({
          watches: r.results.length,
          fetched: r.results.reduce((s, x) => s + (x.ok ? x.fetched : 0), 0),
          created: r.results.reduce((s, x) => s + (x.ok ? x.created : 0), 0),
          errors: [...new Set(errors)],
          tagged: r.tagged,
          tag_error: r.tagError,
        });
      }
      case "tag": {
        if (!aiEnabled()) return bad(NO_AI);
        let watchIds: string[] | undefined;
        if (b.company_id) {
          const { data } = await admin.from("competitor_watches").select("id").eq("workspace_id", ws).eq("company_id", b.company_id);
          watchIds = (data ?? []).map((w) => w.id);
        }
        const ads = b.scope !== "concepts" ? await tagCompetitorAds(admin, ws, AI_TAG_LIMIT, watchIds) : { tagged: 0, remaining: 0, error: null };
        const concepts = b.scope !== "ads" && !ads.error ? await tagConcepts(admin, ws, AI_TAG_LIMIT, b.company_id) : { tagged: 0, remaining: 0, error: null };
        return NextResponse.json({ ads: ads.tagged, concepts: concepts.tagged, remaining: ads.remaining + concepts.remaining, error: ads.error ?? concepts.error });
      }
      case "recommend": {
        if (!aiEnabled()) return bad(NO_AI);
        const { data: co } = await admin.from("companies").select("id, name").eq("id", b.company_id).eq("workspace_id", ws).maybeSingle();
        if (!co) return bad("Client introuvable", 404);
        const { data: wsRow } = await admin.from("workspaces").select("currency").eq("id", ws).single();
        // Tags à jour avant d'analyser (plafonnés)
        await tagConcepts(admin, ws, AI_TAG_LIMIT, co.id).catch(() => null);
        const input = await buildRecoInput({ id: ws, currency: wsRow?.currency || "EUR" }, co);
        if (!input.own.concepts && !input.competitors.length)
          return bad("Pas assez de matière : crée des concepts pour ce client ou ajoute une surveillance de concurrent.");
        const r = await recommend(input);
        const { data, error } = await admin
          .from("creative_recommendations")
          .insert({ workspace_id: ws, company_id: co.id, model: r.model, output: r.output as never, stats: input as never, usage: r.usage as never, created_by: g.userId })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ id: data.id });
      }
    }
  } catch (e) {
    if (e instanceof IntelError || e instanceof AiError) return bad(e.message, e instanceof IntelError && e.code === "no_token" ? 409 : 502);
    console.error("[creative-intel]", e);
    return bad(intelErrMsg(e), 500);
  }
}
