# Agence OS

L'espace de travail open source des agences marketing, media buying et creative strategy.
Projets, CRM, propositions commerciales et reporting publicitaire au même endroit, dans
une interface sobre et rapide, pensée pour le quotidien d'une agence.

Projet libre (licence MIT) porté par [Impulsion](https://impulsion.com) pour ses élèves :
chacun installe sa propre copie, gratuite, et la modifie comme il veut.

## Ce que ça fait

**Gestion de projet**
- Projets par client avec modèles prêts à l'emploi : onboarding client, lancement Meta Ads,
  audit Google Ads, sprint créa mensuel, suivi mensuel.
- Vues Tableau (kanban), Liste, Table, Calendrier, Timeline (Gantt avec dépendances et
  jalons), Fichiers (créas, briefs, exports), Activité, et vues enregistrées.
- Tâches avec statuts (jusqu'à « Validation client »), priorités, étiquettes métier (Créa,
  Copy, Média, Tracking, Landing, Reporting…), sous-tâches, dépendances, récurrence,
  commentaires et pièces jointes.
- Boîte de réception, mes tâches, favoris, palette de commandes ⌘K et raccourcis clavier.

**CRM**
- Pipeline de deals en kanban (de « Nouveau lead » à « Gagné »), valeur mensuelle ou
  ponctuelle, prévisionnel pondéré, MRR signé.
- Clients et prospects, contacts, historique des échanges et relances.
- Un deal gagné crée le projet d'onboarding du client.

**Propositions commerciales**
- Éditeur par blocs (contexte, approche, calendrier, KPI, prix) et catalogue de services.
- Lien public à envoyer au client, options cochables, acceptation en ligne.

**Reporting**
- Connexion Meta Ads et Google Ads, synchronisation quotidienne des campagnes.
- Tableau de bord par client : dépense, conversions, CPA, ROAS, CTR, CPC, objectifs.
- Rapports mensuels commentés, partagés par lien et imprimables en PDF.

**Tracking et attribution**
- Script first-party à poser sur les sites clients (façon Hyros) : identifiant visiteur, UTM et
  identifiants de clic, capture automatique des emails des formulaires, consentement RGPD.
- Conversions par le script, l'API serveur (Stripe, Shopify, Zapier) ou les deals gagnés du CRM.
- Six modèles d'attribution, parcours client, et ROAS réel comparé au ROAS annoncé par les régies.

**Liens trackés**
- Générateur d'UTM avec conventions de nommage et variables dynamiques Meta, Google, TikTok.
- Raccourcisseur (domaine personnalisé possible), QR codes, création en masse, statistiques de clics.

**Équipe**
- Espaces multi-agences, invitations, rôles (propriétaire, admin, membre, invité en lecture
  seule), équipes (Media buying, Creative strategy, Account management, Tracking & data).
- Thème clair et sombre, couleur d'accent, densité.

## Démarrer

Suis le guide [docs/deploiement.md](docs/deploiement.md) : Supabase + Vercel, gratuit,
environ 30 minutes. Pour brancher Meta Ads et Google Ads : [docs/reporting.md](docs/reporting.md). Tracking : [docs/tracking.md](docs/tracking.md), liens : [docs/liens.md](docs/liens.md).

## Stack technique

- [Next.js 16](https://nextjs.org) (App Router) et React 19, TypeScript.
- [Supabase](https://supabase.com) : Postgres, authentification, stockage de fichiers et
  règles d'accès (RLS) qui cloisonnent chaque agence.
- Pas de librairie de composants : un petit design system maison dans
  `src/app/globals.css`, icônes [Lucide](https://lucide.dev).

L'organisation du code et les conventions sont décrites dans [CLAUDE.md](CLAUDE.md), qui
sert aussi de guide à Claude Code si tu veux faire évoluer l'outil avec lui.

## Contribuer

Les suggestions et corrections sont les bienvenues : ouvre une issue ou une pull request.

## Licence

MIT, voir [LICENSE](LICENSE).
