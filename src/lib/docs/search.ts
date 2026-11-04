/** Terme de recherche sûr dans un filtre PostgREST `or(...ilike...)` : sans jokers ni séparateurs. */
export const likeSafe = (s: string) => s.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
