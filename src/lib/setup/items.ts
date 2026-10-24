// Étapes de la page Réglages > Installation : à quoi sert chaque réglage, les variables à poser
// et le prompt à coller dans Claude in Chrome (ou Claude Code) pour le faire à ta place.
// Les prompts sont écrits à la première personne, comme si l'élève parlait à Claude.
import type { ModuleId } from "@/lib/modules";
import type { CheckId } from "./types";

export interface SetupCtx {
  /** Adresse publique de l'app, sans / final */
  appUrl: string;
  /** Hébergement détecté : Vercel pose VERCEL=1, sinon Hostinger, un VPS… */
  host: "vercel" | "autre";
  agency: string;
}

export interface SetupItem {
  id: string;
  title: string;
  why: string;
  /** Visible si l'espace a au moins un de ces modules ; vide = toujours */
  modules: ModuleId[];
  /** Indispensable au fonctionnement (sinon : facultatif, pour une fonctionnalité précise) */
  required: boolean;
  env: string[];
  check?: CheckId;
  /** Outil conseillé pour exécuter le prompt */
  tool: "chrome" | "code";
  prompt?: (c: SetupCtx) => string;
}

const where = (c: SetupCtx) =>
  c.host === "vercel"
    ? "Sur vercel.com, ouvre le projet de cette app, Settings > Environment Variables, ajoute chaque variable pour l'environnement Production, puis Deployments > Redeploy sur le dernier déploiement."
    : "Ouvre mon hébergement. Sur Hostinger : hPanel > Sites web > le site de l'app > Node.js (ou « Applications web »), section Variables d'environnement, ajoute chaque variable puis relance le build. Sur un VPS : ajoute-les au fichier .env.local de l'app puis redémarre le service. Si tu ne trouves pas, demande-moi où l'app est hébergée.";

const outro = (c: SetupCtx, test = true) =>
  `\n\nRègles : ne colle jamais une clé secrète ailleurs que dans les variables d'environnement de l'hébergement ou le champ prévu, ne la recopie pas dans ta réponse. Si une étape demande un paiement, une vérification d'identité ou un choix que tu ne peux pas faire, arrête-toi et explique-moi quoi faire. ${
    test ? `À la fin, ouvre ${c.appUrl} > Réglages > Installation et clique sur « Tester » pour cette étape, puis résume-moi le résultat.` : "À la fin, résume-moi ce que tu as réglé."
  }`;

