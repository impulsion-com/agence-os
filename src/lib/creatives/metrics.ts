// Calculs de la bibliothèque créa (purs, client et serveur) : totaux avec vidéo,
// hook rate / hold rate, agrégats par concept, par angle, format, hook, persona,
// détection de fatigue et suggestions de creative strategy.

import { addDays, iso, parseDay } from "@/lib/format";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import { AWARE, AWARENESS, FORMAT, type Awareness, type ConceptFormat } from "./constants";
import type { AdDay, AdLink, Attribution, CatalogAd, Concept, Variant } from "./types";

// ---------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------
export interface CTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  value: number;
  /** impressions des lignes qui ont des vues de 3 s (dénominateur du hook rate) */
  vImp: number;
  v3: number;
  /** vues 3 s des lignes qui ont un ThruPlay (dénominateur du hold rate) */
  v3h: number;
  thru: number;
  p25: number;
  p100: number;
}

export const CZERO: CTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0, vImp: 0, v3: 0, v3h: 0, thru: 0, p25: 0, p100: 0 };

export function cadd(t: CTotals, r: AdDay): CTotals {
  const has3 = r.video_3s !== null && r.video_3s !== undefined;
  const hasT = has3 && r.thruplay !== null && r.thruplay !== undefined;
  return {
    spend: t.spend + Number(r.spend || 0),
    impressions: t.impressions + Number(r.impressions || 0),
    clicks: t.clicks + Number(r.clicks || 0),
    conversions: t.conversions + Number(r.conversions || 0),
    value: t.value + Number(r.conversion_value || 0),
    vImp: t.vImp + (has3 ? Number(r.impressions || 0) : 0),
    v3: t.v3 + (has3 ? Number(r.video_3s) : 0),
    v3h: t.v3h + (hasT ? Number(r.video_3s) : 0),
    thru: t.thru + (hasT ? Number(r.thruplay) : 0),
    p25: t.p25 + Number(r.video_p25 ?? 0),
    p100: t.p100 + Number(r.video_p100 ?? 0),
  };
}
export const csum = (rows: AdDay[]) => rows.reduce(cadd, CZERO);
export const cmerge = (a: CTotals, b: CTotals): CTotals => ({
  spend: a.spend + b.spend,
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  conversions: a.conversions + b.conversions,
  value: a.value + b.value,
  vImp: a.vImp + b.vImp,
  v3: a.v3 + b.v3,
  v3h: a.v3h + b.v3h,
  thru: a.thru + b.thru,
  p25: a.p25 + b.p25,
  p100: a.p100 + b.p100,
});

export type CKpi = "spend" | "value" | "conversions" | "roas" | "cpa" | "ctr" | "cpm" | "hook" | "hold";

export function ck(t: CTotals, k: CKpi): number | null {
  switch (k) {
    case "spend":
      return t.spend;
    case "value":
      return t.value;
    case "conversions":
      return t.conversions;
    case "roas":
      return t.spend > 0 && t.value > 0 ? t.value / t.spend : null;
    case "cpa":
      return t.conversions > 0 ? t.spend / t.conversions : null;
    case "ctr":
      return t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null;
    case "cpm":
      return t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null;
    // Hook rate : vues de 3 s / impressions (part des personnes qui s'arrêtent)
    case "hook":
      return t.vImp > 0 ? (t.v3 / t.vImp) * 100 : null;
    // Hold rate : ThruPlay / vues de 3 s (part de celles qui restent)
    case "hold":
      return t.v3h > 0 ? (t.thru / t.v3h) * 100 : null;
  }
}

export const CK_LABEL: Record<CKpi, string> = {
  spend: "Dépense",
  value: "Valeur de conv.",
  conversions: "Conversions",
  roas: "ROAS",
  cpa: "CPA",
  ctr: "CTR",
  cpm: "CPM",
  hook: "Hook rate",
  hold: "Hold rate",
};
export const CK_HELP: Record<CKpi, string> = {
  spend: "Montant investi sur la période",
  value: "Chiffre d'affaires attribué par la plateforme",
  conversions: "Achats ou prospects attribués par la plateforme",
  roas: "Valeur de conversion / dépense (déclaré par la plateforme)",
  cpa: "Coût moyen d'une conversion",
  ctr: "Clics sur un lien / impressions",
  cpm: "Coût pour mille impressions",
  hook: "Vues de 3 secondes / impressions : la part des gens que la vidéo arrête (Meta uniquement)",
  hold: "ThruPlay / vues de 3 secondes : la part de ceux qui restent jusqu'à 15 s ou la fin",
};
/** Sens favorable d'un indicateur. */
export const CK_HIB: Record<CKpi, boolean | null> = {
  spend: null, value: true, conversions: true, roas: true, cpa: false, ctr: true, cpm: false, hook: true, hold: true,
};

