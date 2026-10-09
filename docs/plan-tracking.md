# Plan : Tracking OS dans Agence OS

Écrit le 9 octobre 2026. Il remplace le cadrage du projet séparé
(`~/impulsion/tracking-impulsion/docs/cadrage.md`), abandonné le même jour.

## La décision

Le tracking reste **un module d'Agence OS**, nommé « Tracking OS ». Un membre qui ne
veut que le tracking installe Agence OS avec ce seul module activé : même dépôt, même
installation, même mise à jour. Agence OS garde son nom.

Pourquoi pas un projet séparé, finalement :

- Les modules activables (`src/lib/modules.ts`) règlent déjà la question du public :
  un espace peut n'afficher que le tracking.
- La synchro des campagnes et de la dépense jusqu'à la publicité existe déjà ici
  (`src/lib/ads/ad-sync.ts`). Un projet séparé l'aurait dupliquée.
- Un seul dépôt à maintenir, un seul guide d'installation pour les membres.

Ce qu'on perd : un petit dépôt lisible pour qui ne veut que le tracking, et des
versions indépendantes. Assumé.

## Ce que ça donne à la fin

Un membre installe l'app (Supabase + Vercel, aucun serveur à gérer), colle un script
sur le site de son client, branche les ventes (son CRM, Stripe, un fichier), et
obtient :

1. D'où vient chaque lead et chaque vente, jusqu'à la publicité.
2. La fiche de chaque personne avec son parcours complet.
3. Le vrai ROAS par campagne, ensemble et publicité, face à celui de la régie.
4. Ces chiffres directement dans Meta Ads Manager et Google Ads (extension Chrome).
5. Les ventes renvoyées à Meta et à Google, pour qu'ils optimisent sur la vente et
   plus sur le formulaire.

## Avec ou sans le CRM d'Agence OS

Le tracking ne dépend d'aucun CRM. Une conversion est un fait qu'on lui envoie :
« telle personne (email ou téléphone) a atteint telle étape, pour tel montant ».

| Source | Comment |
| --- | --- |
| CRM d'Agence OS | Natif : un deal qui change d'étape, un rendez-vous pris ou honoré |
| Un autre CRM (HubSpot, Pipedrive, GoHighLevel, Notion, Airtable) | Webhook du CRM, ou Make / Zapier, vers `POST /api/t/conversion` |
| Stripe, Shopify, WooCommerce | Webhook prêt à brancher |
| Cal.com, Calendly | Webhook prêt à brancher |
| Rien d'automatisable | Import d'un fichier CSV : ce sont les conversions hors ligne |

Limite à dire aux membres : on ne sait que ce qu'on nous envoie, et le rattachement
tient à l'email ou au téléphone. Une vente saisie sous un autre email reste orpheline.

## Ce qui existe déjà

- Dans ce dépôt : script `/t.js`, collecte, identité par email, six modèles, tableau
  de bord, parcours, personnes, API de conversion, webhook Stripe, liens trackés,
  synchro Meta et Google jusqu'à la publicité, consentement.
- Dans le CRM interne d'Impulsion (`~/impulsion/crm/src/lib/attribution/`), en
  production : graphe d'identité, Meta CAPI, Google Data Manager, file d'envoi, API de
  l'extension. C'est la référence à porter.
- Dans `~/impulsion/tracking-impulsion/` (prototype du 8 octobre) : entonnoir par
  gabarit, clés d'API hachées, `ping` de l'extension, recette de cloisonnement. Ces
  quatre pièces sont à porter ici. Le reste (connexion, équipe, coque) est remplacé
  par ce qu'Agence OS a déjà.

## Les étapes

Chaque étape est livrable seule et laisse l'app utilisable.

### 1. Profil « Tracking OS » et socle

**Fait le 9 octobre 2026** (migration `0100_tracking_funnel_keys.sql`).

- Profil d'installation « Tracking OS » : Attribution, Liens trackés et Reporting seulement.
- Entonnoir configurable par site, avec trois gabarits (vente par appel, e-commerce,
  génération de leads), et un onglet Entonnoir qui compte chaque étape.
