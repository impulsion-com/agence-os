# Installer Agence OS

Compte 30 à 45 minutes, dont l'essentiel se fait par Claude. Tu as besoin de trois choses :
une base Supabase (gratuite), un hébergement Node.js et un nom de domaine (ou sous-domaine).

## 0. Choisir ton édition

Un seul code, trois portes d'entrée. L'édition fixe les modules proposés à la création de
l'espace, le nom affiché et les réglages demandés par la page Installation. Les autres modules
restent activables à tout moment dans **Réglages > Modules** : passer d'une édition à l'autre
ne demande ni migration ni nouvelle base, tes données sont déjà au même endroit.

| Édition | `NEXT_PUBLIC_EDITION` | Modules | Connexions à prévoir |
| --- | --- | --- | --- |
| **Agence OS Tracking** (conseillée pour commencer) | `tracking` | Reporting, Attribution, Créas, Liens trackés | Meta, Google, tâches planifiées ; Anthropic en option |
| Agence OS Freelance | `freelance` | CRM, Propositions, Rendez-vous, Onboarding, Portail client | Resend (emails), Google Agenda en option |
| Agence OS Projet | `projet` | Gestion de projet, Portail client | Aucune |
| Agence OS (complète) | vide ou `complete` | Tout | Toutes |

## 1. Choisir ton hébergement

| Hébergement | Coût | À savoir |
| --- | --- | --- |
| **Hostinger, hébergement web avec Node.js** (offres Business et Cloud) | inclus dans l'offre | Le plus simple si tu y as déjà ton site. Build et variables d'environnement dans hPanel. |
| **VPS** (Hostinger, OVH…) | dès 5 € / mois | `npm ci && npm run build && npm start` derrière un proxy (Caddy, Nginx, Traefik), relancé par systemd ou pm2. |
| **Vercel** | 20 $ / mois (offre Pro) | L'offre gratuite Hobby est **réservée à un usage personnel non commercial** : une agence doit prendre l'offre Pro. |

Les tâches planifiées (synchro quotidienne, veille créa, rappels de rendez-vous) sont
programmées **dans Supabase** depuis la page Installation : elles marchent pareil chez tous les
hébergeurs.

## 2. Supabase (gratuit)

L'app repose sur Supabase pour la base, les comptes, les fichiers et les règles d'accès : il est
indispensable, même si tu as un VPS. L'offre gratuite suffit pour démarrer : 500 Mo de base,
1 Go de fichiers, deux projets. Un projet gratuit se met en pause après une semaine sans
activité ; le trafic du script de tracking et la synchro quotidienne le gardent éveillé. Le poste
qui grossit le plus est le tracking (la démo seule pèse environ 80 Mo) : passe à l'offre Pro
(25 $ / mois) quand le tableau de bord Supabase approche de la limite.

**Ne donne pas ton jeton d'accès personnel (« personal access token ») à Claude** : il ouvre
tous les projets de ton compte. Utilise le serveur MCP officiel de Supabase, qui se connecte par
ton navigateur (OAuth) et se limite à un seul projet.

## 3. Installer avec Claude Code (recommandé)

1. Crée une copie du dépôt sur ton compte GitHub (**Use this template**), clone-la et ouvre
   Claude Code dans le dossier.
2. Branche le MCP Supabase, sans jeton à copier :

   ```bash
   claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp"
   ```

   Puis, dans un terminal (pas l'extension de l'éditeur) : `claude`, `/mcp`, choisis
   **supabase** et **Authenticate**. Il te demande d'autoriser ton organisation Supabase.
