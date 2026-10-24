# Serveur MCP et API

Agence OS expose un serveur MCP distant (Streamable HTTP, sans état) sur `/api/mcp`.
Claude Code, Claude Desktop, Cowork, Cursor… peuvent alors lire et modifier l'espace avec les droits de l'utilisateur :
« liste mes tâches en retard », « crée un deal pour Nova SaaS à 1 500 €/mois », « quel est le ROAS réel de Maison Lumen ce mois-ci ? ».

## Jetons

Réglages > API et MCP > Nouveau jeton. Portée « Lecture seule » ou « Lecture et écriture » (un invité est toujours en lecture seule), expiration facultative.
Le jeton complet (`aos_…`) n'est montré qu'une fois ; seule son empreinte SHA-256 est stockée (table `api_tokens`).
Révocation immédiate. Les admins voient et révoquent tous les jetons de l'espace.

## Connexion

- **Claude Code** :

  ```bash
  claude mcp add --transport http agence-os https://<app>/api/mcp --header "Authorization: Bearer aos_…"
  ```

  Ajoute `--scope user` pour l'avoir dans tous tes projets.
- **Claude Desktop, Cowork, claude.ai** : Réglages > Connecteurs > Ajouter un connecteur personnalisé, URL `https://<app>/api/mcp/aos_…`.
  L'URL contient le jeton : c'est un secret. L'application doit être accessible sur Internet (pas `localhost`).
- **Claude Desktop par fichier** (`claude_desktop_config.json`, nécessite Node.js) :

  ```json
  {"mcpServers":{"agence-os":{"command":"npx","args":["-y","mcp-remote","https://<app>/api/mcp","--header","Authorization:${AGENCE_OS_AUTH}"],"env":{"AGENCE_OS_AUTH":"Bearer aos_…"}}}}
  ```

- **Autres clients** :

  ```json
  {"mcpServers":{"agence-os":{"url":"https://<app>/api/mcp","headers":{"Authorization":"Bearer aos_…"}}}}
  ```

## Sécurité

- À chaque appel, le jeton est résolu en utilisateur, espace et rôle actuel. Un membre retiré reçoit 403 ; un jeton révoqué ou expiré, 401.
- Les outils d'écriture sont masqués et refusés pour un jeton en lecture seule ou un invité.
- Le serveur utilise le service role, mais chaque requête filtre par `workspace_id`.
- Les écritures sont journalisées dans `activity`, avec l'utilisateur du jeton comme acteur et `meta.via = "mcp"`.
- Limites en mémoire, par instance : 120 appels par minute et par jeton, 40 écritures par minute, 30 échecs d'authentification par minute et par IP.
- L'URL avec jeton (`/api/mcp/aos_…`) apparaît dans les journaux du serveur : préfère l'en-tête `Authorization` quand le client le permet.

## Outils

- **Espace** : whoami, search
- **Projets et tâches** : list_projects, get_project, create_project, list_tasks, get_task, create_task, update_task, add_comment
- **CRM** : list_deals, get_deal, create_deal, update_deal, list_companies, get_company, create_company, list_contacts, create_contact, add_crm_activity
- **Propositions** : list_proposals, get_proposal, create_proposal (brouillon)
- **Reporting** : get_performance, get_campaigns, get_site_analytics (GA4 et Clarity)
- **Attribution** : get_attribution
- **Liens** : create_tracked_link, list_links
- **Bibliothèque créa** : list_competitor_ads, list_creative_concepts, get_creative_recommendations, create_creative_concept
- **Portail client** : list_client_portals, set_task_client_visibility

Les références acceptent un identifiant, une clé (ACME-12), une clé de projet ou un nom ; « me » désigne l'utilisateur du jeton.
Dates : AAAA-MM-JJ, « aujourd'hui », « demain », « +7 ».
Aucun outil ne signe ni n'accepte une proposition : la signature se fait par le client, sur la page publique.

## Ajouter les outils d'un module

1. Crée `src/lib/mcp/tools/<module>.ts` qui exporte
   `export const <module>Tools = [defineTool({ name, title, description, input: z.object({…}), write?, run: async (args, ctx) => ({ text, data }) })]`.
2. Ajoute-le à `DOMAINS` dans `src/lib/mcp/tools/index.ts`, avec son libellé : la page Réglages le liste automatiquement.

Règles : noms en anglais snake_case et uniques (vérifiés au chargement) ; descriptions et sorties en français ;
`write: true` pour toute modification ; toujours filtrer par `ctx.workspace.id` ; utilise `resolveProject`,
`resolveTask`, `resolveCompany`, `resolveMember`, `must`, `table` et `ctx.log()` ; lève `ToolError` pour une erreur à montrer au modèle.

## Tests

`node src/lib/mcp/tests/mcp.test.mjs` (serveur de dev lancé, `.env.local` rempli). Le script crée ses propres jetons et données,
vérifie le protocole, la lecture, l'écriture, la lecture seule, la révocation, l'expiration, le rôle et le cloisonnement entre espaces, puis nettoie tout.
