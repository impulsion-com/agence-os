# Docs & process

Module `docs` (`/w/<slug>/docs`, migration `0122_docs.sql`). Le wiki de l'agence : les process,
les checklists et la documentation interne, au même endroit que les projets et les clients.
Repris de l'onglet Docs du CRM Impulsion, lui-même bâti sur le modèle de [Docmost](https://docmost.com)
(wiki open source sur Tiptap) : des **espaces**, des **pages**, des **sous-pages** sans limite de profondeur.

## Le modèle

| Table | Rôle |
| --- | --- |
| `doc_spaces` | Un espace (Process, Agence, Clients…) : nom, emoji, description, ordre |
| `doc_pages` | Une page : titre, emoji, contenu (HTML Tiptap), texte brut (`plain`, pour la recherche), parente, ordre, corbeille (`deleted_at`), page Notion d'origine (`notion_id`) |
| `doc_versions` | L'historique : une version par séance d'écriture |

Les clés étrangères font une partie du travail :

- `(space_id, workspace_id)` vers `doc_spaces` : une page reste dans l'espace de travail de son espace.
- `(parent_id, space_id)` vers `doc_pages`, `on update cascade` : une sous-page est toujours dans
  l'espace de sa parente, et changer l'espace d'une page emmène toutes ses sous-pages.
- Un espace qui contient encore des pages (corbeille comprise) ne se supprime pas : la base renvoie
  `23503`, l'écran l'explique.

RLS : lecture pour les membres, écriture pour `can_write` (un invité lit sans écrire). Une page ne se
supprime définitivement que si elle est déjà à la corbeille. `doc_versions` n'a qu'une policy de
lecture : l'historique s'écrit seulement par `doc_save_page`.

## Les fonctions

| RPC | Ce qu'elle fait |
| --- | --- |
| `doc_save_page(p_id, p_title, p_content, p_plain, p_read)` | Enregistre titre et/ou contenu, tient l'historique (les enregistrements d'une même personne à moins de 10 minutes se fondent). Si quelqu'un d'autre a enregistré depuis `p_read`, refuse avec le code `AO409`. Renvoie `{ version_at }`, à repasser au prochain appel |
| `doc_move_page(p_id, p_space, p_parent, p_order)` | Déplace sous une autre page ou à la racine d'un espace, refuse qu'une page devienne sa propre sous-page, range les sœurs dans l'ordre de `p_order` |
| `doc_trash_page(p_id)` | Met la page et ses sous-pages à la corbeille, au même instant |
| `doc_restore_page(p_id)` | Les en sort ensemble. Si la parente est encore à la corbeille, la page revient à la racine de son espace |

Le reste (créer une page, renommer un espace, changer une icône) s'écrit directement en base depuis le
navigateur, comme partout dans Agence OS.

## L'écran

- **Éditeur** Tiptap (MIT) : titres, listes, cases à cocher, tableaux, citations, code, liens, images.
  Les raccourcis Markdown marchent à la frappe (`#`, `-`, `[]`, `>`, ` ``` `). Une image se colle, se
  glisse ou s'envoie par le bouton.
- **Enregistrement automatique** 0,8 s après la frappe. En cas de conflit (`AO409`), un bandeau propose de
  recharger : on n'écrase jamais le travail d'un autre en silence.
- **Arbre** : glisser une page sur une autre en fait une sous-page, sur le haut ou le bas d'une ligne la
  range avant ou après, sur le nom d'un espace la met à sa racine.
- **Recherche** : sur l'accueil des docs, et dans la palette ⌘K (groupe « Docs »).
- **Historique** : aperçu en lecture seule de chaque version, restauration (qui crée une nouvelle version).
- **Corbeille** : `/docs/trash`. Suppression définitive depuis là seulement.

Le contenu est stocké en HTML mais jamais injecté tel quel : il est toujours relu par l'éditeur, qui ne
garde que les nœuds de son schéma (l'aperçu de l'historique aussi).

## Images

Dans le bucket privé `attachments`, sous `<workspace_id>/docs/<nom tiré au hasard>`. La page garde une
adresse stable, `/api/docs/file?p=<chemin>` : la route crée à chaque lecture une URL signée d'une heure
avec la session de l'utilisateur, donc la RLS du stockage vérifie qu'il est membre de l'espace. Le chemin
passe en paramètre, pas dans l'URL, pour que le `proxy.ts` (qui ignore les URL finissant par `.png`)
rafraîchisse bien la session.

## Importer depuis Notion

Dans Notion : menu `···` de la page, **Exporter**, format **Markdown & CSV**, cocher **Inclure les
sous-pages**. Dans Agence OS : **Importer depuis Notion** (bas de l'arbre, accueil, ou menu d'un espace ou
d'une page), déposer le .zip tel quel.

- Sous-pages, images et liens d'une page à l'autre suivent. Une base de données devient une page qui en
  montre le tableau, et ses lignes ses sous-pages. Les encadrés deviennent des citations.
- Une page déjà importée (même identifiant Notion, `notion_id`) n'est pas recréée : relancer complète
  sans doublonner.
- 150 Mo au plus. Tout se passe **dans le navigateur** (`src/lib/docs/notion-import.ts`) : l'archive est
  lue sur place, les images vont directement dans le stockage et les pages s'écrivent sous la RLS. Aucune
  route serveur, donc pas de limite de taille d'envoi de l'hébergeur (4,5 Mo sur Vercel).

## MCP

Outils `list_docs`, `search_docs`, `read_doc`, `create_doc` et `update_doc` (`src/lib/mcp/tools/docs.ts`).
Le contenu s'écrit en Markdown, converti par `src/lib/docs/markdown.ts`. `create_doc` crée l'espace s'il
n'existe pas. Chaque écriture laisse une version dans l'historique. Exemple de demande à Claude : « rédige
le process de lancement d'une campagne Google Ads dans l'espace Process, avec une checklist ».

## Démo

`_demo_docs` pose deux espaces (Process, Agence) et six pages d'exemple (`is_demo`). `clear_demo_docs`
les retire ; une page ajoutée à la main dans un espace de démo reste, l'espace aussi.

## Recette

`node --env-file=.env.local scripts/test-docs.mjs [dossier des captures]`, serveur de dev lancé, compte
`demo@agence-os.dev` et espace `studio-demo` avec la démo : accueil, enregistrement, conflit, historique,
glisser-déposer, corbeille, palette, import Notion (et réimport sans doublon), mobile. Elle supprime ce
qu'elle crée.

## Plus tard

- Partager une page avec un client dans le portail (`portal_*`, en lecture seule).
- Relier une page à un projet ou à un modèle de projet (le process de lancement à côté de ses tâches).
- Temps réel : voir qui est sur la page.
