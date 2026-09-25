# Reporting publicitaire : configurer Meta Ads et Google Ads

Tout se fait en lecture seule : l'application ne peut ni créer, ni modifier, ni mettre en pause une campagne. Les jetons restent côté serveur (table `ad_connections`, inaccessible depuis le navigateur). Remplace `https://agence.exemple.fr` par ta valeur de `NEXT_PUBLIC_APP_URL`. Les URL de redirection exactes sont aussi affichées et copiables dans Réglages > Connexions publicitaires.

| Étape | Où | Résultat |
| --- | --- | --- |
| 1. App Meta | developers.facebook.com | `META_APP_ID`, `META_APP_SECRET` |
| 2. Projet Google Cloud | console.cloud.google.com | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 3. Jeton développeur | ads.google.com (compte administrateur) | `GOOGLE_ADS_DEVELOPER_TOKEN` |
| 4. Synchro quotidienne | Vercel ou autre | `CRON_SECRET` |
| 5. Connexion et association | Agence OS > Réglages > Connexions publicitaires | Reporting alimenté |

## 1. Meta Ads

1. Sur https://developers.facebook.com/apps : Créer une app > type **Entreprise**, rattachée au portefeuille business de l'agence.
2. Ajoute le produit **Facebook Login for Business** (ou Facebook Login).
3. URI de redirection OAuth valides : `https://agence.exemple.fr/api/integrations/meta/callback` (et `http://localhost:3000/api/integrations/meta/callback` en local).
4. Paramètres > Général : récupère l'ID et la clé secrète, renseigne la politique de confidentialité et le domaine.
5. Permissions demandées : `ads_read` (obligatoire) et `business_management` (comptes des portefeuilles business).
6. **Mode développement** : seules les personnes ayant un rôle sur l'app peuvent se connecter. C'est suffisant si c'est toi ou ton équipe (ajoutée dans Rôles de l'app) qui connectez les comptes. **Mode live** : uniquement si des personnes extérieures connectent leurs comptes. Il faut alors l'accès avancé à `ads_read` et `business_management` (examen de l'app, vérification de l'entreprise, vidéo du parcours de connexion).
7. Le jeton est converti en jeton longue durée (environ 60 jours). La date d'expiration est affichée, et un bouton « Reconnecter » apparaît 10 jours avant. Reconnecter le même compte met à jour la connexion sans rien perdre.

Synchro : Insights niveau campagne, un point par jour, attribution du compte (`use_unified_attribution_setting`), API Graph **v26.0** (constante `META_GRAPH_VERSION` dans `src/lib/ads/config.ts`). Dépense = `spend`, clics = `inline_link_clicks` (clics sur un lien).

**Règle conversions**, campagne par campagne : si la campagne a au moins un achat, conversions = achats (`omni_purchase`, sinon `purchase`, sinon `offsite_conversion.fb_pixel_purchase`, un seul type pour éviter les doublons) et valeur = valeur de ces achats. Sinon conversions = prospects (`lead`, sinon `onsite_conversion.lead_grouped`, sinon `offsite_conversion.fb_pixel_lead`).

## 2. Google Ads

1. Sur https://console.cloud.google.com : crée un projet et active **Google Ads API**.
2. Écran de consentement OAuth : type Externe (ou Interne), domaine de l'instance, champs `https://www.googleapis.com/auth/adwords`, `openid`, `email`. **Publie l'app (En production)** : en mode Test, le refresh token expire au bout de **7 jours**. Sans vérification Google, un écran « Application non validée » s'affiche, ce qui ne bloque pas un usage interne.
3. Identifiants > ID client OAuth > **Application Web**. URI de redirection : `https://agence.exemple.fr/api/integrations/google/callback` (et `http://localhost:3000/api/integrations/google/callback`).
4. Jeton développeur : depuis un **compte administrateur (MCC)**, Outils > Configuration > **Centre API**. Le jeton commence en accès test (comptes de test uniquement) : demande l'**accès de base** (« reporting interne en lecture seule »). En attendant, l'erreur « Jeton développeur Google Ads non approuvé » s'affiche.
5. Connecte le compte Google qui accède au MCC : les comptes clients sont listés via `customer_client`, et l'identifiant du MCC est gardé dans `ad_accounts.login_customer_id` (en-tête `login-customer-id`).

