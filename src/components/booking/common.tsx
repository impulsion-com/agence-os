"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { useToast } from "@/components/ui/toast";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = "Copier", msg = "Copié dans le presse-papiers", small, primary }: { text: string; label?: string; msg?: string; small?: boolean; primary?: boolean }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={`btn${small ? " btn-sm" : ""}${primary ? " btn-primary" : ""}`}
      disabled={!text}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          toast(msg);
        } else toast("Copie impossible : sélectionne le texte à la main", { error: true });
      }}
    >
      {done ? <Check size={small ? 12 : 14} /> : <Copy size={small ? 12 : 14} />}
      {done ? "Copié" : label}
    </button>
  );
}

/** Heure de référence du rendu (figée au montage : le rendu reste pur) */
export function useNow() {
  const [now] = useState(() => Date.now());
  return now;
}

/** URL publique de l'application (liens à partager) */
export function publicBase(appUrl: string) {
  return (process.env.NEXT_PUBLIC_APP_URL || appUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
}

/** Appel d'une action serveur du module (JSON), erreur lisible en français */
export async function postJson<T = { ok: boolean }>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Action impossible");
  return json;
}
