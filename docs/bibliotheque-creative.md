# Bibliothèque créa

La bibliothèque regroupe tes concepts créatifs par client et y rattache la performance réelle des annonces qui les diffusent. Menu : **Bibliothèque créa** (`/w/<espace>/creatives`).

## Le modèle

- **Concept** : titre, client, angle, hook (les 3 premières secondes), persona, niveau de conscience (les 5 niveaux de Schwartz : inconscient, conscient du problème, de la solution, du produit, pleinement conscient), format (statique, carrousel, vidéo courte, UGC, motion design, catalogue DPA), plateformes, statut de production, étiquettes, projet et tâche liés.
- **Statuts** : Idée, Brief, Production, Prêt, En test, Gagnant, Perdant, Épuisé.
- **Brief** : contexte marque, script, plans, consignes créateur, à faire, à éviter, appel à l'action, durée, références.
- **Variantes** : plusieurs hooks, visuels ou textes d'un même concept. Chaque annonce et chaque fichier peut être rattaché à une variante.
- **Fichiers** : visuels et vidéos (bucket `attachments`, 50 Mo max). La première image envoyée devient la couverture.
- **Annonces liées** : identifiants d'annonce Meta ou Google. C'est ce lien qui fait remonter la performance.

## Les vues

- **Galerie** : couverture (vignette de l'annonce, image choisie, ou vignette générée avec le hook), statut, pastilles dépense, ROAS, CPA, hook rate, hold rate, colorées par rapport à la moyenne du client.
- **Tableau** : tri sur toutes les colonnes, dont le ROAS réel (ventes attribuées par ton tracking) et la fatigue.
- **Production** : kanban par statut, glisser-déposer pour faire avancer un concept.
- **Analyse** : voir plus bas.

Filtres : client, angle, format, niveau de conscience, persona, statut, plateforme, plus la recherche. La période se choisit en haut à droite, comme dans le reporting.

## Les indicateurs

- **Hook rate** = vues de 3 secondes / impressions : la part des gens que la vidéo arrête. Meta uniquement (Google ne publie pas les vues de 3 s).
- **Hold rate** = ThruPlay / vues de 3 secondes : la part de ceux qui restent jusqu'à 15 s ou la fin.
- **ROAS réel** = chiffre d'affaires attribué par le [tracking first-party](./tracking.md) / dépense. Modèle : dernier point de contact portant un identifiant d'annonce (paramètre `aos_ad`) dans la fenêtre du site, visiteurs fusionnés par email. Achats et deals gagnés.
- **Fatigue** : CTR et ROAS des 7 derniers jours comparés au meilleur 7 jours glissant des 60 derniers jours, plus la fréquence 7 j (Meta). Fatigue si le CTR baisse d'au moins 30 %, ou d'au moins 20 % avec un ROAS en baisse d'au moins 25 % ou une fréquence d'au moins 3,5. À surveiller dès 15 % de baisse de CTR, 25 % de ROAS ou une fréquence de 3. Il faut au moins 14 jours de diffusion.

## L'analyse

Choisis un client et un **seuil de dépense minimum** (50 € par défaut) : sous ce seuil, une créa n'entre ni dans le classement ni dans les verdicts, pour éviter les faux gagnants.

- Classement des annonces par ROAS, CPA, CTR, hook rate ou hold rate.
- Performance agrégée par angle, format, hook (celui de la variante si l'annonce y est rattachée) et persona ou niveau de conscience, avec l'écart à la moyenne du client.
- Tableau de fatigue avec la courbe du CTR glissant.
- Suggestions : angle ou format qui surperforme (à décliner en nouveaux hooks), qui sous-performe, concepts en test prêts à passer Gagnant ou Perdant, annonces qui s'essoufflent, hook rate faible, bon hook mais hold faible, dépendance à une seule créa, niveaux de conscience non couverts.

## Le verdict d'un test

Sur la fiche concept, le bloc « Verdict du test » compare le concept à la moyenne du client sur la période : Gagnant à partir de +15 % de ROAS, Perdant à partir de −20 %, Épuisé en cas de fatigue. Un clic applique le statut, et le champ texte garde ce que le test a appris.

## Le brief créateur

Bouton **Brief créateur** : un document propre avec le contexte, l'angle et la cible, le hook en grand, les variantes de hook, le script, les plans, les consignes, à faire / à éviter et l'appel à l'action. Imprime-le ou enregistre-le en PDF depuis le navigateur. Il reste dans l'app (pas de lien public).

## La synchro par annonce

Elle tourne avec la synchro du [reporting](./reporting.md) (90 jours la première fois, puis 7 jours glissants, cron compris), sans rien à configurer.

- **Meta** (API v26) : insights `level=ad` avec `video_p25…p100_watched_actions` et `video_thruplay_watched_actions`. Les vues de 3 s viennent de l'action `video_view`. On récupère aussi le nom, le format, la vignette (adcreatives, 480 px) et la fréquence 7 j.
- **Google Ads** (API v25) : `ad_group_ad` avec `metrics.video_trueview_views` et `metrics.video_quartile_p25…p100_rate` (stockés en taux × impressions), plus le nom (ou le premier titre RSA) et la vignette YouTube.

Si la partie « annonces » échoue, la synchro des campagnes réussit quand même. La synchro Meta par annonce n'a pas encore été testée sur un compte réel.

## Lier une tâche à un concept

Dans le tiroir d'une tâche étiquetée « Créa », un encart liste ses concepts, permet d'en lier un ou d'en créer un pré-rempli.

## Veille concurrentielle

Onglet **Veille** de la bibliothèque créa. La veille lit la bibliothèque publicitaire Meta par son API officielle (Ad Library, Graph API v26, `GET /ads_archive`), en lecture seule.

### Prérequis

- Un compte Facebook dont l'**identité est confirmée** (facebook.com/ID, de quelques heures à 2 jours) et une **app développeur** (developers.facebook.com) avec les conditions de l'API acceptées sur facebook.com/ads/library/api. Sans cela, Meta renvoie l'erreur 10 / 2332002 (« Application does not have permission ») : l'interface l'explique.
- Source du jeton : un jeton collé par un admin (bouton **Configurer**, prioritaire), sinon la connexion Meta du reporting. Le jeton collé est stocké dans `creative_intel_settings` (aucune policy : service role uniquement) et n'est jamais renvoyé au navigateur ; l'interface affiche son nom, son expiration et le résultat du dernier test.

### Limites de l'API

- Pubs commerciales consultables seulement pour l'**UE et le Royaume-Uni** (DSA).
- **Ni dépense, ni impressions, ni engagement.** Pas de média téléchargeable : seuls les textes sont copiés. « Voir l'aperçu » ouvre la pub dans la bibliothèque Meta (`facebook.com/ads/library/?id=…`). L'URL `ad_snapshot_url` renvoyée par Meta contient le jeton : il en est retiré avant stockage.
- Environ 200 appels par heure : 150 appels au plus par synchro, 5 pages de 100 pubs par surveillance de page (3 pour un mot-clé).

### Surveillances

Par client : une **page concurrente** (recherche par nom, ou ID, ou URL de la page ou de la bibliothèque publicitaire) ou un **mot-clé** (dans la langue des pubs), des pays (FR par défaut), « actives uniquement » ou « toutes » (historique de 90 jours à la première synchro). Synchro manuelle (par surveillance ou toutes) et quotidienne (`/api/cron/creative-intel`, `CRON_SECRET` ; les surveillances synchronisées depuis moins de 12 h sont sautées). Une pub active qui n'est plus renvoyée passe « arrêtée » (seulement si la lecture a été complète).

### Les pubs

- **Longévité** : jours depuis le lancement (jusqu'à l'arrêt pour une pub arrêtée).
- **Variantes** : même texte principal ou même titre normalisé, sur la même page. « Regrouper les variantes » affiche une carte par concept.
- **Score « probablement gagnante »** (0 à 100), détaillé sur chaque carte : longévité (7 j = 10, 14 j = 20, 30 j = 35, 60 j = 45, 90 j = 50), variantes (2 = 10, 3 = 15, 4 et plus = 20, 7 et plus = 25), toujours active (15), portée UE (10 k = 4, 100 k = 7, 1 M = 10). **Gagnante probable** : active, en ligne depuis au moins 30 jours et score ≥ 60.
- **Nouvelle** : vue pour la première fois il y a moins de 7 jours. La vue « Nouveautés de la semaine » les regroupe par concurrent.
- **Ajouter à la bibliothèque** : crée un concept Idée, étiqueté « Inspiration concurrente », avec la source et le lien, pré-rempli (hook = première phrase, textes dans le brief, angle, format, niveau de conscience et persona si l'IA les a tagués).
- **Notification** aux membres quand un concurrent surveillé lance au moins 3 pubs dans la semaine (une fois par semaine au plus).

## Recommandations IA

Facultatif : `ANTHROPIC_API_KEY`. Sans clé, la veille, le score et les filtres fonctionnent ; les zones IA affichent un encart explicatif. Modèles : `AI_MODEL_FAST` (tagging, par défaut `claude-haiku-4-5-20251001`) et `AI_MODEL_SMART` (recommandations, par défaut `claude-sonnet-5`). Coût indicatif : environ 1 € pour 1 000 éléments tagués, 5 à 10 centimes par recommandation.

### Tagging

Chaque pub concurrente et chaque concept reçoit : angle, type de hook (question, chiffre, douleur, témoignage, contraste, curiosité, promesse, autorité, offre, humour, autre), hook, niveau de conscience (Schwartz), format probable, promesse, preuve, offre, appel à l'action, persona. Un élément n'est retagué que si son texte change ; par lots de 10, plafonné à `AI_TAG_LIMIT` éléments (40 par défaut) par synchro ou par clic sur « Taguer avec l'IA ».

### Recommandations

Onglet **Recommandations**, par client, bouton **Générer** ; l'historique est conservé. L'IA croise :

1. tes performances réelles sur 90 jours par angle, hook, format et niveau de conscience (ROAS, CPA, hook rate, écart à la moyenne), et les annonces en fatigue ;
2. ce que les concurrents font durer (la meilleure pub de chaque groupe de variantes, avec score et tags) ;
3. les trous : angles et types de hook des concurrents jamais testés, niveaux de conscience sans concept.

Sortie : 3 à 5 opportunités (Décliner, Contrer, Terrain vierge) argumentées chiffres à l'appui, avec les pubs concurrentes citées, et pour chacune un brief prêt (titre, angle, 3 hooks, script, plans, format, niveau de conscience, persona, appel à l'action). **Créer le concept** l'ajoute à la bibliothèque au statut Brief, les 3 hooks en variantes.

Outils MCP du module : `list_competitor_ads`, `list_creative_concepts`, `get_creative_recommendations`, `create_creative_concept`.
