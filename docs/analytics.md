# Analytics de site : Google Analytics 4 et Microsoft Clarity

Le reporting d'un client réunit trois sources : la publicité (Meta Ads, Google Ads), le trafic du site
(Google Analytics 4) et le comportement des visiteurs (Microsoft Clarity). Tout est en lecture seule.
Les jetons restent côté serveur : ceux de Google dans `ad_connections`, celui de chaque projet Clarity
dans `analytics_secrets`, deux tables sans aucune policy pour le navigateur.

| Étape | Où | Résultat |
| --- | --- | --- |
| 1. Activer les API Analytics | console.cloud.google.com | GA4 lisible avec le client OAuth existant |
| 2. Connecter Google Analytics | Réglages > Connexions | Propriétés listées |
| 3. Associer une propriété à un client | Réglages > Connexions | 90 jours importés |
| 4. Ajouter un projet Clarity | Réglages > Connexions | Premier instantané |
| 5. Synchro quotidienne | `CRON_SECRET` (voir [reporting](./reporting.md)) | Historique à jour |

## 1. Google Analytics 4

Aucune variable d'environnement nouvelle : GA4 réutilise `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`,
le même client OAuth que Google Ads. Aucun jeton développeur n'est nécessaire.

1. Sur https://console.cloud.google.com, dans le projet du client OAuth : API et services > Bibliothèque,
   active **Google Analytics Data API** et **Google Analytics Admin API**.
2. Identifiants > ton ID client OAuth « Application Web » : ajoute l'URI de redirection
   `https://agence.exemple.fr/api/integrations/ga4/callback` (et
   `http://localhost:3000/api/integrations/ga4/callback` en local). L'URL exacte est affichée et copiable
   dans Réglages > Connexions.
3. Écran de consentement : ajoute le champ d'application `https://www.googleapis.com/auth/analytics.readonly`.
   Publie l'application : en mode Test, l'accès expire au bout de 7 jours.
4. Réglages > Connexions (admin) : Connecter Google Analytics, avec le compte Google qui a au moins le
   rôle Lecteur sur la propriété du client.
5. Coche la propriété à suivre et **associe-la à un client**. Les 90 derniers jours sont importés aussitôt.
   Plusieurs propriétés peuvent être associées au même client : leurs chiffres s'additionnent.
6. Conversion principale : par défaut, tous les évènements clés de la propriété comptent. Tu peux en
   retenir un seul (`purchase`, `generate_lead`…) : il sert au taux de conversion du site. Changer de
   conversion relit les 90 jours.

### Ce qui est synchronisé

Deux appels à la Data API par propriété et par synchro :

- jour × groupe de canaux × source / medium : sessions, utilisateurs, nouveaux utilisateurs, sessions
  engagées, durée d'engagement, évènements clés, achats, revenu. Les 40 principales paires source /
  medium de la fenêtre sont gardées, le reste est regroupé sous « (autres) » ;
- totaux par jour, par appareil et par pays (15 pays, le reste regroupé) ;
- jour × page de destination pour les 50 principales pages, le reste sous « (autres) ».

Première synchro : 90 jours. Ensuite, les 7 derniers jours sont supprimés puis réécrits à chaque
passage, parce que GA4 retraite ses derniers jours.

À savoir :

- « Utilisateurs » est la somme des utilisateurs de chaque jour : une personne revenue plusieurs jours
  compte plusieurs fois. Les sessions, elles, s'additionnent sans biais.
- Revenu : `purchaseRevenue`, et `totalRevenue` quand il n'y a pas d'achat e-commerce.
- Le taux de conversion du site rapporte les évènements clés aux sessions.

## 2. Microsoft Clarity

Clarity ne demande aucune configuration serveur : chaque projet a son propre jeton.

1. Dans Clarity, ouvre le projet du client : Settings > Data Export > **Generate new API token**
   (réservé aux admins du projet).
2. Copie le jeton, et l'identifiant du projet visible dans l'adresse :
   `clarity.microsoft.com/projects/view/<identifiant>/dashboard`.
3. Réglages > Connexions (admin) > Ajouter un projet Clarity : nom, client, identifiant (ou l'adresse
   entière) et jeton. Le jeton est enregistré sur le serveur et n'est plus jamais affiché. L'ajout prend
   le premier instantané, ce qui vérifie le jeton.

### Les limites de Clarity, et ce qu'elles impliquent

L'API « Data Export » de Clarity ne renvoie qu'un agrégat des 24, 48 ou 72 dernières heures, sans
découpage par jour, et n'accepte que **10 requêtes par projet et par jour**. Il n'y a aucun historique.

- **Les données commencent le jour où tu ajoutes le projet.** Rien ne permet de remonter avant.
- Agence OS enregistre un instantané de 24 heures par jour, en 3 requêtes : par appareil, par page et
  par appareil, par canal. Il est rangé au jour qu'il couvre le plus (le cron de 5 h UTC range la veille).
- Jamais deux synchros à moins de 8 heures d'écart : cliquer sur « Synchroniser » ne dépense pas de
  requête si l'instantané est récent.
