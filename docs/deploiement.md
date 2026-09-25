# Installer Agence OS pour ton agence

Compte 20 à 30 minutes. Tu n'as besoin d'aucun serveur : Supabase (base de données et
comptes utilisateurs) et Vercel (hébergement) ont tous les deux une offre gratuite qui
suffit pour une agence de quelques personnes.

## 1. Créer la base Supabase

1. Crée un compte sur [supabase.com](https://supabase.com), puis **New project**.
   Choisis une région en Europe (Paris : `eu-west-3`) et note le mot de passe de la base.
2. Dans le projet, ouvre **SQL Editor**, puis colle et exécute le contenu de
   `supabase/setup.sql` (tout le schéma en un seul fichier). Il crée les tables, les
   règles d'accès (RLS), le stockage des fichiers et les données de démonstration.

   Variante en ligne de commande, si tu préfères :

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-du-projet>
   npx supabase db push
   ```

3. Dans **Authentication > URL Configuration** :
   - **Site URL** : l'adresse de ton application (par exemple `https://agence.vercel.app`) ;
   - **Redirect URLs** : ajoute `https://agence.vercel.app/**` (et `http://localhost:3000/**`
     si tu travailles en local).
4. Dans **Project Settings > API**, récupère l'URL du projet, la clé `anon` et la clé
   `service_role` (cette dernière est secrète, ne la mets jamais dans le code).

### Emails de connexion

Supabase envoie les emails de confirmation et de mot de passe oublié, mais son service
intégré est limité à quelques emails par heure. Pour une utilisation réelle, branche ton
propre SMTP dans **Authentication > Emails > SMTP Settings** (Resend, Brevo, Postmark…).

## 2. Déployer sur Vercel

1. Crée une copie du dépôt sur ton compte GitHub (**Use this template** ou **Fork**).
2. Sur [vercel.com](https://vercel.com), **Add New > Project**, importe ce dépôt.
3. Ajoute les variables d'environnement (voir `.env.example`) :

   | Variable | Valeur |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé `anon` |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` |
   | `NEXT_PUBLIC_APP_URL` | l'adresse finale de l'app, sans `/` à la fin |
   | `CRON_SECRET` | une longue chaîne aléatoire (`openssl rand -hex 32`) |

   Les variables Meta et Google Ads sont facultatives au départ : voir
   [le guide du reporting](./reporting.md).
4. **Deploy**. Ouvre l'adresse, crée ton compte puis ton espace agence. La case « Charger
   des données d'exemple » remplit l'espace pour que tu voies tout de suite à quoi ça
   ressemble ; tu pourras les supprimer dans **Réglages > Espace de travail**.

## 3. Inviter ton équipe

**Nouveau > Inviter un membre** crée un lien d'invitation par adresse email. Envoie-le à la
personne : elle crée son compte avec cette adresse et rejoint l'espace en ouvrant le lien.

Rôles :

- **Propriétaire** : tous les droits, dont la suppression de l'espace ;
- **Admin** : membres, réglages, connexions publicitaires ;
- **Membre** : crée et modifie projets, tâches, deals, propositions, rapports ;
- **Invité** : lecture seule (pratique pour un freelance ou un client).

## 4. Travailler en local (pour modifier le code)

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

Quand une nouvelle version sort, récupère les changements du dépôt d'origine puis
exécute dans le SQL Editor les nouveaux fichiers de `supabase/migrations/` (ceux que tu
n'as pas encore appliqués, dans l'ordre de leur numéro).
