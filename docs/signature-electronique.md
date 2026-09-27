# Signature électronique des propositions

Agence OS fait signer les propositions (devis) en ligne, sans service tiers, avec une
**signature électronique simple** au sens du règlement eIDAS (art. 3.10 et 25) et des
articles 1366 et 1367 du Code civil. Ce niveau suffit pour un devis B2B en France : ce qui
compte est de pouvoir prouver **qui** a signé, **quoi**, **quand**, et que le document n'a
pas changé depuis.

## Parcours du client

Sur la page `/p/<jeton>` (aucun compte requis) :

1. Il relit la proposition et coche les options qui l'intéressent.
2. « Signer la proposition » : prénom, nom, fonction, société, email.
3. Si l'envoi d'emails est configuré, il reçoit un **code à 6 chiffres** (valable 10 minutes,
   5 essais, 5 envois par heure au plus). Sans email configuré, cette étape est sautée et
   le dossier de preuve indique « email déclaré, non vérifié ».
4. Il recopie la mention **« Bon pour accord »**, signe dans le cadre (souris, doigt, stylet,
   avec « Effacer ») ou tape son nom (rendu en écriture manuscrite), puis coche le
   consentement, qui rappelle les montants engagés.
5. Écran de confirmation et **PDF signé** à télécharger.

Si l'agence modifie la proposition (lignes comprises) pendant que le client la lit, la
signature est refusée : il doit recharger la page pour signer la dernière version.

## Ce qui est figé et prouvé

- **Instantané** : à la signature, le contenu (blocs, lignes, options retenues, totaux,
  parties, identité du signataire, consentement, empreinte de l'image de signature) est
  copié dans `proposal_signatures.snapshot`.
- **Empreinte SHA-256** du JSON canonique (clés triées) de l'instantané : `document_hash`.
  L'onglet « Preuve de signature » la recalcule à chaque affichage (« Intégrité vérifiée »).
- **Verrou** : une proposition signée et ses lignes ne sont plus modifiables, même en base.
  Pour une nouvelle version : menu « … » puis « Dupliquer ».
- **Piste d'audit** (`proposal_signature_events`) : envoi, ouverture, code envoyé, erroné ou
  validé, signature, PDF généré, contre-signature, relance, refus. Chaque événement garde
  l'heure, l'**IP tronquée** (203.0.113.0) et **hachée** (jamais l'adresse complète) et le
  navigateur.
- **PDF signé** : le document, le bloc « Signatures » et un **certificat de signature**
  (empreinte, signataire, vérification de l'email, consentement exact, journal des
  événements, mention légale). Il est rangé dans le bucket privé `signatures` et se
  télécharge via `/api/signature/<jeton>/pdf` (`?inline=1` pour l'ouvrir).

## Côté agence

- **Statuts** : Brouillon, Envoyée, Vue, Signée (« à contre-signer » ou « par les deux
  parties »), Refusée, Expirée.
- **Envoyer** : si les emails sont configurés, la modale envoie directement le lien au client
  (message personnel facultatif). Sinon, email pré-rempli dans ta messagerie ou lien à
  copier. Sur une proposition déjà envoyée, le bouton devient « Renvoyer » (relance).
- **Contre-signature** : coche « Contre-signature de l'agence » dans le panneau avant
  l'envoi. Une fois le client signé, clique « Contre-signer » : le PDF est régénéré avec les
  deux signatures et le client reçoit la version finale.
- **Onglet « Preuve de signature »** : signataire, image, email vérifié ou non, IP tronquée,
  navigateur, consentement, empreinte, PDF, piste d'audit.
- À la signature, le **deal lié passe en Gagné** et le responsable reçoit une notification.

## Configuration

| Variable | Rôle |
| --- | --- |
| `RESEND_API_KEY`, `EMAIL_FROM` | Facultatif. Active le code de vérification par email, l'envoi de la proposition et les confirmations avec le PDF. |
| `SIGNATURE_SECRET` | Facultatif. Clé des HMAC (codes, IP). À défaut, la clé service role est utilisée. |
| `NEXT_PUBLIC_APP_URL` | URL publique utilisée dans les liens des emails. |

## Vérifier une signature a posteriori

1. Ouvre la proposition, onglet « Preuve de signature » : « Intégrité vérifiée » confirme
   que l'instantané conservé correspond à l'empreinte enregistrée.
2. Compare l'empreinte affichée à celle du certificat du PDF (et à celle du pied de page).
3. La piste d'audit et le certificat donnent l'enchaînement horodaté des événements.

## Limites

- Signature « simple » : pas de certificat qualifié ni d'horodatage par une autorité tierce.
  Pour un acte exigeant une signature avancée ou qualifiée, passe par un prestataire qualifié.
- Sans email configuré, l'adresse du signataire est seulement déclarée.
- L'IP est lue dans l'en-tête `x-forwarded-for` : déploie derrière un proxy qui le réécrit
  (Vercel, Traefik, Nginx).
- Le lien de la proposition donne accès à son PDF signé : ne le partage qu'avec le client.

Tests : `node --experimental-strip-types --test src/lib/signature/tests/crypto.test.mjs`
