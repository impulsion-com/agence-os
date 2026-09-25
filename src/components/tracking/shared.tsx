"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy } from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/tracking.css";
import { useToast } from "@/components/ui/toast";
import { ago } from "@/lib/format";
import { channelColor, channelName } from "@/lib/tracking/channels";

/** Écrit des paramètres dans l'URL (null = suppression) sans remonter en haut de page. */
export function useQueryNav() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (params: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    router.push(s ? `${path}?${s}` : path, { scroll: false });
  };
}

export type SiteState = "live" | "stale" | "never";

/** Reçoit des données (< 24 h), rien reçu depuis X, jamais installé. */
export function siteState(last: string | null): SiteState {
  if (!last) return "never";
  return Date.now() - new Date(last).getTime() < 864e5 ? "live" : "stale";
}

export function SiteStatus({ last, compact }: { last: string | null; compact?: boolean }) {
  const s = siteState(last);
  const label = s === "live" ? "Reçoit des données" : s === "stale" ? `Rien reçu depuis ${ago(last!).replace(/^il y a /, "")}` : "Jamais installé";
  return (
    <span className={`trk-status ${s}`} title={last ? `Dernier évènement ${ago(last)}` : "Aucun évènement reçu"}>
      <i aria-hidden />
      {compact && s === "live" ? `Actif, ${ago(last!)}` : label}
    </span>
  );
}

export function ChannelLabel({ channel, children }: { channel: string; children?: ReactNode }) {
  return (
    <span className="trk-ch">
      <span className="rp-dot" style={{ ["--c" as string]: channelColor(channel) }} aria-hidden />
      <span className="trunc">{children ?? channelName(channel)}</span>
    </span>
  );
}

export function CopyButton({ text, label = "Copier", small = true }: { text: string; label?: string; small?: boolean }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn${small ? " btn-sm" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast("Copie impossible : sélectionne le texte à la main", { error: true });
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copié" : label}
    </button>
  );
}

export function Code({ children, copy = true, lang }: { children: string; copy?: boolean; lang?: string }) {
  return (
    <div className="trk-code">
      {(copy || lang) && (
        <div className="bar">
          <span>{lang}</span>
          {copy && <CopyButton text={children} />}
        </div>
      )}
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export const fmtPct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "–" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} %`;

export const fmtConv = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: v > 0 && v < 10 && v % 1 !== 0 ? 1 : 0 }).format(v);
