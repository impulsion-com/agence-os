// Limite de débit simple, en mémoire (par instance du serveur) : fenêtre glissante d'une minute.
// Suffisant contre une boucle d'agent qui s'emballe ; pas une protection distribuée.

const hits = new Map<string, number[]>();
let lastSweep = Date.now();

export const LIMITS = {
  /** Appels par minute et par jeton */
  perToken: 120,
  /** Écritures par minute et par jeton */
  writesPerToken: 40,
  /** Tentatives avec un jeton invalide par minute et par adresse IP */
  failuresPerIp: 30,
};

/** Enregistre un appel ; renvoie le délai d'attente en secondes si la limite est dépassée. */
export function hit(key: string, limit: number, windowMs = 60_000): number | null {
  const now = Date.now();
  if (now - lastSweep > 5 * windowMs) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    lastSweep = now;
  }
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
  }
  list.push(now);
  hits.set(key, list);
  return null;
}

/** Compte sans enregistrer (pour ne pas pénaliser un appel refusé). */
export function peek(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
}

export function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}
