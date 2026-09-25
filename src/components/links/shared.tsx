"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Check, Copy, Download, MousePointerClick } from "lucide-react";

import "@/styles/links.css";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/lib/workspace/context";
import { download, findMacros, shortDisplay, shortUrl } from "@/lib/links/utm";

/** Origine de la page (repli si NEXT_PUBLIC_APP_URL est absent), stable au rendu serveur. */
export function useOrigin() {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
}

export function useShort() {
  const origin = useOrigin();
  return {
    url: (code: string) => shortUrl(code, origin),
    display: (code: string) => shortDisplay(code, origin),
  };
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function useCopy() {
  const toast = useToast();
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 1400);
    return () => clearTimeout(t);
  }, [done]);
  const copy = async (text: string, key = text, msg = "Copié dans le presse-papiers") => {
    if (await copyText(text)) {
      setDone(key);
      toast(msg);
    } else toast("Copie impossible : sélectionne le texte à la main", { error: true });
  };
  return { copy, done };
}

export function CopyButton({ text, label = "Copier", small, primary, msg }: { text: string; label?: string; small?: boolean; primary?: boolean; msg?: string }) {
  const { copy, done } = useCopy();
  const on = done === text;
  return (
    <button type="button" className={`btn${small ? " btn-sm" : ""}${primary ? " btn-primary" : ""}`} onClick={() => copy(text, text, msg)} disabled={!text}>
      {on ? <Check size={small ? 12 : 14} /> : <Copy size={small ? 12 : 14} />}
      {on ? "Copié" : label}
    </button>
  );
}

/** URL lisible : hôte en clair, clés de paramètres en accent, macros surlignées. */
export function UrlView({ url, big }: { url: string; big?: boolean }) {
  if (!url) return <div className="lnk-url blank">L&apos;aperçu apparaît dès que tu saisis une destination.</div>;
  const m = url.match(/^(https?:\/\/[^/?#]+)(.*)$/);
  const host = m ? m[1] : "";
  const rest = m ? m[2] : url;
  const qi = rest.indexOf("?");
  const path = qi < 0 ? rest : rest.slice(0, qi);
  const query = qi < 0 ? "" : rest.slice(qi + 1);
  const macros = new Set(findMacros(url));
  const hl = (s: string) => {
    if (!macros.size) return s;
    const re = new RegExp(`(${[...macros].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return s.split(re).map((p, i) => (macros.has(p) ? <span key={i} className="m">{p}</span> : p));
  };
  return (
    <div className={`lnk-url${big ? " big" : ""}`}>
      <span className="h">{host}</span>
      {path}
      {query && "?"}
      {query.split("&").map((pair, i) => {
        const [k, ...v] = pair.split("=");
        return (
          <span key={i}>
            {i > 0 && "&"}
            <span className="k">{k}</span>
            {v.length ? "=" : ""}
            {hl(v.join("="))}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// QR code (PNG et SVG téléchargeables)
// ---------------------------------------------------------------------
export function useQr(text: string, size = 240) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!text) {
      Promise.resolve().then(() => live && setSrc(null));
      return;
    }
    QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } })
      .then((s) => live && setSrc(s))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [text, size]);
  return src;
}

export async function downloadQr(text: string, name: string, format: "png" | "svg") {
  const file = (name || "qr-code").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "qr-code";
  if (format === "svg") {
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
    download(`${file}.svg`, svg, "image/svg+xml");
  } else {
    const url = await QRCode.toDataURL(text, { margin: 2, width: 1024, errorCorrectionLevel: "M" });
    const bin = atob(url.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    download(`${file}.png`, bytes, "image/png");
  }
}

export function QrModal({ text, name, onClose }: { text: string; name: string; onClose: () => void }) {
  const src = useQr(text, 480);
  return (
    <Modal
      title="QR code"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => downloadQr(text, name, "svg")}>
            <Download size={14} /> SVG (impression)
          </button>
          <button className="btn btn-primary" onClick={() => downloadQr(text, name, "png")}>
            <Download size={14} /> PNG
          </button>
        </>
      }
    >
      <div style={{ display: "grid", placeItems: "center", gap: 12 }}>
        <div style={{ width: 240, height: 240, background: "#fff", borderRadius: 10, padding: 10, border: "1px solid var(--border)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt={`QR code vers ${text}`} width={220} height={220} style={{ display: "block", width: "100%", height: "100%" }} />}
        </div>
        <p className="mono faint" style={{ fontSize: 12, wordBreak: "break-all", textAlign: "center" }}>{text}</p>
        <p className="faint" style={{ fontSize: 12.5, textAlign: "center", maxWidth: 400 }}>
          Le SVG reste net à toutes les tailles (affiche, flyer, stand). Teste toujours le QR imprimé avec deux téléphones avant diffusion.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Encart : tracking non installé
// ---------------------------------------------------------------------
export function TrackingCallout({ sites }: { sites: number }) {
  const { base } = useWorkspace();
  return (
    <div className="lnk-callout" role="note">
      <span className="ic">
        <MousePointerClick size={16} />
      </span>
      <div>
        <b>{sites ? "Le script de tracking n'a encore rien reçu" : "Relie tes liens aux prospects et aux ventes"}</b>
        <p>
          {sites
            ? "Tes sites suivis sont créés mais aucun évènement n'est arrivé. Vérifie l'installation du script : dès qu'il tourne, chaque clic est rattaché au visiteur puis à ses prospects et ventes."
            : "Installe le script de tracking sur le site du client : chaque clic sur un lien court est alors relié au visiteur, puis à ses prospects et à ses ventes."}
        </p>
      </div>
      <Link href={`${base}/tracking`} className="btn btn-sm">
        {sites ? "Vérifier le script" : "Installer le script"}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------
const REFS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "Facebook"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X (Twitter)"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)pinterest\./, "Pinterest"],
  [/(^|\.)snapchat\.com$/, "Snapchat"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/^mail\.google\.com$/, "Gmail"],
  [/(^|\.)(outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com)$/, "Outlook"],
  [/(^|\.)google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
];
export function refLabel(host: string) {
  if (!host) return "Direct ou application";
  for (const [re, n] of REFS) if (re.test(host)) return n;
  return host;
}

export const DEVICE_LABEL: Record<string, string> = { mobile: "Mobile", tablet: "Tablette", desktop: "Ordinateur", bot: "Robot", "": "Inconnu" };

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string) {
  if (!code) return "Inconnu";
  try {
    regionNames ??= new Intl.DisplayNames(["fr"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function isExpired(expires: string | null) {
  return !!expires && new Date(expires).getTime() < Date.now();
}
