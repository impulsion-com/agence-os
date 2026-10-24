import "server-only";

/** Adresse sous laquelle le navigateur voit l'app (derrière un proxy, req.url peut valoir localhost). */
export function requestOrigin(headers: Headers, fallback: string) {
  const raw = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!raw) return normalizeOrigin(fallback);
  const host = raw.toLowerCase();
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return normalizeOrigin(`${proto}://${host}`);
}

/** Origine comparable : minuscules, sans / final ni port par défaut. Renvoie la chaîne nettoyée si ce n'est pas une URL. */
export function normalizeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return url.trim().replace(/\/+$/, "").toLowerCase();
  }
}
