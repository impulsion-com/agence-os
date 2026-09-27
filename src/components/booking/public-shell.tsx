"use client";

import "@/styles/booking.css";

import { useEffect, type ReactNode } from "react";

/**
 * Coque des pages publiques /b/ : accent de l'agence, en-tête avec son nom.
 * En mode intégré (?embed=1), ni en-tête ni pied, et la hauteur est envoyée
 * à la page parente (postMessage « aos-booking:height ») pour ajuster l'iframe.
 */
export function PublicShell({ agency, accent, embed, children }: { agency: string; accent: string; embed: boolean; children: ReactNode }) {
  useEffect(() => {
    if (!embed || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "aos-booking:height", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, [embed]);

  return (
    <div className={`bk-pub${embed ? " embed" : ""}`} data-accent={accent}>
      {!embed && (
        <header className="bk-top">
          <div className="bk-top-in">
            <span className="bk-mark" aria-hidden>
              {agency.slice(0, 1).toUpperCase()}
            </span>
            {agency}
          </div>
        </header>
      )}
      <main className="bk-wrap">{children}</main>
      {!embed && (
        <footer className="bk-foot">
          Prise de rendez-vous par <a href="https://github.com/impulsion-com/agence-os" target="_blank" rel="noreferrer">Agence OS</a>
        </footer>
      )}
    </div>
  );
}

/** Conserve les paramètres utiles (UTM, identifiant de tracking, intégration) d'une page publique à l'autre */
export function carryParams(search: string) {
  const src = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const [k, v] of src) if (/^utm_|^(gclid|fbclid|ttclid|msclkid|_aos_id|embed|ref)$/.test(k)) out.set(k, v);
  const s = out.toString();
  return s ? `?${s}` : "";
}