export function fmtCk(k: CKpi, v: number | null, currency = "EUR"): string {
  if (v === null || !Number.isFinite(v)) return "–";
  if (k === "hook" || k === "hold") return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(v)} %`;
  return fmtKpi(k, v, currency);
}

/** Écart relatif à une référence, en % (null si non calculable). */
export function vsRef(v: number | null, ref: number | null) {
  if (v === null || ref === null || ref === 0) return null;
  return ((v - ref) / Math.abs(ref)) * 100;
}
export const fmtPct = (d: number | null) =>
  d === null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.abs(d))} %`;

// ---------------------------------------------------------------------
// Rattachement annonces → concepts
// ---------------------------------------------------------------------
export const adKey = (platform: string, adId: string) => `${platform}|${adId}`;

export interface Index {
  /** annonce (plateforme|id) → lien */
  byAd: Map<string, AdLink>;
  /** concept → liens */
  byConcept: Map<string, AdLink[]>;
  catalog: Map<string, CatalogAd>;
  variants: Map<string, Variant>;
}

export function buildIndex(links: AdLink[], catalog: CatalogAd[], variants: Variant[]): Index {
  const byAd = new Map<string, AdLink>();
  const byConcept = new Map<string, AdLink[]>();
  for (const l of links) {
    byAd.set(adKey(l.platform, l.ad_id), l);
    byConcept.set(l.concept_id, [...(byConcept.get(l.concept_id) ?? []), l]);
  }
  return {
    byAd,
    byConcept,
    catalog: new Map(catalog.map((a) => [adKey(a.platform, a.ad_id), a])),
    variants: new Map(variants.map((v) => [v.id, v])),
  };
}

const inRange = (d: string, a: string, b: string) => d >= a && d <= b;

/** Totaux par annonce sur une plage. */
export function totalsByAd(rows: AdDay[], start: string, end: string) {
  const m = new Map<string, CTotals>();
  for (const r of rows) {
    if (!inRange(r.date, start, end)) continue;
    const k = adKey(r.platform, r.ad_id);
    m.set(k, cadd(m.get(k) ?? CZERO, r));
  }
  return m;
}

/** Totaux par concept (somme de ses annonces liées). */
export function totalsByConcept(byAd: Map<string, CTotals>, idx: Index) {
  const m = new Map<string, CTotals>();
  for (const [k, t] of byAd) {
    const l = idx.byAd.get(k);
    if (!l) continue;
    m.set(l.concept_id, cmerge(m.get(l.concept_id) ?? CZERO, t));
  }
  return m;
}

/** Ventes réelles d'un ensemble d'annonces. */
export function attributed(att: Attribution, links: AdLink[] | undefined) {
  let sales = 0;
  let revenue = 0;
  let any = false;
  for (const l of links ?? []) {
    const a = att[l.ad_id];
    if (a) {
      any = true;
      sales += a.sales;
      revenue += a.revenue;
    }
  }
  return any ? { sales, revenue } : null;
}

// ---------------------------------------------------------------------
// Fatigue : CTR et ROAS sur 7 jours glissants comparés à leur pic
// ---------------------------------------------------------------------
export type FatigueLevel = "ok" | "watch" | "fatigued";

export interface Fatigue {
  level: FatigueLevel;
  ctrDrop: number | null; // en %, positif = baisse
  roasDrop: number | null;
  frequency: number | null;
  days: number; // jours de diffusion
  /** CTR sur 7 j glissants (courbe) */
  ctrSeries: (number | null)[];
  reason: string;
}

const MIN_WINDOW_IMPRESSIONS = 1500;

