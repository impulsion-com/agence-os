import "server-only";

import { addDays, iso, today } from "@/lib/format";
import { resolvePeriod } from "@/lib/ads/metrics";
import { supabaseServer } from "@/lib/supabase/server";
import { AWARENESS } from "./constants";
import type { DimStat, RecoInput } from "./ai-parse";
import { firstSentence, normText, scoreAll, type CompetitorAd, type IntelTags } from "./intel-core";
import { loadLibrary } from "./load";
import { CZERO, adKey, buildIndex, ck, cmerge, fatigue, groupBy, totalsByAd, vsRef, type Group } from "./metrics";

const r = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * Données d'une recommandation : performances réelles du client sur 90 jours (par angle, format,
 * hook, niveau de conscience, fatigue), pubs concurrentes les mieux notées et trous de la couverture.
 * Lecture avec les droits de l'utilisateur (RLS).
 */
export async function buildRecoInput(ws: { id: string; currency: string }, company: { id: string; name: string }): Promise<RecoInput> {
  const period = resolvePeriod({ period: "90d" });
  const data = await loadLibrary(ws.id, period);
  const idx = buildIndex(data.links, data.catalog, data.variants);
  const concepts = data.concepts.filter((c) => c.company_id === company.id);
  const conceptMap = new Map(concepts.map((c) => [c.id, c]));
  const rows = data.rows.filter((x) => x.company_id === company.id);
  const byAd = totalsByAd(rows, period.start, period.end);
  const baseline = [...byAd.values()].reduce(cmerge, CZERO);
  const refRoas = ck(baseline, "roas");
  const refCpa = ck(baseline, "cpa");
  const stat = (g: Group): DimStat => {
    const roas = ck(g.t, "roas");
    const cpa = ck(g.t, "cpa");
    const d = refRoas !== null ? vsRef(roas, refRoas) : (() => {
      const x = vsRef(cpa, refCpa);
      return x === null ? null : -x;
    })();
    return { key: g.label, spend: Math.round(g.t.spend), roas: r(roas), cpa: r(cpa), hook: r(ck(g.t, "hook"), 1), vsAvg: r(d, 0) };
  };
  const dims = (d: "angle" | "format" | "hook" | "awareness") => groupBy(d, byAd, idx, conceptMap).filter((g) => g.key && g.t.spend > 0).slice(0, 10).map(stat);

  // Fatigue des annonces du client
  const end = iso(addDays(today(), -1));
  const byAdRows = new Map<string, typeof rows>();
  for (const x of rows) {
    const k = adKey(x.platform, x.ad_id);
    byAdRows.set(k, [...(byAdRows.get(k) ?? []), x]);
  }
  const fatigued: { name: string; reason: string }[] = [];
  for (const [k, list] of byAdRows) {
    const f = fatigue(list, end, idx.catalog.get(k)?.frequency_7d ?? null);
    if (f.level === "fatigued") fatigued.push({ name: idx.catalog.get(k)?.name || list[0]?.ad_name || k, reason: f.reason });
  }

  const coverage: Record<string, number> = {};
  for (const a of AWARENESS) coverage[a.id] = concepts.filter((c) => c.awareness === a.id).length;

  // Pubs concurrentes des surveillances du client
  const sb = await supabaseServer();
  const { data: watches } = await sb.from("competitor_watches").select("id").eq("workspace_id", ws.id).eq("company_id", company.id);
  const watchIds = (watches ?? []).map((w) => w.id);
  const { data: adsRaw } = watchIds.length
    ? await sb.from("competitor_ads").select("id, page_id, page_name, archive_id, bodies, titles, start_time, stop_time, is_active, eu_reach, ai_tags").in("watch_id", watchIds).limit(2000)
    : { data: [] };
  const ads = (adsRaw ?? []) as unknown as (Pick<CompetitorAd, "id" | "page_id" | "page_name" | "archive_id" | "bodies" | "titles" | "start_time" | "stop_time" | "is_active" | "eu_reach"> & { ai_tags: IntelTags | null })[];
  const scores = scoreAll(ads);
  // Une pub par groupe de variantes (la mieux notée), 15 au plus
  const bestByGroup = new Map<string, (typeof ads)[number]>();
  for (const a of ads) {
    const s = scores.get(a.id)!;
    const cur = bestByGroup.get(s.group);
    if (!cur || scores.get(cur.id)!.score < s.score) bestByGroup.set(s.group, a);
  }
  const competitors = [...bestByGroup.values()]
    .sort((a, b) => scores.get(b.id)!.score - scores.get(a.id)!.score)
    .slice(0, 15)
    .map((a) => {
      const s = scores.get(a.id)!;
      return {
        archive_id: a.archive_id,
        page: a.page_name,
        text: [firstSentence(a.bodies[0]), a.titles[0]].filter(Boolean).join(" / ").slice(0, 300),
        score: s.score,
        longevity: s.longevity,
        variants: s.variants,
        tags: a.ai_tags ? { angle: a.ai_tags.angle, hook_type: a.ai_tags.hook_type, awareness: a.ai_tags.awareness, format: a.ai_tags.format } : null,
      };
    });

  // Trous : ce que les concurrents scalent et que le client n'a jamais testé
  const ownAngles = new Set(concepts.map((c) => normText(c.ai_tags?.angle || c.angle)).filter(Boolean));
  const ownHooks = new Set(concepts.map((c) => c.ai_tags?.hook_type).filter(Boolean));
  const strong = competitors.filter((c) => c.score >= 50);
  return {
    company: company.name,
    currency: ws.currency,
    period: `${period.start} au ${period.end}`,
    own: {
      angles: dims("angle"),
      formats: dims("format"),
      awareness: dims("awareness"),
      hooks: dims("hook").slice(0, 8),
      fatigued: fatigued.slice(0, 5),
      concepts: concepts.length,
      coverage,
      baseline: { roas: r(refRoas), cpa: r(refCpa), hook: r(ck(baseline, "hook"), 1) },
    },
    competitors,
    gaps: {
      angles: [...new Set(strong.map((c) => c.tags?.angle).filter((a): a is string => !!a && !ownAngles.has(normText(a))))],
      awareness: AWARENESS.filter((a) => !coverage[a.id]).map((a) => a.id),
      hookTypes: [...new Set(strong.map((c) => c.tags?.hook_type).filter((h): h is IntelTags["hook_type"] => !!h && !ownHooks.has(h)))],
    },
  };
}
