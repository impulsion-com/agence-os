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
