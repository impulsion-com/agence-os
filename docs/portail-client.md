# Portail client

Le portail donne à chaque client un espace à ton nom (`/c/<ton-espace>`) où il suit l'avancement,
valide les créas et retrouve ses rapports. Un client n'est pas membre de ton espace : il a son propre
accès, limité à son entreprise, et ne voit que ce que tu choisis de partager.

Active le module dans Réglages > Modules > Portail client.

## Côté agence

### 1. Activer le portail d'un client

Fiche client > onglet Portail > Activer le portail.

- **Fonctionnalités ouvertes** : Performance, Projet et tâches, Créas à valider, Fichiers, Documents et
  signature, Onboarding, Rendez-vous. Une case est grisée quand le module correspondant est désactivé
  dans l'espace.
- **Message d'accueil** : affiché en haut du portail. Écris-le pour ton client.
- **Voir comme le client** : ouvre le portail dans un nouvel onglet, tel que le client le voit, sans te
  déconnecter. Les actions y sont désactivées.
- Désactiver le portail coupe l'accès sans rien supprimer : réglages et personnes sont conservés.

### 2. Inviter des personnes

Onglet Portail > Inviter. Choisis un contact du client ou saisis un email, puis ce que la personne peut
voir : tout ce que le portail ouvre, ou un sous-ensemble.

- Si l'envoi d'emails est configuré (`RESEND_API_KEY`, `EMAIL_FROM`), l'invitation part par email. Sinon,
  copie le lien et envoie-le toi-même.
- Le lien ne fonctionne qu'avec l'adresse invitée : la personne crée son compte avec cet email.
- Relancer renvoie l'email (ou copie le lien). Révoquer rend le lien inutilisable.
- Personnes ayant accès : tu modifies leurs fonctionnalités, tu vois leur dernière connexion et tu peux
  retirer l'accès. Le retrait révoque aussi leur invitation.

### 3. Choisir ce que le client voit

**Projets** : réglage « Portail client » dans la modale du projet, sur sa vue d'ensemble ou dans
l'onglet Portail du client.

| Mode | Ce que voit le client |
| --- | --- |
| Aucune tâche | Rien de ce projet, fichiers compris |
| Tâches cochées (par défaut) | Seulement les tâches marquées « Visible par le client » |
| Toutes les tâches | Tout le projet, sauf les commentaires internes |

**Tâches** : interrupteur « Visible par le client » dans le tiroir, ou action groupée « Client » sur
une sélection (clic droit aussi). Un œil signale les tâches visibles sur le tableau et les listes.

**Commentaires** : chaque commentaire est Interne (par défaut) ou Partagé avec le client. Le partage
n'est possible que si la tâche est visible. Un commentaire interne n'est jamais montré au client, même
dans un projet en « Toutes les tâches ». Les commentaires partagés portent la pastille « Visible
client » ; ceux écrits par un client portent la pastille « Client ». La visibilité d'un commentaire ne
se modifie pas après coup.

**Fichiers** : onglet Fichiers du projet, bascule « Partager avec le client » par fichier. Les fichiers
déposés par le client sont signalés.

**Créas** : sur la fiche d'un concept, carte « Validation client » > Envoyer en validation client. Le
client approuve ou demande des modifications avec un commentaire. Tu vois son retour et sa date, puis
tu renvoies après correction. La bibliothèque a un filtre « Validation client ».

**Rapports** : un rapport dont le partage est activé apparaît dans la partie Performance du portail.

### 4. Ce qui prévient le client

Une notification apparaît dans son portail, et un email part si l'envoi est configuré, quand :

