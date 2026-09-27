"use client";

import { useMemo } from "react";

import { addDays, iso, today } from "@/lib/format";
import type { Period } from "@/lib/ads/metrics";
import {
  CZERO,
  adKey,
  buildIndex,
  cadd,
  fatigue,
  fatigueEnd,
  totalsByAd,
  totalsByConcept,
  type CTotals,
  type Fatigue,
} from "@/lib/creatives/metrics";
import type { AdDay, AdLink, Attribution, CatalogAd, Concept, Variant } from "@/lib/creatives/types";

export interface LibraryData {
  concepts: Concept[];
  variants: Variant[];
  links: AdLink[];
  catalog: CatalogAd[];
  rows: AdDay[];
  attribution: Attribution;
}

/** Données dérivées partagées par les vues de la bibliothèque (période courante et précédente). */
export function useModel(data: LibraryData, period: Period) {
  return useMemo(() => {
    const idx = buildIndex(data.links, data.catalog, data.variants);
    const concepts = new Map(data.concepts.map((c) => [c.id, c]));
    const byAd = totalsByAd(data.rows, period.start, period.end);
    const byAdPrev = totalsByAd(data.rows, period.prevStart, period.prevEnd);
    const byConcept = totalsByConcept(byAd, idx);
    const byConceptPrev = totalsByConcept(byAdPrev, idx);

    // Référence par client : toutes ses annonces sur la période
    const baseline = new Map<string, CTotals>();
    let all = CZERO;
    for (const r of data.rows) {
      if (r.date < period.start || r.date > period.end) continue;
      all = cadd(all, r);
      const k = r.company_id ?? "";
      baseline.set(k, cadd(baseline.get(k) ?? CZERO, r));
    }

    // Fatigue par annonce (lignes regroupées) puis par concept (pire de ses annonces)
    const end = fatigueEnd(period, iso(addDays(today(), -1)));
    const rowsByAd = new Map<string, AdDay[]>();
    for (const r of data.rows) {
      const k = adKey(r.platform, r.ad_id);
      const list = rowsByAd.get(k);
      if (list) list.push(r);
      else rowsByAd.set(k, [r]);
    }
    const adFatigue = new Map<string, Fatigue>();
    for (const [k, list] of rowsByAd) adFatigue.set(k, fatigue(list, end, idx.catalog.get(k)?.frequency_7d ?? null));
    const rank = { ok: 0, watch: 1, fatigued: 2 } as const;
    const conceptFatigue = new Map<string, Fatigue>();
    for (const [cid, ls] of idx.byConcept) {
      let worst: Fatigue | null = null;
      for (const l of ls) {
        const f = adFatigue.get(adKey(l.platform, l.ad_id));
        // on ne retient que les annonces qui ont dépensé sur la période
        if (!f || !(byAd.get(adKey(l.platform, l.ad_id))?.spend ?? 0)) continue;
        if (!worst || rank[f.level] > rank[worst.level]) worst = f;
      }
      if (worst) conceptFatigue.set(cid, worst);
    }

    // Vignette d'un concept : la première annonce liée qui en a une
    const thumb = new Map<string, string>();
    for (const [cid, ls] of idx.byConcept) {
      const t = ls.map((l) => idx.catalog.get(adKey(l.platform, l.ad_id))?.thumbnail_url).find(Boolean);
      if (t) thumb.set(cid, t);
    }

    return { idx, concepts, byAd, byAdPrev, byConcept, byConceptPrev, baseline, all, adFatigue, conceptFatigue, rowsByAd, thumb, end };
  }, [data, period]);
}

export type Model = ReturnType<typeof useModel>;
