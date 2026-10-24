import "server-only";

/** Adresse sous laquelle le navigateur voit l'app (derrière un proxy, req.url peut valoir localhost). */
export function requestOrigin(headers: Headers, fallback: string) {
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!host) return fallback.replace(/\/$/, "");
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
