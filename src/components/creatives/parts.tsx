"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, GalleryHorizontalEnd, Image as ImageIcon, Layers, ShoppingBag, Smartphone, Sparkles, TrendingDown, type LucideIcon } from "lucide-react";

import "@/styles/creatives.css";
import { colorOf } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";
import { FORMAT, STATUS, type ConceptFormat, type ConceptStatus } from "@/lib/creatives/constants";
import { CK_HIB, CK_LABEL, FATIGUE_LABEL, ck, fmtCk, vsRef, type CKpi, type CTotals, type Fatigue } from "@/lib/creatives/metrics";

export const FORMAT_ICON: Record<ConceptFormat, LucideIcon> = {
  static: ImageIcon,
  carousel: GalleryHorizontalEnd,
  short_video: Clapperboard,
  ugc: Smartphone,
  motion: Sparkles,
  dpa: ShoppingBag,
  other: Layers,
};

// Teinte par format, mêlée à la couleur du client dans les vignettes générées
const FORMAT_TINT: Record<ConceptFormat, string> = {
  static: "blue", carousel: "teal", short_video: "violet", ugc: "rose", motion: "indigo", dpa: "orange", other: "slate",
};

export function FormatIcon({ format, size = 14 }: { format: ConceptFormat; size?: number }) {
  const I = FORMAT_ICON[format] ?? Layers;
  return <I size={size} aria-hidden />;
}

export function StatusBadge({ status, onClick }: { status: ConceptStatus; onClick?: (e: React.MouseEvent) => void }) {
  const s = STATUS[status];
  if (onClick)
    return (
      <button type="button" className="crv-status" style={{ ["--c" as string]: s.color }} onClick={onClick} title={s.help} aria-haspopup="menu">
        {s.name}
      </button>
    );
  return (
    <span className="crv-status" style={{ ["--c" as string]: s.color }} title={s.help}>
      {s.name}
    </span>
  );
}

/**
 * Couverture d'un concept : image (vignette de l'annonce ou fichier choisi), sinon une
 * vignette générée à la couleur du client avec le hook en grand.
 */
export function Cover({
  title,
  hook,
  format,
  color,
  src,
  size,
  children,
  foot,
}: {
  title: string;
  hook: string;
  format: ConceptFormat;
  color?: string | null;
  src?: string | null;
  size?: "sm" | "md";
  children?: React.ReactNode;
  foot?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const I = FORMAT_ICON[format] ?? Layers;
  const img = src && !broken;
  const style = { ["--c" as string]: colorOf(color || "slate"), ["--c2" as string]: colorOf(FORMAT_TINT[format] ?? "slate") };
  if (size)
    return (
      <span className={`crv-cover ${size}${img ? " has-img" : ""}`} style={style} aria-hidden>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src!} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <I size={size === "sm" ? 15 : 20} className="ic" />
        )}
      </span>
    );
  return (
    <div className={`crv-cover${img ? " has-img" : ""}`} style={style}>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt="" loading="lazy" onError={() => setBroken(true)} />
      )}
      <span className="fmt">
        <I size={12} aria-hidden />
        <span className="fl">{FORMAT[format]?.name ?? "Créa"}</span>
      </span>
      {!img && <p className="hook">{hook || title}</p>}
      {!img && <I size={120} className="big" aria-hidden strokeWidth={1.4} />}
      {foot && <div className="foot">{foot}</div>}
      {children}
    </div>
  );
}

/** Pastilles KPI (dépense, ROAS, CPA, hook rate, hold rate) avec tonalité vs une référence. */
export function KpiPills({ t, baseline: refT, keys = ["spend", "roas", "cpa", "hook", "hold"], currency }: { t?: CTotals; baseline?: CTotals; keys?: CKpi[]; currency: string }) {
  if (!t || t.spend <= 0) return <div className="crv-kpis empty">Pas encore de diffusion</div>;
  return (
    <div className="crv-kpis">
      {keys.map((k) => {
        const v = ck(t, k);
        if (v === null && (k === "hook" || k === "hold")) return null;
        const d = refT && k !== "spend" ? vsRef(v, ck(refT, k)) : null;
        const hib = CK_HIB[k];
        const tone = d === null || hib === null || Math.abs(d) < 10 ? "" : (d > 0) === hib ? " good" : " bad";
        return (
          <span key={k} className={`crv-kp${tone}`} title={CK_LABEL[k]}>
            {k === "spend" ? "" : `${CK_LABEL[k].replace(" rate", "")} `}
            <b>{fmtCk(k, v, currency)}</b>
          </span>
        );
      })}
    </div>
  );
}

export function FatigueBadge({ f, showOk }: { f: Fatigue | null | undefined; showOk?: boolean }) {
  if (!f || (f.level === "ok" && !showOk)) return null;
  return (
    <span className={`crv-fat ${f.level}`} title={f.reason || FATIGUE_LABEL[f.level]}>
      {f.level !== "ok" && <TrendingDown size={12} aria-hidden />}
      {FATIGUE_LABEL[f.level]}
    </span>
  );
}

/** URL signées (bucket attachments) d'une liste de chemins, rechargées quand la liste change. */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());
  const key = paths.filter(Boolean).join("|");
  useEffect(() => {
    const missing = key ? key.split("|").filter((p) => !tried.current.has(p)) : [];
    if (!missing.length) return;
    for (const p of missing) tried.current.add(p);
    void supabaseBrowser()
      .storage.from("attachments")
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        if (!data) return;
        setUrls((u) => {
          const n = { ...u };
          for (const d of data) if (d.signedUrl && d.path) n[d.path] = d.signedUrl;
          return n;
        });
      });
  }, [key]);
  return urls;
}

/** Mini-courbe (CTR glissant pour la fatigue). */
export function MiniLine({ values, width = 90, height = 24, label }: { values: (number | null)[]; width?: number; height?: number; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span className="fainter" style={{ fontSize: 11 }}>–</span>;
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${(p.i * step).toFixed(1)},${(height - 3 - ((p.v - min) / span) * (height - 6)).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--viz-2, var(--accent))" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
