"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { useToast } from "@/components/ui/toast";

/** Appel d'une action serveur de la veille / de l'IA. Lève une erreur lisible. */
export async function callIntel<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/creatives/intel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

/** Bouton d'action asynchrone avec état occupé et toast d'erreur. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>, ok?: (r: T) => string | null): Promise<T | undefined> => {
    if (busy) return undefined;
    setBusy(key);
    try {
      const r = await fn();
      const msg = ok?.(r);
      if (msg) toast(msg);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Encart affiché quand ANTHROPIC_API_KEY n'est pas configurée. */
export function AiCallout({ what }: { what: string }) {
  return (
    <div className="crv-in-callout ai" role="note">
      <span className="ic">
        <Sparkles size={16} aria-hidden />
      </span>
      <div>
        <b>L&apos;IA n&apos;est pas activée : {what}</b>
        <p>
          Ajoute la variable <code>ANTHROPIC_API_KEY</code> (clé créée sur console.anthropic.com) dans <code>.env.local</code> ou dans les variables
          d&apos;environnement de Vercel, puis redéploie. Coût indicatif : environ 1 € pour 1 000 pubs ou concepts tagués (modèle rapide), 5 à 10 centimes
          par recommandation (modèle avancé). La veille, le score et les filtres fonctionnent sans.
        </p>
      </div>
    </div>
  );
}

const PALETTE = ["indigo", "violet", "rose", "teal", "amber", "blue", "green", "orange"];
/** Couleur stable d'une page concurrente (vignette générée). */
export function pageColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