/**
 * Compare la fenêtre des 7 derniers jours au meilleur 7 jours glissant des 60 derniers jours.
 * Fatigue : CTR en baisse d'au moins 30 %, ou d'au moins 20 % avec un ROAS en baisse d'au moins 25 %
 * ou une fréquence 7 j ≥ 3,5. À surveiller : baisse de 15 % (CTR) ou 25 % (ROAS), ou fréquence ≥ 3.
 */
export function fatigue(rows: AdDay[], end: string, frequency: number | null = null): Fatigue {
  const e = parseDay(end)!;
  const start = iso(addDays(e, -59));
  const days: string[] = [];
  for (let i = 59; i >= 0; i--) days.push(iso(addDays(e, -i)));
  const byDay = new Map<string, CTotals>();
  for (const r of rows) if (inRange(r.date, start, end)) byDay.set(r.date, cadd(byDay.get(r.date) ?? CZERO, r));
  const active = days.filter((d) => (byDay.get(d)?.impressions ?? 0) > 0).length;
  const win = days.map((_, i) => {
    if (i < 6) return null;
    let t = CZERO;
    for (let j = i - 6; j <= i; j++) t = cmerge(t, byDay.get(days[j]) ?? CZERO);
    return t.impressions >= MIN_WINDOW_IMPRESSIONS ? t : null;
  });
  const ctrSeries = win.map((t) => (t ? ck(t, "ctr") : null));
  const last = win[win.length - 1];
  const base: Fatigue = { level: "ok", ctrDrop: null, roasDrop: null, frequency, days: active, ctrSeries, reason: "" };
  if (!last || active < 14) {
    if (frequency !== null && frequency >= 3.5) return { ...base, level: "watch", reason: `Fréquence 7 j de ${fmtN(frequency)}` };
    return { ...base, reason: active < 14 ? "Moins de 14 jours de diffusion" : "Volume insuffisant sur 7 jours" };
  }
  const peak = (k: CKpi) => Math.max(...win.map((t) => (t ? (ck(t, k) ?? 0) : 0)));
  const drop = (k: CKpi) => {
    const p = peak(k);
    const c = ck(last, k);
    return p > 0 && c !== null ? Math.max(0, ((p - c) / p) * 100) : null;
  };
  const ctrDrop = drop("ctr");
  const roasDrop = drop("roas");
  const c = ctrDrop ?? 0;
  const r = roasDrop ?? 0;
  const f = frequency ?? 0;
  const level: FatigueLevel = c >= 30 || (c >= 20 && (r >= 25 || f >= 3.5)) ? "fatigued" : c >= 15 || r >= 25 || f >= 3 ? "watch" : "ok";
  const drops = [ctrDrop !== null && ctrDrop >= 1 ? `CTR −${Math.round(ctrDrop)} %` : null, roasDrop !== null && roasDrop >= 1 ? `ROAS −${Math.round(roasDrop)} %` : null].filter(Boolean);
  const parts = [drops.length ? `${drops.join(", ")} vs son pic` : null, frequency ? `fréquence ${fmtN(frequency)}` : null].filter(Boolean);
  return { level, ctrDrop, roasDrop, frequency, days: active, ctrSeries, reason: parts.join(", ") };
}

const fmtN = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);

export const FATIGUE_LABEL: Record<FatigueLevel, string> = { ok: "En forme", watch: "À surveiller", fatigued: "Fatigue" };

/** Fin de la fenêtre de fatigue : hier, ou la fin de la période si elle est passée. */
export const fatigueEnd = (p: Period, yesterday: string) => (p.end < yesterday ? p.end : yesterday);

// ---------------------------------------------------------------------
// Analyse par dimension (angle, format, hook, persona)
// ---------------------------------------------------------------------
export type Dim = "angle" | "format" | "hook" | "persona" | "awareness";

export interface Group {
  key: string;
  label: string;
  concepts: Set<string>;
  ads: Set<string>;
  t: CTotals;
}

export function dimLabel(d: Dim, key: string) {
  if (d === "format") return FORMAT[key as ConceptFormat]?.name ?? key;
  if (d === "awareness") return AWARE[key as Awareness]?.name ?? "Non renseigné";
  return key || "Non renseigné";
}

