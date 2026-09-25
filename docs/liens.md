# Liens trackés et raccourcisseur

Le module **Liens trackés** (`/w/<espace>/links`) génère des liens UTM propres, les raccourcit, en fait des QR codes et mesure leurs clics. Avec le [script de tracking](./tracking.md), chaque clic est relié au visiteur, puis à ses prospects et à ses ventes.

## Créer un lien

1. **Destination** : colle l'URL de la page. Les UTM déjà présentes sont retirées (deux jeux d'UTM faussent l'attribution) et reprises dans les champs vides.
2. **Paramètres UTM** : choisis un modèle (Meta, Google, newsletter, bio…), puis complète source, support, campagne, contenu, terme et ID. Le bouton **Normaliser** passe tout en minuscules, sans accents ni espaces. Le bouton `{ }` de chaque champ insère une variable de plateforme.
3. **Lien court et QR code** : code aléatoire (7 caractères sans ambiguïté) ou personnalisé, date d'expiration facultative, QR code en PNG ou en SVG (pour l'impression).
4. **Organisation** : nom, client, site suivi, étiquettes.

L'aperçu affiche en direct l'URL finale, la chaîne de paramètres seule et le lien court.

## Publicités : ne pas raccourcir

Les plateformes ne remplacent leurs variables (`{{campaign.name}}`, `{campaignid}`, `__CAMPAIGN_ID__`) que dans leur propre champ. Pour une annonce :

- mets l'URL **sans paramètres** comme destination de l'annonce ;
- colle la **chaîne de paramètres seule** dans :
  - Meta : Annonce > Suivi > **Paramètres d'URL** ;
  - Google Ads : Campagne > Paramètres > Options d'URL > **Suffixe de l'URL finale** ;
  - TikTok : Annonce > Destination > Paramètres d'URL.

Garde les liens courts pour l'organique, l'email, les QR codes, les SMS et l'influence : ce sont eux qui comptent les clics.

## Création en masse

`/links/new?mode=bulk` : une URL par ligne, ou un CSV avec en-têtes parmi `destination, campagne, contenu, terme, source, support, nom, code`. Les réglages communs (modèle, source, support, client, étiquettes) s'appliquent à toutes les lignes. Les colonnes d'une ligne l'emportent sur les réglages communs, qui l'emportent sur les UTM déjà présentes dans l'URL. 500 liens au maximum par série, export CSV du résultat.

## Statistiques

La page d'un lien affiche, sur la période choisie :

- les clics humains (comparés à la période précédente) et les robots filtrés : aperçus Facebook, WhatsApp, Slack, LinkedIn, X, Googlebot, robots IA…, exclus des statistiques ;
- les clics par jour, les référents, les appareils, les navigateurs, les systèmes, les pays (en-tête `x-vercel-ip-country`) et les heures de la journée, en heure de Paris.

Aucune adresse IP n'est stockée.

Si le script de tracking est installé, la page affiche aussi les visiteurs, les prospects, les ventes et le chiffre d'affaires issus du lien. La redirection ajoute `aos_lid=<jeton>` à l'URL de destination, le script le lit et relie le clic au visiteur.

Un lien désactivé ou expiré affiche « Ce lien n'est plus actif » (404). Tu peux changer la destination d'un lien court à tout moment : le lien imprimé ou publié ne change pas.

## Conventions UTM

Réglages > Reporting > **Conventions UTM** :

- **modèles** : créer, modifier, réordonner et supprimer les presets proposés dans le générateur ;
- **règle de nommage** : par exemple `{client}_{objectif}_{date}`.
  - Variables automatiques : `{client}`, `{source}`, `{medium}`, `{date}` (2026-09), `{jour}`, `{annee}`, `{mois}`.
  - Les autres variables (`{objectif}`, `{offre}`…) sont demandées dans le générateur, via le bouton « Utiliser pour la campagne ».

## Domaine court personnalisé

Par défaut, les liens courts sont en `https://<ton-app>/l/<code>`. Pour utiliser `go.agence.fr/<code>` :

1. Chez ton registrar, crée un enregistrement **CNAME** `go` → `cname.vercel-dns.com`.
2. Dans Vercel > Project > Settings > **Domains**, ajoute `go.agence.fr` (le certificat HTTPS est automatique).
3. Définis la variable `NEXT_PUBLIC_SHORT_DOMAIN=go.agence.fr` dans Vercel, puis redéploie.

`next.config.ts` réécrit alors `go.agence.fr/<code>` vers `/l/<code>`, et la racine du domaine court renvoie vers l'application. Les anciens liens en `/l/` continuent de fonctionner.

## Données de démo

La case « Charger des données d'exemple » crée 13 liens (bio Instagram Kalia, newsletters Maison Lumen, QR code du salon Vélo Nord, influence, liens Meta et Google à variables…) et environ 1 500 clics sur 45 jours, dont quelques robots. Ils disparaissent avec « Supprimer les données d'exemple » dans Réglages > Espace de travail.