- Un ou deux jours manqués (cron en panne) : un seul agrégat de 2 ou 3 jours est réparti à parts égales
  sur les jours sans instantané. Ces jours sont signalés comme reconstitués. Au-delà de 3 jours, les
  données sont perdues.
- Quota atteint en cours de synchro : ce qui a été lu est gardé et l'erreur s'affiche sur le projet.
- Les URL sont regroupées sans leurs paramètres, et seules les 200 premières lignes par jour sont gardées.
- Sans cron (`CRON_SECRET`), l'historique ne se construit que les jours où quelqu'un synchronise.

Indicateurs enregistrés, par page et par appareil : sessions, utilisateurs, pages par session,
profondeur de défilement, temps actif, clics de rage, clics morts, retours rapides, défilement excessif,
erreurs de script et clics en erreur. Les taux affichés sont la part des sessions concernées.

## 3. Dans le reporting

**Tableau de bord d'un client** (`/reporting/<client>`), quatre onglets :

- Vue d'ensemble : dépense, sessions, conversion du site, conversions et chiffre d'affaires GA4, puis
  le tableau « Conversions, source par source » (plateformes, GA4, canaux payants GA4, tracking
  first-party) avec l'explication des écarts.
- Publicité : le tableau de bord publicitaire habituel.
- Site (GA4) : indicateurs avec variation, graphique quotidien, canaux, sources / medium, pages de
  destination, appareils.
- Comportement (Clarity) : signaux de friction avec tendance, constats en clair, pages à problèmes
  classées par part des sessions avec clics de rage ou clics morts, appareils, canaux, liens vers les
  enregistrements et les cartes de chaleur.

**Reporting global** : colonnes Sessions et Conv. site quand au moins une propriété GA4 est suivie.

**Rapports clients** : dans l'éditeur, coche « Trafic du site » et « Comportement sur le site ». Seules
les sections cochées sont jointes au lien public `/r/<jeton>` et au rapport lu dans le portail.

**Portail client** : l'onglet Performance gagne les rubriques Site et Comportement quand ces outils sont
reliés. Le client ne voit que des agrégats de son entreprise, sans identifiant de propriété ni de projet.

**MCP** : l'outil `get_site_analytics` (client, période) renvoie trafic, canaux, pages, friction, pages
à problèmes et constats.

## 4. Pourquoi les chiffres diffèrent

- Les plateformes publicitaires comptent les conversions après une simple vue de publicité et sur
  plusieurs jours. GA4 crédite le dernier canal de la session. Il est normal que GA4 attribue moins de
  conversions aux canaux payants que ce que les régies déclarent.
- Si GA4 en attribue plus, l'évènement clé choisi n'est probablement pas celui que les campagnes optimisent.
- Le tracking first-party enregistre aussi les conversions envoyées par le serveur, que les bloqueurs et
  les refus de cookies font perdre à GA4.
- Clarity voit un peu moins de sessions que GA4 (consentement, bloqueurs) et exclut les robots.

## 5. Dépannage

| Message | Cause | Solution |
| --- | --- | --- |
| L'API « Google Analytics Data API » n'est pas activée | API non activée dans le projet Google Cloud | Activer les deux API Analytics, attendre une minute |
| redirect_uri_mismatch | URI GA4 non déclarée | Ajouter `/api/integrations/ga4/callback` à l'identifiant OAuth |
| Ce compte Google n'a pas accès à cette propriété | Rôle manquant | Demander le rôle Lecteur, ou connecter un autre compte |
| Quota de l'API Google Analytics dépassé | Quota horaire ou quotidien de la propriété | Attendre : la synchro reprend au prochain passage |
| Accès Google expiré ou révoqué | Consentement en mode Test (7 jours) ou accès retiré | Publier l'application, puis reconnecter |
| Jeton Clarity refusé | Jeton mal copié, révoqué ou expiré | Générer un nouveau jeton, puis « Remplacer le jeton » |
| Limite Clarity atteinte | 10 requêtes par jour dépassées (autre outil sur le même projet) | Attendre le lendemain |
| Aucune session sur les dernières 24 heures | Balise Clarity absente ou site sans trafic | Vérifier la balise sur le site |

## 6. Pour les développeurs

- Migration : `supabase/migrations/0095_analytics.sql`. Tables `analytics_sources`, `analytics_secrets`,
  `ga4_channels_daily`, `ga4_pages_daily`, `ga4_dims_daily`, `clarity_daily`, colonne `reports.sections`.
- `_site_analytics` calcule les agrégats d'un client. Elle n'a aucun contrôle d'accès et n'est
  exécutable que par le service role : on y accède par `site_analytics` (membres), `portal_site_analytics`
  (portail), `public_report` et `portal_report` (sections cochées).
- Code : `src/lib/analytics/`. Les modules `ga4-rows.ts`, `clarity-rows.ts` et `calc.ts` sont purs.
- Tests : `node --experimental-strip-types --test src/lib/analytics/tests/analytics.test.mjs`.
- Limite connue : le format exact des lignes renvoyées par Clarity a été codé d'après la documentation
  de Microsoft, pas encore confirmé sur un projet avec du trafic.