- Clés d'envoi hachées, plusieurs par site, révocables une à une. La clé secrète
  unique stockée en clair a disparu ; celle des sites existants continue de fonctionner.

Écart avec le plan d'origine : les conversions restent dans `tracking_events` au lieu
d'avoir leur table. L'identifiant de l'évènement suffit comme référence stable pour
les régies, et tous les écrans existants lisent déjà cette table. À revoir à
l'étape 6 si le journal des envois le demande.

### 2. Script et identité

**Fait le 9 octobre 2026** (migration `0101_tracking_identity_signals.sql`), sauf le relais.

- Le script joint à la page vue les cookies `_fbp`, `_fbc` (reconstruit depuis le
  `fbclid` s'il manque) et `_ga`. Le serveur garde l'adresse IP et le navigateur de
  la visite. Tout cela seulement sur un site qui attend le consentement, dans une
  table qu'aucun membre ne peut lire, avec l'IP effacée à 30 jours.
- Une personne = tous les visiteurs reliés par un même email ou un même téléphone
  normalisé. Une conversion peut arriver avec un téléphone seul.
- **Reste à faire** : le relais sur le site du client pour un cookie qui dure sous
  Safari. Il attend une mesure sur un iPhone.

### 3. Sources de conversions

- Les connecteurs du tableau ci-dessus, avec une correspondance « évènement reçu →
  étape de l'entonnoir » réglable par site.
- Import CSV des conversions hors ligne, avec aperçu avant écriture.
- Branchement natif du CRM et des rendez-vous d'Agence OS.

### 4. Attribution et lecture

- Crédit stocké et recalculable quand on change de modèle ou de fenêtre.
- Tableau campagne → ensemble → publicité → personnes, avec dépense, étapes de
  l'entonnoir, chiffre d'affaires, ROAS réel et écart avec la régie.
- Fiche d'une personne : parcours complet, tous appareils.
- Écran Santé : part des conversions rattachées à une source, par étape. C'est le
  chiffre qui dit si on peut se fier au reste.

### 5. Extension Chrome

- API `/api/ext/v1` (lecture seule), même contrat que le CRM interne
  (`crm/docs/attribution/10-api-externe.md`).
- Extension `crm-ads-columns` rendue générique : adresse du serveur saisie dans le
  popup, colonnes tirées de l'entonnoir du site. Dépôt rendu public après relecture de
  son historique.

### 6. Renvoi des conversions

- File d'envoi avec reprise sur échec, planifiée dans Supabase (`pg_cron`).
- Meta Conversions API, Google (Data Manager API), GA4.
- Ajustement en cas de remboursement.
- Journal des envois dans l'écran Santé : parti, refusé, ignoré faute de consentement.

### 7. Finitions

- Données de démonstration pour tout le parcours.
- Guides : installation, branchement de chaque CRM, passage depuis Hyros.
- Outils MCP du module mis à jour.

## Banc de test

Données de démonstration en base, plus les comptes publicitaires « Démo Coaching »
(Meta `act_1634338935060146`, Google Ads `879-185-8341`) pour la synchro et
l'extension. Envoi Meta avec un code d'évènement de test. Ce que ça ne prouve pas :
la dépense recoupée au centime et l'effet du renvoi sur la diffusion, qui demandent
un compte qui diffuse.

## À vérifier avant de promettre

- **Durée du cookie sous Safari** : sept jours sans relais, d'après des sources
  secondaires. À mesurer.
- **Offre gratuite de Vercel** : un cron par jour seulement (d'où `pg_cron`), et ses
  conditions pour un usage commercial sont à relire avant de dire aux membres que le
  gratuit suffit pour une agence.
- **Google** : conditions d'accès à la Data Manager API pour un compte neuf.
- **Meta** : aucun envoi réel n'a encore été constaté depuis Agence OS.
- **`supabase/setup.sql`** n'a jamais été rejoué sur une base vierge.
