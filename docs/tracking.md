# Tracking first-party et attribution

Le module « Attribution » suit les visiteurs des sites de tes clients avec un script first-party,
les identifie (formulaires, `identify`), enregistre leurs conversions (script, API serveur, Stripe,
deals du CRM) et répartit le crédit de chaque vente entre les points de contact qui l'ont précédée.
Il compare ensuite ce ROAS réel au ROAS déclaré par Meta, Google…

## 1. Créer un site suivi

Attribution > Nouveau site suivi : nom, client (ou aucun pour le site de l'agence), domaines
(un par ligne, sous-domaines inclus), entonnoir de départ, modèle d'attribution par défaut, fenêtre,
consentement, capture des formulaires. Seuls les domaines déclarés peuvent envoyer des données (vide = tous).

## 2. Installer le script

Dans le `<head>` de toutes les pages :

```html
<script>window.aos=window.aos||function(){(aos.q=aos.q||[]).push(arguments)};</script>
<script async src="https://<ton-app>/t.js" data-key="pk_…"></script>
```

La première ligne met en file d'attente les appels faits avant le chargement. Attributs facultatifs :
`data-consent="required|none"`, `data-domains="a.fr,b.fr"`, `data-forms="false"` (priment sur les réglages).

- **WordPress** : extension WPCode > Header. Formulaires CF7, Elementor, Gravity, WPForms captés sans code.
- **Shopify** : `theme.liquid` avant `</head>`, puis Paramètres > Évènements clients > pixel personnalisé
  (code fourni dans l'onglet Installation) pour l'achat au checkout.
- **Webflow** : Site settings > Custom code > Head code.
- **GTM** : balise HTML personnalisée, déclencheur « Initialisation, toutes les pages ».

L'onglet Installation contient un **testeur en direct** (derniers évènements reçus, toutes les 5 s).

## 3. API du script

```js
aos('identify', { email, name, phone });
aos('track', 'lead' | 'booking' | 'purchase' | '<nom libre>', { value, currency, order_id, email /* … */ });
aos('consent', true | false);
aos('page');            // page vue manuelle (les navigations pushState sont déjà suivies)
window.aos.id           // identifiant du visiteur (à passer à Stripe en client_reference_id)
```

`order_id` rend une conversion idempotente (index unique site + type + order_id).

## 4. Fonctionnement du script (`/t.js`, 5,7 Ko, ES5)

- Lit sa clé (`data-key` ou `?k=`) puis `GET /api/t/config?k=` (domaines, consentement, formulaires).
- Identifiant : cookie `_aos_id` (1 an, domaine racine) + localStorage en secours.
  Session : cookie `_aos_s` (30 min, prolongé à chaque envoi).
  Sous Safari, un cookie posé par un script est plafonné à 7 jours : au-delà, seuls l'email, le téléphone et
  les identifiants de clic relient encore une visite à une vente.
- Après consentement (mode « Après consentement » seulement), la page vue emporte les cookies `_fbp`, `_fbc`
  et `_ga` s'ils existent. Sans `_fbc`, il est reconstruit depuis le `fbclid` de l'URL.
- Un **point de contact** est créé à chaque arrivée avec source (UTM, gclid, gbraid, wbraid, fbclid,
  ttclid, msclkid, li_fat_id, sccid, epik, aos_lid, référent externe) ou à chaque nouvelle session.
  Chaque page vue est enregistrée.
- **Formulaires** : écoute `submit` et les clics de bouton en phase de capture (formulaires AJAX compris),
  lit email, nom, prénom, téléphone. Ignore mots de passe, champs cachés, `[data-aos-ignore]`.
  Les formulaires dans une iframe (HubSpot, Typeform) ne sont pas lisibles : utilise `aos('identify')` ou l'API.
- **Cross-domain** : les liens vers un autre domaine déclaré reçoivent `?_aos_id=<id>`, repris puis
  retiré de l'URL à l'arrivée (pas de nouveau point de contact).
- Envoi : `navigator.sendBeacon` en `text/plain` (pas de pré-vol CORS), secours `fetch keepalive`.

## 5. Consentement (RGPD)

En mode « Après consentement », rien n'est déposé ni envoyé avant `aos('consent', true)` ; les appels
restent en file. `aos('consent', false)` efface cookie et localStorage. En France, ce mode est
nécessaire dès que le site n'est pas exempté par la CNIL.

```js
// Axeptio (vendor « agence_os »)
window._axcb = window._axcb || [];
_axcb.push(function (sdk) { sdk.on('cookies:complete', function (c) { aos('consent', !!c.agence_os); }); });

// Cookiebot
window.addEventListener('CookiebotOnConsentReady', function () {
  aos('consent', !!(window.Cookiebot && Cookiebot.consent.statistics));
});
```

Consent Mode Google : balise GTM `aos('consent', true)` conditionnée à `analytics_storage`.

### Ce qui est conservé selon le mode

| | Suivi immédiat | Après consentement |
| --- | --- | --- |
| Pays (`x-vercel-ip-country`) | oui | oui |
| Cookies des régies (`_fbp`, `_fbc`, `_ga`) | non | oui |
| Adresse IP et navigateur de la visite | non | oui, IP effacée après 30 jours |

Ces signaux servent au renvoi des conversions vers Meta et Google : ce sont eux qui permettent à la régie
de rapprocher une vente d'un clic. Un site en « suivi immédiat » se déclare exempté de consentement, ce qui
exclut tout identifiant publicitaire : il ne pourra donc renvoyer que l'email et le téléphone hachés.
Ils vivent dans `visitor_signals`, sans aucune policy : aucun membre ne peut les lire, seul le serveur.
L'effacement des IP passe par le cron quotidien (`/api/cron/sync`).

Les emails ne sont visibles que des membres. Onglet « Visiteurs identifiés » : suppression d'une personne
(tous ses visiteurs, points de contact, évènements et signaux).

## 6. Identité

Une **personne** regroupe tous les visiteurs (appareils, navigateurs) reliés par un même email **ou** un même
téléphone. Elle se construit à chaque identification : formulaire, `aos('identify')`, conversion envoyée par
l'API. Si un envoi porte l'email d'une personne et le téléphone d'une autre, les deux fusionnent.

- Le téléphone est normalisé au format international (`06 12 34 56 78`, `+33 6 12…` et `0033612…` désignent
  le même numéro). Un numéro écrit sans indicatif est lu dans le pays du visiteur, ou comme français si le
  pays est inconnu (cas d'une conversion envoyée par un serveur) : préfère le format `+33…` dans l'API.
- Une conversion peut arriver avec un téléphone seul : c'est ce qui permet de brancher un CRM ou un outil
  d'appels qui ne connaît pas l'email.
- Limite : deux personnes qui partagent un téléphone ou un email (un couple, un standard) sont vues comme une seule.

Code : `tracking_link_person` (migration `0101`), `src/lib/tracking/phone.ts`.

## 7. Canaux

UTM d'abord (medium payant : cpc, ppc, paid_social, display… ; email, newsletter ; social, bio ; organic),
puis identifiants de clic (gclid/gbraid/wbraid → Google Ads, ttclid → TikTok, li_fat_id → LinkedIn,
msclkid, sccid, epik → autres régies), puis lien court (`aos_lid`), puis référent (moteurs → recherche
organique, réseaux → social organique, webmails → email, sinon site référent), sinon direct.
**fbclid seul = social organique** (Facebook l'ajoute aussi aux publications) : utilise le modèle UTM
Meta des [liens trackés](./liens.md) pour que les publicités comptent comme payantes.

Clés : `campaign_key` = `utm_id` (ou `utm_campaign` numérique), `adset_key` = `aos_adset`, `ad_key` = `aos_ad`.
La dépense est rapprochée par `campaign_key` = `ad_metrics_daily.campaign_id` (comptes du même client),
sinon par nom (`utm_campaign` = nom de campagne). La dépense n'est connue qu'au niveau campagne.

## 8. Modèles d'attribution

Pour chaque conversion, les points de contact de la **personne** (tous ses visiteurs reliés par email ou
téléphone, tous appareils) dans la fenêtre (1 à 90 jours) :

| Modèle | Crédit |
| --- | --- |
| Dernier clic | 100 % au dernier point de contact |
| Dernier clic non direct | 100 % au dernier point de contact non direct |
| Premier clic | 100 % au premier |
| Linéaire | parts égales |
| Décroissance temporelle | poids 2^(-âge / 7 j), normalisé |
| En U | 40 % premier, 40 % dernier, 20 % répartis au milieu |

ROAS réel = valeur attribuée aux canaux payants dont la dépense est connue / dépense.
Objectif « Prospects » : première conversion lead/booking par personne sur la période.
Moteur : `src/lib/tracking/attribution.ts`. Tests :
`node --experimental-strip-types --test src/lib/tracking/tests/tracking.test.mjs`.

## 9. Entonnoir

Chaque site a son entonnoir : la liste ordonnée des étapes que tu veux suivre (onglet Entonnoir). Trois
gabarits à la création, modifiables ensuite :

| Gabarit | Étapes (clé de l'évènement) |
| --- | --- |
| Génération de leads | Prospects (`lead`, `booking`), Prospects qualifiés (`qualified`), Ventes (`purchase`, `deal_won`) |
| Vente par appel | Prospects (`lead`), Rendez-vous pris (`booking`), Rendez-vous honorés (`show`), Prospects qualifiés (`qualified`), Ventes (`purchase`, `deal_won`) |
| E-commerce | Ajouts au panier (`add_to_cart`), Paiements initiés (`begin_checkout`), Achats (`purchase`) |

Une étape compte les évènements qui portent sa clé ou l'un de ses autres noms, qu'ils viennent du script
(`aos('track', 'show')`) ou de l'API (`"type": "show"`). C'est ce qui rend le suivi indépendant du CRM : ton
outil, quel qu'il soit, envoie un évènement quand une personne franchit une étape.

L'onglet affiche par étape les personnes distinctes, le taux depuis l'étape précédente, le nombre
d'évènements et la valeur. Chaque étape est comptée **à sa date** : une vente de la période peut venir d'un
prospect d'une période précédente, et un taux peut dépasser 100 %. Les évènements reçus qui ne correspondent
à aucune étape sont listés à part.

Moteur : `src/lib/tracking/funnel.ts`, RPC `tracking_funnel`.

## 10. Campagnes, fiche d'une personne, couverture

**Onglet Campagnes.** Une ligne par campagne, dépliable en ensembles puis en publicités, avec la dépense, une
colonne par étape de l'entonnoir, le chiffre d'affaires attribué, le ROAS réel et le coût par vente. Le
bouton « Personnes » d'une ligne liste celles qu'elle a amenées.

- Une étape affiche une **somme de poids**, pas un compte de lignes : sous un modèle multi-touches, une vente
  peut valoir 0,5 sur une campagne et 0,5 sur une autre.
- Une campagne qui dépense sans rien produire reste visible, avec des zéros.
- Trois lignes de pied se recoupent : publicité + hors publicité = toutes les conversions.
- Pour descendre jusqu'à la publicité, les URL des annonces doivent porter `utm_id`, `aos_adset` et `aos_ad`
  (modèles UTM de [Liens trackés](./liens.md)). La dépense par publicité vient de la synchro du Reporting.

**Fiche d'une personne.** Depuis l'onglet Visiteurs identifiés ou depuis une ligne de campagne : emails,
téléphones, appareils reliés, et un seul fil qui mêle points de contact et évènements, du plus récent au
plus ancien.

**Couverture.** L'onglet Entonnoir indique par étape la part des évènements « avec une source », c'est-à-dire
précédés d'au moins un point de contact autre que direct dans la fenêtre du site. C'est la mesure de
confiance du reste : si 30 % seulement des ventes ont une source, le tableau des campagnes ne décrit que ces
30 %. La couverture baisse en général le long de l'entonnoir, parce qu'une vente arrive plus tard, souvent
sous un autre email ou depuis un autre appareil. **Compte tes ventes dans l'onglet Entonnoir, et cherche
leur provenance dans l'onglet Campagnes : jamais l'inverse.**

Code : `src/lib/tracking/campaigns.ts` (pur, testé), `loadCampaigns` et `loadPerson` dans `load.ts`,
RPC `tracking_person` et `tracking_funnel`.

## 11. API serveur

L'onglet API crée des **clés d'envoi** (`sk_…`), une par outil branché (Stripe, CRM, Zapier). Une clé n'est
affichée qu'une fois, à sa création : seule son empreinte SHA-256 est conservée (`tracking_keys`). Tu peux en
révoquer une sans couper les autres.

```http
POST /api/t/conversion
Authorization: Bearer sk_…

{ "email": "…" | "phone": "+33…" | "anon_id": "…", "type": "purchase", "value": 189.9, "currency": "EUR",
  "order_id": "CMD-1042", "ts": "2026-09-25T10:00:00Z", "name": "…", "phone": "…", "props": {} }
```

Réponses : 201 créée, 200 `{ "duplicate": true }`, 400, 401, 413, 429.

- **Zapier / Make** : action « Webhooks POST » / « HTTP Make a request » avec l'en-tête ci-dessus.
- **Stripe** : webhook `https://<app>/api/t/webhooks/stripe?key=sk_…`, évènements
  `checkout.session.completed` et `invoice.paid`. Signature vérifiée si `STRIPE_WEBHOOK_SECRET` est défini.
  Passe `client_reference_id: window.aos.id` (ou `metadata.aos_id`) pour relier le parcours.
- **Shopify Flow** : « Order paid » > « Send HTTP request » (corps Liquid dans l'onglet API).
- **WooCommerce** : hook `woocommerce_payment_complete` + `wp_remote_post` (exemple dans l'onglet API).
- **Deals du CRM** : pour le site de l'agence (sans client), un deal gagné dont le contact a l'email
  d'un visiteur compte comme conversion `deal_won` de la valeur du deal. Pour ce site seulement, les
  visiteurs identifiés sont reliés à un contact CRM (réglage « Créer les contacts CRM »).

## 12. Webhook d'un CRM ou d'un agenda

Pour un outil qui sait envoyer un webhook mais pas choisir la forme de ses données :

```http
POST /api/t/webhooks/in?key=sk_…&type=booking
```

`type` est l'étape de l'entonnoir à compter : une adresse par étape à suivre. Dans les données reçues (JSON
ou formulaire encodé), l'email, le téléphone, le nom, le montant, l'identifiant, la date et la devise sont
cherchés par leur nom, le champ le plus proche de la racine l'emportant. Quand l'outil envoie plusieurs
emails, désigne le bon par son chemin :

```
…&type=booking&email=payload.attendees.0.email&id=payload.uid
```

Paramètres de chemin : `email`, `phone`, `name`, `value`, `id`, `date`, `currency`. L'identifiant évite de
compter deux fois le même envoi. Une donnée sans email ni téléphone répond `200 {"ignored": …}` pour que
l'outil ne la renvoie pas en boucle. L'onglet Sources construit l'adresse, avec des préréglages pour
Cal.com et Calendly.

Le préréglage Cal.com suit le format que le module Rendez-vous lit déjà. Celui de Calendly et la recherche
par nom n'ont pas encore été confrontés aux envois réels de Calendly, HubSpot, Pipedrive ou GoHighLevel :
vérifie le premier envoi dans l'onglet Installation (testeur en direct).

Code : `src/lib/tracking/sources.ts`.

## 13. Import CSV des conversions hors ligne

Onglet Sources > **Importer un fichier CSV**. Colonnes reconnues, en français ou en anglais : email,
téléphone, type, valeur, devise, date, identifiant. Il faut l'email ou le téléphone. Sans colonne « type »,
tu choisis l'étape pour tout le fichier.

- L'aperçu annonce le nombre de lignes prêtes, celles qui sont illisibles, et les types qui ne correspondent
  à aucune étape.
- La date du fichier est celle de la conversion : importer en octobre une vente de septembre la compte en septembre.
- Réimporter le même fichier ne double rien : l'identifiant de la ligne, ou à défaut la ligne elle-même,
  sert de clé.
- Réservé aux membres qui peuvent modifier l'espace. Envoi par paquets de 100 lignes.

## 14. Extension Chrome

L'extension [Colonnes CRM pour Ads Manager](https://github.com/impulsion-com/crm-ads-columns) affiche les
chiffres du tracking dans Meta Ads Manager et Google Ads, à côté de ceux de la régie. Elle lit quatre routes
en lecture seule, sous `/api/ext/v1/`.

**Brancher l'extension.** Réglages > API et MCP > nouveau jeton, accès « Extension Chrome ». Ce jeton
n'ouvre que ces quatre routes : ni le serveur MCP, ni le reste de l'application. Colle l'adresse de ton
application et le jeton dans le popup de l'extension, puis « Tester la connexion ».

**Quel site ?** L'extension envoie le compte publicitaire ouvert dans la page (`compte=act_…`). Le site
retenu est celui du même client que ce compte, ou celui de l'agence pour un compte sans client. Le compte
doit donc être connecté dans le Reporting. Sur un compte inconnu, l'extension se tait.

| Route | Rôle |
| --- | --- |
| `ping` | Valide le jeton et annonce le terrain : sites, comptes suivis, modèles, périodes, et le catalogue des colonnes du site visé, dérivé de son entonnoir |
| `metrics` | Les colonnes par entité, indexées `plateforme:niveau:externalId` (niveau : `campagne`, `adset`, `pub`). Paramètres : `niveau`, `plateforme`, `ids`, `compte` ou `site`, et les filtres `p`, `du`, `au`, `m`, `f` |
| `prospects` | Les personnes créditées à une ligne, 30 au plus, avec un lien vers leur fiche |
| `index` | Le référentiel nu, pour un rapprochement par nom de dernier recours, avec les noms ambigus |

Trois règles du contrat décident de ce que l'extension affiche :

1. Une entité **connue** sans activité sur la période apparaît avec des zéros. Une entité absente veut dire
   « inconnue du serveur ». C'est ce qui distingue « 0 vente » de « pas synchronisée ».
2. Un ratio indéfini vaut `null`, jamais `0` : un coût par vente sur zéro vente n'existe pas.
3. La réponse déclare la fenêtre demandée **et** la fenêtre effective (90 jours au plus), ainsi que le modèle
   réellement utilisé.

Les colonnes : `depense`, puis une par étape (`leads` pour l'étape d'entrée, `ventes` pour les étapes de vente,
`etape_<clé>` pour les autres), `cpl`, `caSigne`, `roas`, `cac`, `conversionsPlateforme`. Chaque colonne porte
un `role` (`cout`, `etape`, `resultat`, `valeur`, `ratio`, `regie`).

Ce contrat est aussi celui du CRM interne d'Impulsion : une seule extension parle aux deux. **Rien n'écrit
sous `/api/ext/`** : `scripts/test-tracking-ext.mjs` échoue si une méthode d'écriture y apparaît.

Code : `src/lib/tracking/ext-contract.ts` (pur, testé), `src/lib/tracking/ext.ts`, `src/app/api/ext/v1/`.

## 15. Sécurité

Collecte publique (`/t.js`, `/api/t/*` hors proxy de session), CORS ouvert, validation zod, corps
limité à 16 Ko, filtre des robots par user-agent, contrôle de l'origine face aux domaines déclarés,
limite de débit en mémoire (300 requêtes par minute par clé et IP), travail en base après la réponse
(`after()`), écriture par le service role uniquement. Lecture via les RPC `tracking_conversions`,
`tracking_stats`, `tracking_people` (security definer, appartenance à l'espace vérifiée).

Limites connues : la limite de débit est par instance serveur ; les montants ne sont pas convertis entre devises.