/** Regroupe les totaux par annonce selon une dimension du concept (hook : celui de la variante si l'annonce y est liée). */
export function groupBy(d: Dim, byAd: Map<string, CTotals>, idx: Index, concepts: Map<string, Concept>): Group[] {
  const m = new Map<string, Group>();
  for (const [k, t] of byAd) {
    const l = idx.byAd.get(k);
    if (!l) continue;
    const c = concepts.get(l.concept_id);
    if (!c) continue;
    let key: string;
    if (d === "hook") key = ((l.variant_id && idx.variants.get(l.variant_id)?.hook) || c.hook || "").trim();
    else if (d === "awareness") key = c.awareness ?? "";
    else key = (c[d] ?? "").trim();
    const g = m.get(key) ?? { key, label: dimLabel(d, key), concepts: new Set(), ads: new Set(), t: CZERO };
    g.concepts.add(c.id);
    g.ads.add(k);
    g.t = cmerge(g.t, t);
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.t.spend - a.t.spend);
}

// ---------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------
export interface Suggestion {
  tone: "good" | "bad" | "info";
  text: string;
  href?: string;
}

interface SuggestInput {
  concepts: Concept[];
  conceptTotals: Map<string, CTotals>;
  baseline: CTotals;
  groups: Record<"angle" | "format", Group[]>;
  ads: { key: string; name: string; conceptId: string | null; t: CTotals; fatigue: Fatigue }[];
  minSpend: number;
  currency: string;
  base: string;
}

const q = (s: string) => `« ${s} »`;

export function suggestions(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  const refRoas = ck(i.baseline, "roas");
  const refCpa = ck(i.baseline, "cpa");
  const useRoas = refRoas !== null;
  const perf = (t: CTotals) => (useRoas ? vsRef(ck(t, "roas"), refRoas) : (() => {
    const d = vsRef(ck(t, "cpa"), refCpa);
    return d === null ? null : -d; // un CPA plus bas est un gain
  })());
  const metric = useRoas ? "de ROAS" : "sur le CPA";
  const money = (v: number) => fmtCk("spend", v, i.currency);

  // Angles et formats
  for (const dim of ["angle", "format"] as const) {
    const gs = i.groups[dim].filter((g) => g.t.spend >= i.minSpend && g.key);
    if (gs.length < 2) continue;
    const scored = gs.map((g) => ({ g, d: perf(g.t) })).filter((x): x is { g: Group; d: number } => x.d !== null);
    const best = scored.sort((a, b) => b.d - a.d)[0];
    const worst = scored[scored.length - 1];
    const noun = dim === "angle" ? "L'angle" : "Le format";
    if (best && best.d >= 15) {
      const val = useRoas ? `${fmtCk("roas", ck(best.g.t, "roas"))} vs ${fmtCk("roas", refRoas)}` : `${fmtCk("cpa", ck(best.g.t, "cpa"), i.currency)} vs ${fmtCk("cpa", refCpa, i.currency)}`;
      out.push({
        tone: "good",
        text:
          dim === "angle"
            ? `${noun} ${q(best.g.label)} surperforme de ${fmtPct(best.d)} ${metric} (${val}, ${money(best.g.t.spend)} investis) : décline-le en 3 nouveaux hooks.`
            : `${noun} ${q(best.g.label)} surperforme de ${fmtPct(best.d)} ${metric} (${val}) : produis 2 à 3 concepts de plus dans ce format.`,
      });
    }
    if (worst && worst !== best && worst.d <= -20) {
      out.push({
        tone: "bad",
        text:
          dim === "angle"
            ? `${noun} ${q(worst.g.label)} sous-performe de ${fmtPct(worst.d)} ${metric} sur ${money(worst.g.t.spend)} : retravaille la promesse ou coupe-le.`
            : `${noun} ${q(worst.g.label)} est ${fmtPct(worst.d)} ${metric} sous la moyenne : réalloue son budget vers les formats gagnants.`,
      });
    }
  }

  // Concepts en test prêts pour un verdict
  const byId = new Map(i.concepts.map((c) => [c.id, c]));
  for (const [id, t] of i.conceptTotals) {
    const c = byId.get(id);
    if (!c || c.status !== "testing" || t.spend < i.minSpend) continue;
    const d = perf(t);
    if (d === null) continue;
    if (d >= 20)
      out.push({ tone: "good", text: `${q(c.title)} bat la moyenne de ${fmtPct(d)} ${metric} après ${money(t.spend)} : passe-le en Gagnant et prépare des variantes.`, href: `${i.base}/creatives/${c.id}` });
    else if (d <= -30 && t.spend >= i.minSpend * 2)
      out.push({ tone: "bad", text: `${q(c.title)} reste ${fmtPct(d)} ${metric} sous la moyenne après ${money(t.spend)} : marque-le Perdant et coupe les annonces.`, href: `${i.base}/creatives/${c.id}` });
  }

  // Fatigue
  for (const a of i.ads.filter((x) => x.fatigue.level === "fatigued" && x.t.spend >= i.minSpend).slice(0, 3)) {
    out.push({
      tone: "bad",
      text: `${q(a.name)} s'essouffle (${a.fatigue.reason}) : rafraîchis le hook ou la miniature, ou coupe-la.`,
      href: a.conceptId ? `${i.base}/creatives/${a.conceptId}` : undefined,
    });
  }

  // Hook rate et hold rate
  for (const a of i.ads.filter((x) => x.t.spend >= i.minSpend)) {
    const h = ck(a.t, "hook");
    const hold = ck(a.t, "hold");
    if (h !== null && h < 25)
      out.push({ tone: "bad", text: `${q(a.name)} a un hook rate de ${fmtCk("hook", h)} : les 3 premières secondes n'arrêtent pas le scroll, teste 3 nouvelles ouvertures.`, href: a.conceptId ? `${i.base}/creatives/${a.conceptId}` : undefined });
    else if (h !== null && h >= 35 && hold !== null && hold < 22)
      out.push({ tone: "info", text: `${q(a.name)} accroche bien (hook rate ${fmtCk("hook", h)}) mais peu restent (hold rate ${fmtCk("hold", hold)}) : resserre le montage après le hook.`, href: a.conceptId ? `${i.base}/creatives/${a.conceptId}` : undefined });
  }

  // Dépendance à une seule créa
  const total = i.ads.reduce((s, a) => s + a.t.spend, 0);
  const top = [...i.ads].sort((a, b) => b.t.spend - a.t.spend)[0];
  if (top && total > 0 && top.t.spend / total >= 0.4 && i.ads.length >= 3)
    out.push({ tone: "info", text: `${q(top.name)} porte ${Math.round((top.t.spend / total) * 100)} % de la dépense : prépare sa relève avant qu'elle ne s'essouffle.` });

  // Couverture des niveaux de conscience
  const covered = new Set(i.concepts.map((c) => c.awareness).filter(Boolean));
  const missing = AWARENESS.filter((a) => !covered.has(a.id));
  if (i.concepts.length >= 4 && missing.length && missing.length < AWARENESS.length)
    out.push({
      tone: "info",
      text: `Aucun concept pour ${missing.map((m) => q(m.name.toLowerCase())).join(", ")} : ${missing[0].help.charAt(0).toLowerCase()}${missing[0].help.slice(1)}`,
    });

  return out.slice(0, 9);
}

