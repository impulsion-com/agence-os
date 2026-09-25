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
- `ad_connections` (jetons OAuth) n'a aucune policy : lecture/écriture uniquement via le
  service role. La vue `ad_connections_public` expose les colonnes sans secret.
- Pages publiques via RPC `security definer` : `public_proposal`, `respond_proposal`, `public_report`.
- Données de démo : chargées et supprimées par `POST /api/demo` (`src/lib/demo.ts`), qui enchaîne
  `load_demo_data` (droits de l'utilisateur), puis `_demo_links` et `demo_tracking_seed` en service role
  (le seed du tracking dépasse le délai de 8 s des requêtes `authenticated`).
- Tracking : `tracking_sites.secret_key` n'est pas lisible directement (privilège par colonne) ;
  passer par la RPC `tracking_site_secret`. Tests du moteur :
  `node --experimental-strip-types --test src/lib/tracking/tests/tracking.test.mjs`.

## Développement

- `npm run dev` puis http://localhost:3000. Variables : voir `.env.example`.
- Vérifier : `npx tsc --noEmit` et `npm run lint`.
