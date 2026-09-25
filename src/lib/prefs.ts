"use client";

import type { Prefs } from "./types";

// Applique les préférences d'affichage sur <html> et les garde en localStorage
// pour que le script du layout racine les restaure sans flash au chargement.
export function applyPrefs(p: Prefs, workspaceAccent?: string) {
  const d = document.documentElement;
  if (p.theme && p.theme !== "system") d.dataset.theme = p.theme;
  else delete d.dataset.theme;
  const accent = p.accent ?? workspaceAccent;
  if (accent && accent !== "indigo") d.dataset.accent = accent;
  else delete d.dataset.accent;
  if (p.density === "compact") d.dataset.density = "compact";
  else delete d.dataset.density;
  try {
    localStorage.setItem("aos-prefs", JSON.stringify({ ...p, accent }));
  } catch {}
}