3. Colle ce prompt dans Claude Code, en remplaçant les valeurs entre crochets :

   ```text
   Installe Agence OS pour mon agence [nom de l'agence], édition [tracking | freelance | projet | complete].
   Adresse finale de l'app : [https://os.mon-agence.fr]. Hébergement : [Hostinger | VPS | Vercel Pro].

   1. Avec le MCP Supabase, crée un projet « agence-os » en région Paris (eu-west-3), offre gratuite.
      Montre-moi le coût avant de confirmer. Exécute ensuite supabase/setup.sql en entier, puis
      vérifie que public.schema_version() répond.
   2. Dans Authentication > URL Configuration du projet : Site URL = l'adresse finale,
      Redirect URLs = l'adresse finale suivie de /**.
   3. Prépare les variables d'environnement à partir de .env.example : NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (récupère-les par le MCP),
      NEXT_PUBLIC_APP_URL = l'adresse finale, NEXT_PUBLIC_EDITION = l'édition, CRON_SECRET =
      une chaîne aléatoire de 40 caractères. Ne les écris dans aucun fichier suivi par git.
   4. Déploie l'app sur mon hébergement avec ces variables (pour Hostinger, utilise le MCP
      Hostinger s'il est branché ; sinon guide-moi écran par écran), et fais pointer le domaine.
   5. Quand l'app répond, dis-moi de créer mon compte et mon espace, puis d'ouvrir
      Réglages > Installation pour la suite.
   6. Enfin, restreins le MCP Supabase à ce seul projet en lecture seule :
      claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true"
   ```

4. Dans l'app : crée ton compte, puis ton espace. La case **Charger des données d'exemple**
   remplit l'espace pour voir tout de suite à quoi ça ressemble (supprimables dans
   **Réglages > Espace de travail**).
5. Ouvre **Réglages > Installation**. Chaque réglage restant (tâches planifiées, Meta, Google,
   emails…) y a son prompt pour **Claude in Chrome**, qui fait les manipulations dans ton
   navigateur à ta place, et un bouton **Tester** qui vérifie le résultat pour de vrai.

## 4. Installer à la main

1. **Supabase** : sur [supabase.com](https://supabase.com), **New project** (région Paris,
   `eu-west-3`). Dans **SQL Editor**, colle et exécute tout `supabase/setup.sql`. Dans
   **Authentication > URL Configuration**, mets l'adresse de l'app en Site URL et
   `<adresse>/**` en Redirect URLs. Dans **Project Settings > API**, récupère l'URL, la clé
   `anon` et la clé `service_role` (secrète).
2. **Hébergement** : crée une copie du dépôt sur ton GitHub, branche-la sur ton hébergement
   (build `npm run build`, démarrage `npm start`, Node 20 ou plus) et ajoute les variables :

   | Variable | Valeur |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé `anon` |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` |
   | `NEXT_PUBLIC_APP_URL` | l'adresse finale de l'app, sans `/` à la fin |
   | `NEXT_PUBLIC_EDITION` | `tracking`, `freelance`, `projet` ou vide |
   | `CRON_SECRET` | une longue chaîne aléatoire (`openssl rand -hex 32`) |

3. Ouvre l'app, crée ton compte et ton espace, puis termine dans **Réglages > Installation**.

### Emails de connexion

Supabase envoie les emails de confirmation et de mot de passe oublié, mais son service
intégré est limité à quelques emails par heure. Pour un usage réel, branche ton propre SMTP
(Resend, Brevo, Postmark…) dans **Authentication > Emails > SMTP Settings**. La page
Installation donne le prompt pour le faire avec Resend.

## 5. Inviter ton équipe

**Nouveau > Inviter un membre** crée un lien d'invitation par adresse email. Envoie-le à la
personne : elle crée son compte avec cette adresse et rejoint l'espace en ouvrant le lien.

Rôles :

- **Propriétaire** : tous les droits, dont la suppression de l'espace ;
- **Admin** : membres, réglages, connexions publicitaires, page Installation ;
- **Membre** : crée et modifie projets, tâches, deals, propositions, rapports ;
- **Invité** : lecture seule (pratique pour un freelance ou un client).

## 6. Travailler en local (pour modifier le code)

```bash
git clone <ton-depot> && cd agence-os
cp .env.example .env.local   # puis remplis les valeurs
npm install
npm run dev                  # http://localhost:3000
```

Après une modification du schéma (nouveau fichier dans `supabase/migrations/`), régénère
les types TypeScript :

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
```

## Mettre à jour

Récupère les changements du dépôt d'origine (**Sync fork** sur GitHub), redéploie, puis ouvre
**Réglages > Installation** : l'étape « Base de données à jour » indique si des migrations sont à
exécuter et donne le prompt pour que Claude Code les applique dans l'ordre. À la main : exécute
dans le SQL Editor les fichiers de `supabase/migrations/` que tu n'as pas encore appliqués,
dans l'ordre de leur numéro.
