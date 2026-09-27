# Prise de rendez-vous

Module natif de réservation en ligne (alternative légère à Cal.com), relié au CRM et à l'attribution, avec un connecteur pour ceux qui restent sur Cal.com.

Pourquoi pas Cal.com directement dans Agence OS ? Cal.com est sous licence AGPL et c'est un très gros projet : l'embarquer obligerait à passer tout Agence OS en AGPL et alourdirait l'installation. Le module natif couvre le besoin d'un media buyer (appel découverte, point client) ; le connecteur garde Cal.com possible.

## En bref

- Chaque membre (hors invités) a une page publique `/b/<son-adresse>` et un type « Appel découverte (30 min) » créé automatiquement.
- `/b/<membre>/<type>` : calendrier des jours libres, créneaux dans le fuseau du visiteur (détecté, modifiable), formulaire, confirmation avec .ics et lien Google Agenda.
- Le prospect reçoit un lien `/b/r/<jeton>` pour déplacer ou annuler.
- Dans l'app : **Rendez-vous** (à venir, passés, annulés, taux de présence) et **Rendez-vous > Réglages** (page et types, disponibilités, Google Agenda, Cal.com, code d'intégration).

## Types de rendez-vous

Nom, adresse, description, durée, lieu (Google Meet, téléphone, visio à lien fixe, adresse), couleur, délai minimum, horizon (jours), tampons avant/après, pas entre créneaux, maximum par jour, création d'un deal (désactivable pour un « point client »), questions du formulaire (nom et email toujours demandés ; téléphone, entreprise, site web, budget pub, message, questions libres).

## Disponibilités

Plages hebdomadaires par jour dans le fuseau du membre (défaut Europe/Paris) et exceptions datées (congés, jours fériés, horaires spéciaux). Les créneaux sont calculés côté serveur en UTC, jour par jour : l'heure d'été est gérée. Un rendez-vous confirmé, ses tampons et les occupations Google bloquent les créneaux. La base refuse deux rendez-vous qui se chevauchent (contrainte d'exclusion `bookings_no_overlap`).

## Ce que fait une réservation

1. Contact retrouvé par email ou créé ; entreprise retrouvée par nom, par domaine d'email pro ou de site, ou créée.
2. Deal ouvert du contact réutilisé, sinon créé dans l'étape « Appel découverte » (ou la première étape ouverte), source = `utm_source / utm_campaign` de la page, sinon « Prise de rendez-vous ».
3. Activité `meeting` datée avec les réponses, notification in-app au membre, emails si configurés.
4. Tracking : si la page porte des UTM ou `_aos_id` et que le site de l'agence (site suivi sans client) existe dans Attribution, un évènement `booking` est enregistré (avec un point de contact si UTM).

- Annulation : activité au CRM, notification, évènement Google supprimé, email.
- Honoré : le deal passe de « Appel découverte » à l'étape ouverte suivante.
- Absent : note et tâche de relance au lendemain.

## Intégrer sur un site

Réglages > Page et types > « Intégrer sur ton site » : une iframe `?embed=1` (sans en-tête) et un script qui transmet les UTM, `_aos_id` et l'URL parente, et ajuste la hauteur (`postMessage` `aos-booking:height`, `aos-booking:booked` après réservation). En lien direct (pub, email), ajoute les UTM à l'adresse.

## Google Agenda

1. Console Google Cloud (même projet et client OAuth que Google Ads) : active **Google Calendar API**, ajoute l'URI de redirection `<NEXT_PUBLIC_APP_URL>/api/booking/google/callback`, ajoute les scopes `calendar.readonly` et `calendar.events` à l'écran de consentement (application en test : ajoute les comptes testeurs).
2. Variables : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (déjà utilisées par Google Ads).
3. Chaque membre : Réglages > Google Agenda > Connecter, puis choisir les agendas qui bloquent ses créneaux (freeBusy) et celui où créer les évènements.

- Chaque réservation crée un évènement avec lien Meet (lieu « Google Meet ») et invite le prospect (Google envoie l'invitation). Report = évènement déplacé, annulation = évènement supprimé.
- Jetons dans `booking_google` (aucune policy, service role seul).
- Sans Google : créneaux calculés sur les disponibilités seules, `.ics` joint à l'email de confirmation, bouton « Ajouter à mon agenda » sur la confirmation.
- Si l'appel freeBusy échoue, la page propose quand même les créneaux selon les disponibilités, et l'erreur s'affiche dans les réglages.

## Emails et rappels

Facultatifs : `RESEND_API_KEY` et `EMAIL_FROM`. Confirmation, report, annulation (prospect et membre), rappels 24 h et 1 h avant.

Rappels : `GET /api/cron/booking-reminders` avec `Authorization: Bearer <CRON_SECRET>`, toutes les 15 minutes.

- Vercel Pro : ajoute `{ "path": "/api/cron/booking-reminders", "schedule": "*/15 * * * *" }` dans `vercel.json`.
- Vercel Hobby (crons quotidiens seulement) : un cron externe (cron-job.org, GitHub Actions, pg_cron + pg_net) qui appelle l'URL avec l'en-tête.

## Cal.com

Réglages > Cal.com (admins) : URL `…/api/booking/calcom?ws=<id de l'espace>` et secret. Dans Cal.com : Paramètres > Développeur > Webhooks, colle l'URL et le secret, coche Réservation créée, reportée, annulée et Réunion terminée.

- La signature `x-cal-signature-256` (HMAC-SHA256 du corps) est vérifiée.
- Le membre destinataire est l'organisateur (par email), sinon celui choisi, sinon le propriétaire de l'espace.
- Même logique CRM que les réservations natives ; les UTM de `tracking`/`metadata` deviennent la source du deal ; « Réunion terminée » marque le rendez-vous honoré.

## Tests

`node --experimental-strip-types --test src/lib/booking/tests/slots.test.mjs`
