// Référentiels de la bibliothèque créa (statuts, formats, niveaux de conscience, brief).

export type ConceptStatus = "idea" | "brief" | "production" | "ready" | "testing" | "winner" | "loser" | "fatigued";
export type ConceptFormat = "static" | "carousel" | "short_video" | "ugc" | "motion" | "dpa" | "other";
export type Awareness = "unaware" | "problem" | "solution" | "product" | "most";

export const STATUSES: { id: ConceptStatus; name: string; color: string; help: string }[] = [
  { id: "idea", name: "Idée", color: "var(--gray)", help: "Piste à creuser" },
  { id: "brief", name: "Brief", color: "var(--blue)", help: "Brief en cours de rédaction" },
  { id: "production", name: "Production", color: "var(--amber)", help: "Tournage, montage ou design" },
  { id: "ready", name: "Prêt", color: "var(--teal)", help: "Validé, prêt à mettre en ligne" },
  { id: "testing", name: "En test", color: "var(--violet)", help: "En ligne, en cours d'évaluation" },
  { id: "winner", name: "Gagnant", color: "var(--green)", help: "A battu la moyenne du compte" },
  { id: "loser", name: "Perdant", color: "var(--red)", help: "Sous la moyenne, coupé" },
  { id: "fatigued", name: "Épuisé", color: "var(--orange)", help: "A gagné puis s'essouffle" },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<ConceptStatus, (typeof STATUSES)[number]>;

export const FORMATS: { id: ConceptFormat; name: string; video: boolean }[] = [
  { id: "static", name: "Statique", video: false },
  { id: "carousel", name: "Carrousel", video: false },
  { id: "short_video", name: "Vidéo courte", video: true },
  { id: "ugc", name: "UGC", video: true },
  { id: "motion", name: "Motion design", video: true },
  { id: "dpa", name: "Catalogue (DPA)", video: false },
  { id: "other", name: "Autre", video: false },
];
export const FORMAT = Object.fromEntries(FORMATS.map((f) => [f.id, f])) as Record<ConceptFormat, (typeof FORMATS)[number]>;

// Les 5 niveaux de conscience d'Eugene Schwartz (Breakthrough Advertising)
export const AWARENESS: { id: Awareness; name: string; short: string; help: string }[] = [
  { id: "unaware", name: "Inconscient du problème", short: "Inconscient", help: "Ne sait pas qu'il a un problème : on accroche par une histoire, une émotion, une curiosité." },
  { id: "problem", name: "Conscient du problème", short: "Problème", help: "Ressent le problème sans connaître de solution : on nomme la douleur mieux que lui." },
  { id: "solution", name: "Conscient de la solution", short: "Solution", help: "Connaît le type de solution, pas ton produit : on montre le mécanisme qui fait la différence." },
  { id: "product", name: "Conscient du produit", short: "Produit", help: "Connaît ton produit mais hésite : preuves, avis, comparaisons, garanties." },
  { id: "most", name: "Pleinement conscient", short: "Prêt à acheter", help: "N'attend qu'une raison d'agir : offre, urgence, rappel du panier." },
];
export const AWARE = Object.fromEntries(AWARENESS.map((a) => [a.id, a])) as Record<Awareness, (typeof AWARENESS)[number]>;

export const CREATIVE_PLATFORMS: { id: string; name: string }[] = [
  { id: "meta", name: "Meta" },
  { id: "google", name: "Google / YouTube" },
  { id: "tiktok", name: "TikTok" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "snapchat", name: "Snapchat" },
  { id: "pinterest", name: "Pinterest" },
];
export const platformLabel = (p: string) => CREATIVE_PLATFORMS.find((x) => x.id === p)?.name ?? p;

export type BriefKey = "context" | "script" | "shots" | "instructions" | "dos" | "donts" | "cta" | "duration" | "references";
export const BRIEF_FIELDS: { id: BriefKey; name: string; placeholder: string; rows: number }[] = [
  { id: "context", name: "Contexte marque", placeholder: "La marque, le produit, le ton, l'objectif de la campagne…", rows: 3 },
  { id: "script", name: "Script", placeholder: "0-3 s : le hook\n3-10 s : le problème\n10-25 s : la démonstration\n25-35 s : le résultat et l'appel à l'action", rows: 6 },
  { id: "shots", name: "Plans", placeholder: "Un plan par ligne : face caméra, gros plan produit, plan d'ambiance…", rows: 4 },
  { id: "instructions", name: "Consignes créateur", placeholder: "Format, cadrage, lumière, nombre de prises, livrables…", rows: 3 },
  { id: "dos", name: "À faire", placeholder: "Une consigne par ligne", rows: 3 },
  { id: "donts", name: "À éviter", placeholder: "Une consigne par ligne", rows: 3 },
  { id: "cta", name: "Appel à l'action", placeholder: "Ce que la personne doit faire à la fin", rows: 1 },
  { id: "duration", name: "Durée", placeholder: "30 à 45 s", rows: 1 },
  { id: "references", name: "Références", placeholder: "Liens vers des pubs d'inspiration (Ad Library, TikTok Creative Center…)", rows: 2 },
];

export type Brief = Partial<Record<BriefKey, string>>;