| Événement | Notification | Email |
| --- | --- | --- |
| Une tâche visible passe en « Validation client » | oui | oui |
| Tu écris un commentaire partagé | oui | non |
| Tu envoies une créa en validation | oui | oui |
| Tu publies un rapport | oui | oui |
| Tu partages un fichier (regroupé par quart d'heure) | oui | non |

Seules les personnes qui ont la fonctionnalité concernée sont prévenues, et seulement si le portail est
activé.

### 5. Ce qui te revient

Dans ta boîte de réception (filtre « Clients ») :

- un client commente une tâche : l'assigné, le créateur et le responsable du projet sont prévenus ;
- un client valide une tâche ou demande une modification : la tâche passe en Terminé ou repart en
  En cours, avec son commentaire ;
- un client approuve une créa ou demande des modifications : le responsable du concept est prévenu ;
- un client dépose un fichier : le responsable du projet est prévenu.

La page Portail client (menu Commercial) résume tout : portails actifs, personnes, dernière connexion,
éléments en attente du client et modifications demandées.

## Côté client

### Accès

- Le lien `/invite/c/<token>` affiche une page aux couleurs de l'agence, puis l'inscription ou la
  connexion avec l'email de l'invitation (verrouillé). Une fois connecté, le client arrive sur
  `/c/<slug>`.
- Un compte connecté avec un autre email voit « Ce n'est pas le bon compte » et peut changer de compte.
  Un lien révoqué affiche « Ce lien n'est plus valide ».
- Un client rattaché à plusieurs entreprises du même espace change d'entreprise dans l'en-tête.

### Rubriques

| Onglet | Fonctionnalité | Module requis | Contenu |
| --- | --- | --- | --- |
| Accueil | toujours | aucun | mot de l'agence, à valider, nouveautés, résumé 30 jours, rendez-vous, onboarding |
| Performance | `reporting` | reporting | période, KPI et objectifs, graphique, campagnes, rapports publiés |
| Projet | `tasks` | projects | tâches partagées par statut, fiche, échanges, validation |
| Créas | `creatives` | creatives | créas soumises, approbation ou demande de modifications |
| Fichiers | `files` | projects | fichiers partagés, aperçu, téléchargement, dépôt |
| Documents | `documents`, `onboarding`, `booking` | proposals, onboarding, booking | propositions et PDF signé, formulaire d'accueil, rendez-vous |

Une fonctionnalité n'apparaît que si elle est ouverte sur le portail, ouverte pour la personne, et si le
module correspondant de l'espace est activé.

### Ce que le client peut faire

- Valider une tâche en « Validation client » (elle passe en « Terminé ») ou demander des modifications
  (elle repasse en « En cours », commentaire obligatoire).
- Répondre dans le fil partagé d'une tâche.
- Approuver une créa en attente ou demander des modifications (commentaire obligatoire).
- Déposer des fichiers (50 Mo par fichier) et retirer ceux qu'il a déposés.
- Modifier son nom, son mot de passe, le thème.

## Sécurité

### Principe

Un client n'est pas membre de l'espace : il vit dans `client_users`, rattaché à une entreprise. Aucune
policy RLS ne lui ouvre une table métier, donc toute table (y compris celles ajoutées plus tard) lui est
refusée par défaut. Il ne lit en direct que sa ligne `client_users`, son profil et ses notifications.
Tout le reste passe par des fonctions `portal_*` en `security definer`
(`supabase/migrations/0090_client_portal.sql` et `0091_portal_rpc.sql`), appelées avec sa session.

### Règles de chaque fonction `portal_*`

1. Elle commence par `perform portal_require(p_company, '<fonctionnalité>')`, puis
   `perform portal_module_require(p_company, '<fonctionnalité>')` (module de l'espace activé).
2. Elle ne reçoit que des identifiants et vérifie que chaque objet appartient à `p_company`.
   Objet d'une autre entreprise et objet inexistant donnent la même réponse.
3. Elle ne renvoie que des colonnes choisies : jamais de note interne, de retainer, de donnée CRM,
   d'email de l'équipe, de commentaire `internal`, de métrique ou de brief créateur.
   L'équipe apparaît par son prénom.
4. Elle est exécutable par `authenticated` seulement (`revoke … from anon, public`).
5. Une action d'écriture appelle `portal_require_write` : refusée à un membre en aperçu.

### Fichiers (Storage privé)

- Lecture : `GET /api/portal/file`. La route appelle la fonction de chemin avec la session de
  l'utilisateur ; le service role ne sert qu'ensuite, à signer une URL de 5 minutes (30 minutes pour une
  vidéo). Refus et fichier inexistant : 404.
- Dépôt : `POST /api/portal/upload` renvoie une URL signée d'envoi, le navigateur envoie le fichier au
  Storage, puis `PUT` confirme. `portal_file_add` n'accepte qu'un chemin
  `<workspace>/<projet>/portal/<uuid>-<nom>` et lit la taille réelle dans le Storage : impossible de
  faire pointer une pièce vers un fichier interne.

### Vérifier

```bash
node --env-file=.env.local scripts/test-portal-security.mjs   # étanchéité des tables et des droits
node --env-file=.env.local scripts/test-portal-rpc.mjs        # fonctions portal_* et routes (app lancée)
node --env-file=.env.local scripts/test-portal-agency.mjs     # notifications côté agence
```

À lancer un par un, sur un espace de démo : un rechargement des données de démo pendant un test fausse
ses résultats. Le second vérifie aussi, avec `SUPABASE_ACCESS_TOKEN`, qu'aucune fonction
`security definer` de la base n'a échappé à l'audit.

### Ajouter une fonction au portail

1. L'écrire dans une migration en respectant les cinq règles ci-dessus.
2. L'ajouter à `CALLS` et à `REVIEWED` dans `scripts/test-portal-rpc.mjs`.
3. Relancer les scripts.

## Limites connues

- Les emails vers le client demandent Resend ; sans configuration, il n'y a que les notifications du
  portail et les liens à copier.
- Passer un projet en « Toutes les tâches » ne notifie pas pour les tâches déjà en validation.
- Une tâche récurrente validée par le client ne crée pas l'occurrence suivante.
- Pas de limitation de débit sur les commentaires du client ; 500 dépôts au plus par projet.