/** Verdict suggéré pour un concept (vs la moyenne du client). */
export function suggestVerdict(t: CTotals | undefined, baseline: CTotals, f: Fatigue | null, minSpend: number): { status: "winner" | "loser" | "fatigued" | null; text: string } {
  if (!t || t.spend < minSpend) return { status: null, text: `Pas encore assez de dépense pour conclure (seuil : ${fmtCk("spend", minSpend)}).` };
  const r = vsRef(ck(t, "roas"), ck(baseline, "roas"));
  const c = vsRef(ck(t, "cpa"), ck(baseline, "cpa"));
  const d = r ?? (c === null ? null : -c);
  const what = r !== null ? "de ROAS" : "sur le CPA";
  if (f?.level === "fatigued") return { status: "fatigued", text: `S'essouffle : ${f.reason}. Sur la période, ${d === null ? "pas de conversion mesurée" : `${fmtPct(d)} ${what} par rapport à la moyenne du client`}.` };
  if (d === null) return { status: null, text: "Pas de conversion mesurée pour l'instant." };
  if (d >= 15) return { status: "winner", text: `${fmtPct(d)} ${what} par rapport à la moyenne du client.` };
  if (d <= -20) return { status: "loser", text: `${fmtPct(d)} ${what} par rapport à la moyenne du client.` };
  return { status: null, text: `Dans la moyenne du client (${fmtPct(d)} ${what}).` };
}
