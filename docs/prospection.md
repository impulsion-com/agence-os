# Prospection Google Maps

L'onglet **Prospection** du CRM (`/w/<espace>/crm/prospects`) reçoit des fiches d'entreprises trouvées sur Google Maps : nom, catégorie, adresse, téléphone, site, emails, note et nombre d'avis. Tu les tries, puis tu ajoutes au CRM celles qui valent un appel.

Les fiches restent à part tant que tu ne les ajoutes pas : une seule recherche peut en ramener des milliers, et le CRM ne doit contenir que les entreprises que tu travailles vraiment.

## Récupérer des fiches

Agence OS ne parcourt pas Google Maps lui-même : il lit ce que produit [google-maps-scraper](https://github.com/gosom/google-maps-scraper) (gosom, open source, licence MIT), qui tourne sur ton ordinateur ou sur un serveur.

**Avec Claude Code** (le plus simple) :

1. Installe le skill du scraper : `npx skills add gosom/google-maps-scraper` (Docker et Node.js nécessaires).
2. Branche Agence OS en MCP (voir [mcp.md](./mcp.md)), avec un jeton **Lecture et écriture**.
3. Demande : « trouve les agences immobilières de Nantes avec leur email et mets-les dans ma prospection ». Claude lance la recherche, puis envoie les fiches avec l'outil `import_prospects`.

**À la main** :

1. Lance le scraper, par exemple :

   ```bash
   echo "agence immobilière Nantes" > recherches.txt
   docker run -v gmaps-playwright-cache:/opt -v "$PWD:/data" gosom/google-maps-scraper \
     -input /data/recherches.txt -results /data/nantes.csv \
     -lang fr -depth 5 -email -exit-on-inactivity 3m
   ```

   `-depth` règle le nombre de résultats parcourus par recherche (1 donne une vingtaine de fiches), `-email` lit le site de chaque entreprise pour y trouver une adresse.
2. Dans **Prospection**, clique **Importer un CSV** et dépose le fichier. La recherche d'origine est déduite du nom du fichier, tu peux la corriger.

L'import accepte aussi les exports d'autres outils (Outscraper, Apify, fichier maison) : seule une colonne nom est obligatoire (`title`, `name` ou `nom`), les autres sont reconnues par leurs noms usuels (téléphone, site, email, ville, code postal, note, avis…).

## Ce que fait l'import

- **Doublons** : une fiche déjà présente (même identifiant Google, ou même nom et même code postal) est ignorée. Tu peux réimporter un fichier sans risque.
- **Emails** : le scraper ramène parfois des noms d'images (`logo@2x.png`) ou des adresses techniques (Sentry, Wix). Ils sont retirés. Parmi les adresses restantes, celle proposée pour le contact évite les adresses RH, sans réponse ou de facturation (`recrutement@`, `noreply@`, `compta@`…).
- **Fiches fermées définitivement** : écartées.

## Trier et ajouter au CRM

- Filtres : catégorie, ville, avec email, avec site, note de 4 et plus, 20 avis et plus, recherche libre. Tri par colonne (par défaut, les plus commentées d'abord).
- Sélectionne des fiches, puis **Ajouter au CRM**. Pour chacune :
  - l'entreprise est créée en **prospect** (ou reprise si une entreprise du même nom existe déjà), avec en note l'adresse, le téléphone, la note Google et le lien de la fiche ;
  - un **contact** est créé avec le meilleur email et le téléphone, sauf si cet email est déjà au CRM ;
  - si **Ouvrir un deal** est coché, un deal à 0 € arrive à la première étape du pipeline, source « Prospection ».
- **Écarter** range une fiche sans la supprimer : elle ne reviendra pas au prochain import. **Supprimer** l'efface, et un réimport la ferait revenir.

## Outils MCP

- `import_prospects` : envoie jusqu'à 1 000 fiches par appel (correspondance des colonnes gosom décrite dans l'outil).
- `list_prospects` : liste filtrée (statut, catégorie, ville, email, site, note, avis).
- `add_prospects_to_crm` : même effet que le bouton, deal compris par défaut.

Ils dépendent du module CRM (Réglages > Modules).

## Cadre légal

- Les conditions d'utilisation de Google interdisent l'extraction automatisée de Google Maps. Le scraper est un outil tiers : c'est toi qui choisis de l'utiliser, et tu en portes le risque.
- En France, la prospection par email entre professionnels est permise sans accord préalable si le message concerne l'activité de la personne (CNIL). Chaque message doit indiquer d'où vient l'adresse et proposer un moyen simple de ne plus être contacté.
