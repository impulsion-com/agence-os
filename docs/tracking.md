# Tracking first-party et attribution

Le module « Attribution » suit les visiteurs des sites de tes clients avec un script first-party,
les identifie (formulaires, `identify`), enregistre leurs conversions (script, API serveur, Stripe,
deals du CRM) et répartit le crédit de chaque vente entre les points de contact qui l'ont précédée.
Il compare ensuite ce ROAS réel au ROAS déclaré par Meta, Google…

## 1. Créer un site suivi

Attribution > Nouveau site suivi : nom, client (ou aucun pour le site de l'agence), domaines
(un par ligne, sous-domaines inclus), modèle d'attribution par défaut, fenêtre, consentement,
capture des formulaires. Seuls les domaines déclarés peuvent envoyer des données (vide = tous).

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

## 4. Fonctionnement du script (`/t.js`, 5,4 Ko, ES5)

- Lit sa clé (`data-key` ou `?k=`) puis `GET /api/t/config?k=` (domaines, consentement, formulaires).
- Identifiant : cookie `_aos_id` (1 an, domaine racine) + localStorage en secours.
  Session : cookie `_aos_s` (30 min, prolongé à chaque envoi).
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

Aucune IP n'est stockée (pays seulement, via `x-vercel-ip-country`). Les emails ne sont visibles que
des membres. Onglet « Visiteurs identifiés » : suppression d'une personne (tous ses visiteurs, points
de contact et évènements).

## 6. Canaux

UTM d'abord (medium payant : cpc, ppc, paid_social, display… ; email, newsletter ; social, bio ; organic),
puis identifiants de clic (gclid/gbraid/wbraid → Google Ads, ttclid → TikTok, li_fat_id → LinkedIn,
msclkid, sccid, epik → autres régies), puis lien court (`aos_lid`), puis référent (moteurs → recherche
organique, réseaux → social organique, webmails → email, sinon site référent), sinon direct.
**fbclid seul = social organique** (Facebook l'ajoute aussi aux publications) : utilise le modèle UTM
Meta des [liens trackés](./liens.md) pour que les publicités comptent comme payantes.

Clés : `campaign_key` = `utm_id` (ou `utm_campaign` numérique), `adset_key` = `aos_adset`, `ad_key` = `aos_ad`.
La dépense est rapprochée par `campaign_key` = `ad_metrics_daily.campaign_id` (comptes du même client),
sinon par nom (`utm_campaign` = nom de campagne). La dépense n'est connue qu'au niveau campagne.

## 7. Modèles d'attribution

Pour chaque conversion, les points de contact de la **personne** (tous ses visiteurs fusionnés par email,
tous appareils) dans la fenêtre (1 à 90 jours) :

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

## 8. API serveur

```http
POST /api/t/conversion
Authorization: Bearer sk_…

{ "email": "…" | "anon_id": "…", "type": "purchase", "value": 189.9, "currency": "EUR",
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

## 9. Sécurité

Collecte publique (`/t.js`, `/api/t/*` hors proxy de session), CORS ouvert, validation zod, corps
limité à 16 Ko, filtre des robots par user-agent, contrôle de l'origine face aux domaines déclarés,
limite de débit en mémoire (300 requêtes par minute par clé et IP), travail en base après la réponse
(`after()`), écriture par le service role uniquement. Lecture via les RPC `tracking_conversions`,
`tracking_stats`, `tracking_people` (security definer, appartenance à l'espace vérifiée).

Limites connues : la clé secrète est lisible en base par un invité de l'espace (l'interface la lui
masque) ; la limite de débit est par instance serveur ; les montants ne sont pas convertis entre devises.
