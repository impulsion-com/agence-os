@AGENTS.md

# Agence OS

Espace de travail open source (MIT) pour agences marketing / media buying / creative strategy :
gestion de projet (façon Linear), CRM, propositions commerciales et reporting publicitaire
(Meta Ads, Google Ads). Destiné aux élèves d'Impulsion, qui le déploient chacun chez eux.

## Stack

- Next.js 16 (App Router, `proxy.ts`, `params`/`searchParams`/`cookies()` asynchrones), React 19, TypeScript strict.
- Supabase : Postgres + Auth + Storage + RLS. Aucune API maison pour le CRUD : le client
  navigateur écrit directement en base, protégé par RLS. Le service role ne sert qu'aux
  routes serveur (OAuth des plateformes pub, synchro, cron).
- CSS : tokens et classes de composants dans `src/app/globals.css` (+ Tailwind v4 pour la mise en page).
  Pas de librairie de composants. Icônes : `lucide-react` (ou `<Icon name="…">` pour un nom stocké en base).

## Conventions

- **Interface 100 % en français**, tutoiement dans les textes d'aide. **Jamais de tiret long** (em dash).
- Données : une page = un Server Component qui charge via `supabaseServer()` puis passe les
  données à un Client Component. Les mutations se font côté client avec `useMutate()` :
  ```ts
  const mutate = useMutate();
  await mutate(async (sb) => must(await sb.from("tasks").update({ status }).eq("id", id)), { success: "Statut mis à jour" });
  ```
  `useMutate` affiche l'erreur en toast et appelle `router.refresh()`. Pour une UI fluide
  (glisser-déposer, cases à cocher), mettre à jour un état local optimiste avant l'appel.
- Contexte d'espace : `useWorkspace()` donne `workspace`, `me`, `role`, `members`, `teams`,
  `labels`, `projects`, `companies`, `favorites`, `base` (préfixe `/w/<slug>`), `canWrite`,
  `isAdmin` et les accès `member(id)`, `project(id)`, `company(id)`, `label(id)`.
  Côté serveur : `loadWorkspace(slug)` (mis en cache par requête).
- Tâches : charger avec `TASK_SELECT` puis `normalizeTask` (`src/lib/tasks.ts`). Filtres, tri,
  regroupement et positions (`between`) sont dans ce même fichier.
- Composants partagés : `components/ui/*` (overlay : Popover, Menu, Modal, Drawer, ConfirmModal ;
  avatar ; status : StatusIcon, PriorityIcon ; misc : EmptyState, Progress, LabelChip, ObjIcon,
  Badge, PageHeader), `components/pickers.tsx` (StatusPicker, PriorityPicker, AssigneePicker,
  LabelsPicker, DatePicker, ProjectPicker, CompanyPicker, DueText).
- Modales de création globales : `useUI().create({ kind: "task" | "project" | "deal" | "proposal" | "invite", defaults })`.
- Ouvrir une tâche n'importe où : ajouter `?task=<id>` à l'URL courante (le tiroir global le lit).
- Fil d'Ariane dynamique : `<SetCrumbs items={[{ label, href }]} />` dans la page.
- Journal : `logActivity(sb, { workspace_id, verb, project_id?, task_id?, deal_id?, meta? })`.
  Verbes : `task.created`, `task.status`, `task.assigned`, `task.commented`, `task.completed`,
  `project.created`, `project.status`, `deal.created`, `deal.stage`, `deal.won`, `deal.lost`,
  `proposal.sent`, `proposal.accepted`.
- Couleurs nommées (`indigo`, `amber`…) ou hex : toujours passer par `colorOf()`.
- Formats : `src/lib/format.ts` (fmtDate, relDate, ago, money, num, pct, initials…).

## Base de données

- Migrations dans `supabase/migrations/` (appliquées dans l'ordre). Après une migration,
  régénérer les types : `./scripts/gen-types.sh <project-ref>` (ou la CLI Supabase).
- Tout est cloisonné par `workspace_id` + RLS (`is_member`, `can_write`, `is_admin`).
  Le rôle `guest` lit sans écrire.
- Analytics de site (GA4, Clarity) : `src/lib/analytics/`, voir `docs/analytics.md`. Les jetons Clarity
  sont dans `analytics_secrets` (aucune policy).
- `ad_connections` (jetons OAuth) n'a aucune policy : lecture/écriture uniquement via le
  service role. La vue `ad_connections_public` expose les colonnes sans secret.
- Pages publiques via RPC `security definer` : `public_proposal`, `respond_proposal`, `public_report`.
- Données de démo : chargées et supprimées par `POST /api/demo` (`src/lib/demo.ts`), qui enchaîne
  `load_demo_data` (droits de l'utilisateur), puis en service role `_demo_links`,
  `demo_tracking_seed_part` (par client et par tranche de 20 jours, sous le délai de 8 s de l'API),
  `_demo_creatives`, `_demo_intel`, `_demo_analytics`, `_demo_onboarding`, `_demo_booking` et `_demo_portal`. Chaque module a son `clear_demo_*`.
- Modules activables (`src/lib/modules.ts`, colonne `workspaces.modules`, null = tous) : tout nouvel
  écran, menu, action ou outil MCP propre à un module se conditionne avec `useWorkspace().has("<module>")`
  et déclare ses routes dans `MODULES[].routes` (le `ModuleGate` de l'AppShell affiche alors la page
  « module désactivé »). C'est de l'ergonomie, pas de la sécurité : la RLS ne change pas.
- Portail client (`/c/<slug>`, migration `0090_client_portal.sql`) : un client n'est PAS membre de
  l'espace (table `client_users`, une entreprise par ligne). Il ne lit aucune table en direct : tout
  passe par des fonctions `portal_*` (security definer) qui commencent par
  `perform portal_require(<company_id>, '<fonctionnalité>')` et ne renvoient que les colonnes destinées
  au client. Ne jamais ajouter de policy RLS « client » sur une table métier. Après tout changement :
  `node --env-file=.env.local scripts/test-portal-security.mjs`, puis `test-portal-rpc.mjs` et
  `test-portal-agency.mjs`, doivent passer (un par un). Côté agence, `ws.person(id)` renvoie un membre
  ou un client (`ws.clients`) pour afficher l'auteur d'un commentaire. Voir `docs/portail-client.md`.
- Emails : `src/lib/email.ts` (Resend, facultatif). Toute fonctionnalité doit marcher sans email.
- Pages publiques (proposition `/p/`, onboarding `/f/`, rendez-vous `/b/`, rapport `/r/`, liens `/l/`) :
  lecture et écriture uniquement via routes serveur en service role ou RPC `security definer`.
- MCP : `/api/mcp`, outils dans `src/lib/mcp/tools/` (un fichier par domaine, voir `docs/mcp.md`).
- Tracking (« Tracking OS », plan dans `docs/plan-tracking.md`) : les clés d'envoi sont dans `tracking_keys`
  (hash SHA-256 seulement, colonne `key_hash` illisible côté client) et se créent ou se révoquent par les RPC
  `create_tracking_key` / `revoke_tracking_key`. L'entonnoir d'un site est dans `tracking_stages` ; un
  déclencheur le pose à la création du site depuis `settings.template`. Tests :
  `node --experimental-strip-types --test src/lib/tracking/tests/tracking.test.mjs` (moteur) et
  `node scripts/test-tracking-os.mjs` (parcours réel, serveur de dev lancé).

## Développement

- `npm run dev` puis http://localhost:3000. Variables : voir `.env.example`.
- Vérifier : `npx tsc --noEmit` et `npm run lint`.