export const SETUP_ITEMS: SetupItem[] = [
  {
    id: "app_url",
    title: "Adresse publique de l'app",
    why: "Sert aux liens d'invitation, aux pages publiques et aux retours de connexion Meta et Google.",
    modules: [],
    required: true,
    env: ["NEXT_PUBLIC_APP_URL"],
    check: "app_url",
    tool: "chrome",
    prompt: (c) =>
      `Je veux que la variable NEXT_PUBLIC_APP_URL de mon app Agence OS vaille exactement ${c.appUrl} (sans / à la fin).\n\n${where(c)}\n\nDans Supabase (supabase.com > mon projet > Authentication > URL Configuration), mets aussi Site URL = ${c.appUrl} et ajoute ${c.appUrl}/** dans Redirect URLs.${outro(c)}`,
  },
  {
    id: "schema",
    title: "Base de données à jour",
    why: "Après une mise à jour du code, les nouveaux fichiers de supabase/migrations doivent être exécutés, dans l'ordre.",
    modules: [],
    required: true,
    env: [],
    check: "schema",
    tool: "code",
    prompt: (c) =>
      `Dans ce dépôt Agence OS, la page Installation de ${c.appUrl} dit que la base n'est pas à jour. Utilise le serveur MCP Supabase (connecté à mon seul projet) : appelle la fonction public.schema_version() pour connaître la dernière migration appliquée (si elle n'existe pas, la base date d'avant 0120), puis exécute dans l'ordre chaque fichier de supabase/migrations dont le numéro est plus grand, un par un, en t'arrêtant à la première erreur pour me l'expliquer. Ne supprime aucune donnée et n'exécute rien d'autre que ces fichiers.`,
  },
  {
    id: "cron",
    title: "Tâches planifiées",
    why: "Synchro quotidienne des comptes publicitaires et de GA4, veille créa, rappels de rendez-vous. Programmées dans Supabase, elles marchent chez n'importe quel hébergeur.",
    modules: ["reporting", "creatives", "booking"],
    required: true,
    env: ["CRON_SECRET"],
    check: "cron",
    tool: "chrome",
    prompt: (c) =>
      `Génère une longue chaîne aléatoire d'au moins 40 caractères (lettres et chiffres) et ajoute-la comme variable CRON_SECRET de mon app Agence OS.\n\n${where(c)}\n\nQuand l'app a redémarré, ouvre ${c.appUrl} > Réglages > Installation et clique sur « Programmer dans Supabase » à l'étape Tâches planifiées.${outro(c)}`,
  },
  {
    id: "auth_email",
    title: "Emails de connexion (Supabase)",
    why: "Confirmation de compte et mot de passe oublié. Le service intégré de Supabase n'envoie que quelques emails par heure : branche un SMTP pour un usage réel.",
    modules: [],
    required: false,
    env: [],
    tool: "chrome",
    prompt: (c) =>
      `Je veux que Supabase envoie les emails de connexion de mon app Agence OS (${c.appUrl}) par Resend.\n\n1. Sur resend.com, vérifie que mon domaine d'envoi est ajouté et « Verified » (sinon, ajoute-le et pose les enregistrements DNS chez mon registraire, puis attends la validation). Crée une clé API « Sending access » nommée « Supabase SMTP ».\n2. Sur supabase.com > mon projet > Authentication > Emails > SMTP Settings : active Custom SMTP, hôte smtp.resend.com, port 465, utilisateur resend, mot de passe = la clé créée, expéditeur = une adresse de ce domaine, nom = ${c.agency}.\n3. Dans Authentication > Rate Limits, monte la limite d'emails à 30 par heure.${outro(c, false)}`,
  },
  {
    id: "meta",
    title: "Meta Ads",
    why: "Lire la dépense, les clics et les résultats de Facebook et Instagram, par campagne et par publicité. Une app Meta en mode développement suffit pour tes propres comptes et ceux de tes clients.",
    modules: ["reporting", "creatives", "tracking"],
    required: false,
    env: ["META_APP_ID", "META_APP_SECRET"],
    check: "meta",
    tool: "chrome",
    prompt: (c) =>
      `Crée une app Meta pour que mon outil Agence OS (${c.appUrl}) lise mes comptes publicitaires en lecture seule.\n\n1. Sur developers.facebook.com > Mes apps > Créer une app. Nom : « ${c.agency} reporting ». Rattache-la à mon portefeuille d'entreprise (Business Manager). Choisis le cas d'usage qui donne accès à l'API Marketing (« Créer et gérer des publicités avec l'API Marketing » ou type d'app « Entreprise » selon l'interface).\n2. Ajoute le produit « Facebook Login for Business » (ou « Facebook Login »). Dans ses paramètres, URI de redirection OAuth valides : ${c.appUrl}/api/integrations/meta/callback\n3. Paramètres > Général : domaine de l'app = ${new URL(c.appUrl).hostname}. Laisse l'app en mode développement : pas besoin d'examen par Meta tant que seuls les admins de l'app s'en servent.\n4. Récupère l'identifiant de l'app et la clé secrète (Paramètres > Général > Afficher). Ajoute-les comme variables META_APP_ID et META_APP_SECRET.\n\n${where(c)}${outro(c)}\n\nEnsuite, dans ${c.appUrl} > Réglages > Connexions, je cliquerai moi-même sur « Connecter Meta Ads ».`,
  },
  {
    id: "google",
    title: "Google (Ads, Analytics, Agenda)",
    why: "Un seul client OAuth Google sert à Google Ads, à Google Analytics 4 et à l'agenda des rendez-vous. Google Ads demande en plus un jeton développeur.",
    modules: ["reporting", "tracking", "booking"],
    required: false,
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    check: "google",
    tool: "chrome",
    prompt: (c) =>
      `Configure Google Cloud pour que mon outil Agence OS (${c.appUrl}) lise Google Ads, Google Analytics et mon agenda.\n\n1. Sur console.cloud.google.com, crée un projet « ${c.agency} Agence OS ».\n2. API et services > Bibliothèque : active Google Ads API, Google Analytics Data API, Google Analytics Admin API et Google Calendar API.\n3. Écran de consentement OAuth (Google Auth Platform) : si mon compte est un compte Google Workspace, choisis le type « Interne ». Sinon « Externe », puis publie l'application (« En production ») sans demander de validation : en mode « Test », Google coupe les accès au bout de 7 jours. Ajoute mon adresse comme contact.\n4. Identifiants > Créer un ID client OAuth, type « Application Web », nom « Agence OS ». URI de redirection autorisés, ajoute les trois :\n   ${c.appUrl}/api/integrations/google/callback\n   ${c.appUrl}/api/integrations/ga4/callback\n   ${c.appUrl}/api/booking/google/callback\n   Récupère l'ID client et le code secret : variables GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.\n5. Jeton développeur Google Ads : sur ads.google.com, dans mon compte administrateur (MCC, à créer s'il n'existe pas), Outils > Centre API. Si un jeton existe, récupère-le ; sinon remplis la demande d'accès et dis-moi quel niveau d'accès a été accordé. Variable GOOGLE_ADS_DEVELOPER_TOKEN.\n\n${where(c)}${outro(c)}`,
  },
  {
    id: "resend",
    title: "Emails de l'app (Resend)",
    why: "Codes de signature des propositions, confirmations et rappels de rendez-vous, notifications du portail client. Sans eux, tout marche mais rien ne part par email.",
    modules: ["proposals", "booking", "onboarding", "portal"],
    required: false,
    env: ["RESEND_API_KEY", "EMAIL_FROM"],
    check: "resend",
    tool: "chrome",
    prompt: (c) =>
      `Configure l'envoi d'emails de mon app Agence OS (${c.appUrl}) avec Resend.\n\n1. Sur resend.com (crée le compte si besoin), Domains > Add Domain avec mon domaine d'envoi (demande-le-moi si tu ne le connais pas, idéalement un sous-domaine comme mail.mondomaine.fr). Pose les enregistrements DNS demandés chez mon registraire (GoDaddy, OVH, Hostinger…), puis attends que le domaine soit « Verified ».\n2. API Keys > Create API Key, nom « Agence OS », permission « Full access » (la page Installation en a besoin pour vérifier le domaine).\n3. Variables : RESEND_API_KEY = la clé ; EMAIL_FROM = "${c.agency} <bonjour@MON-DOMAINE>" avec le domaine vérifié.\n\n${where(c)}${outro(c)}`,
  },
  {
    id: "anthropic",
    title: "IA de l'analyse créa (Anthropic)",
    why: "Étiquette chaque publicité (accroche, angle, format) et rédige les recommandations créa. Compte environ 1 € pour 1 000 publicités étiquetées.",
    modules: ["creatives"],
    required: false,
    env: ["ANTHROPIC_API_KEY"],
    check: "anthropic",
    tool: "chrome",
    prompt: (c) =>
      `Sur console.anthropic.com (crée le compte si besoin), crée une clé API nommée « Agence OS » dans un espace de travail dédié, et règle une limite de dépense mensuelle de 20 $ sur cet espace. Ajoute la clé comme variable ANTHROPIC_API_KEY de mon app Agence OS.\n\n${where(c)}${outro(c)}`,
  },
];

/** Étapes visibles pour un espace, selon ses modules actifs. */
export const itemsFor = (modules: ModuleId[]) => SETUP_ITEMS.filter((i) => !i.modules.length || i.modules.some((m) => modules.includes(m)));