Synchro : GAQL via `googleAds:searchStream`, API **v25** (constante `GOOGLE_ADS_API_VERSION` ; Google retire une version environ un an après sa sortie) :

```sql
SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions,
       metrics.clicks, metrics.conversions, metrics.conversions_value
FROM campaign WHERE segments.date BETWEEN 'a' AND 'b'
```

(`LAST_90_DAYS` n'existe pas en GAQL.) Conversions = colonne « Conversions », valeur = « Valeur de conv. ».

## 3. Synchronisation

- Première synchro d'un compte : 90 jours (lancée quand tu coches « suivre »). Ensuite, les 7 derniers jours sont relus et remplacés à chaque passage (conversions attribuées en retard).
- Manuelle : boutons « Synchroniser » (`POST /api/reporting/sync`, membres non invités).
- Quotidienne : `GET /api/cron/sync` avec `Authorization: Bearer <CRON_SECRET>`.
- Les comptes de démo et les comptes CSV ne sont jamais synchronisés. Les limites de débit déclenchent trois nouvelles tentatives espacées.

**CRON_SECRET sur Vercel** : génère une chaîne (`openssl rand -hex 32`), ajoute-la dans Project > Settings > Environment Variables, puis redéploie. `vercel.json` déclare `{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 5 * * *" }] }` (5 h UTC). Vercel envoie l'en-tête automatiquement, et le plan Hobby autorise un cron quotidien. Tu peux tester depuis Settings > Cron Jobs > Run.

Hors Vercel : `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://agence.exemple.fr/api/cron/sync` une fois par jour.

Facultatif : `OAUTH_STATE_SECRET` (signature du `state` OAuth ; par défaut, la clé service Supabase).

## 4. Dans Agence OS

1. Réglages > Connexions publicitaires (admin) : Connecter Meta Ads ou Google Ads.
2. Coche les comptes à suivre (90 jours importés aussitôt) et **associe chaque compte à un client**. Un compte sans client n'apparaît pas dans le reporting.
3. Objectifs (fiche client) : budget et conversions mensuels (ramenés à la période), CPA, ROAS, CTR, CPC. Vert = atteint, ambre = proche (écart de moins de 15 %, budget à ± 25 %), rouge = loin.
4. Nouveau rapport > Partager : le lien `/r/<jeton>` est public et imprimable en PDF. « Désactiver le partage » coupe le lien.
5. Déconnecter garde comptes et historique ; « Ne plus suivre » supprime l'historique du compte.

**Import CSV** (TikTok, LinkedIn…) depuis la fiche client. Colonnes `date;campagne;dépense;impressions;clics;conversions;valeur` (en-têtes FR ou EN, séparateur `;` ou `,`, `1 234,56` ou `1,234.56`, dates ISO ou jj/mm/aaaa). Seules date et dépense sont obligatoires. Une ligne existante (même jour, même campagne) est remplacée.

## 5. Dépannage

| Message | Cause | Solution |
| --- | --- | --- |
| Configuration serveur incomplète | Variable absente | Renseigner les variables, puis redéployer |
| Lien de connexion expiré ou invalide | Plus de 10 min ou cookies bloqués | Relancer la connexion |
| redirect_uri_mismatch / URL bloquée | URI non déclarée | Ajouter l'URL exacte |
| Le jeton Meta a expiré | 60 jours ou accès retiré | Reconnecter Meta |
| Accès Google révoqué ou expiré | Consentement en mode Test (7 jours) | Publier l'app Google, puis reconnecter |
| Jeton développeur non approuvé | Accès test | Demander l'accès de base |
| Accès refusé à ce compte Google Ads | Mauvais MCC | Actualiser la liste des comptes |
| Aucun compte accessible | Aucun rôle sur un compte pub | Donner un accès, puis « Actualiser la liste » |
