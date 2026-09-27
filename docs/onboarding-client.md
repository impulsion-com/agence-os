# Onboarding client par formulaire

Envoie à chaque nouveau client un formulaire qu'il remplit à son rythme : son activité, ses cibles, ses concurrents, ses objectifs (CPA, ROAS), son budget, ses créations, ses contraintes légales et surtout les accès à ses comptes publicitaires. Tu es prévenu quand c'est terminé, et le projet d'onboarding se prépare tout seul.

## 1. Régler une fois pour toutes

Onboarding clients > Réglages :

- **ID du Business Manager Meta de l'agence** : Paramètres de l'entreprise > Informations sur l'entreprise.
- **Compte administrateur Google Ads (MCC)** : le numéro affiché en haut à droite de ton compte administrateur.
- **Email à inviter** sur GA4, GTM, Search Console, Shopify (idéalement une adresse partagée de l'agence). Vide : l'email de la personne qui envoie.
- Le message d'accueil par défaut et les automatisations activées par défaut.

Ces valeurs remplacent les variables `{meta_bm_id}`, `{google_mcc_id}`, `{email_acces}` et `{agence}` des tutoriels. Le client les voit avec un bouton « Copier ». Tant qu'une valeur manque, il voit « information communiquée par l'agence ».

## 2. Choisir ou adapter un modèle

Trois modèles sont fournis : **e-commerce**, **génération de leads**, **local / prise de RDV**. Onglet Modèles :

- Modifier : étapes, questions (texte court ou long, choix unique ou multiple, nombre avec unité, lien, date, email, téléphone, fichiers, checklist d'accès), caractère obligatoire, aide.
- « Relier la réponse à » : site web ou secteur de la fiche client, KPI cible CPA ou ROAS.
- Checklist d'accès : pour chaque outil, un lien à ouvrir, un identifiant à demander et les étapes du tutoriel, une par ligne.
- « Aperçu client » montre exactement ce que verra le client.
- Les formulaires déjà envoyés gardent leurs questions : tes modifications valent pour les prochains envois.
- « Restaurer les modèles par défaut » recrée les trois modèles fournis s'ils ont été archivés.

## 3. Envoyer

« Envoyer un formulaire » (depuis Onboarding clients ou la fiche d'un client) : choisis le client, le contact et le modèle (suggéré selon le secteur), un message d'accueil et les automatisations.

- Si l'envoi d'emails est configuré (`RESEND_API_KEY` + `EMAIL_FROM`) et que le contact a un email, il reçoit le lien.
- Sinon tu obtiens un lien `/f/…` à copier (email, WhatsApp, Slack…).

## 4. Côté client

Une étape par écran, pensé pour le mobile, avec une barre de progression. Les réponses sont **enregistrées automatiquement** : il peut revenir plus tard avec le même lien et reprend où il s'était arrêté. Il dépose ses fichiers (logo, charte, créas existantes, 50 Mo maximum par fichier) et coche « C'est fait » pour chaque accès, ou signale qu'il ne peut pas le faire pour l'instant. Les champs obligatoires sont vérifiés avant l'envoi, puis un écran de remerciement s'affiche.

## 5. Suivre

La liste affiche le statut (Envoyé, En cours X %, Terminé), les accès donnés ou vérifiés et la dernière activité. Tu peux relancer (email ou lien copié, le nombre de relances est compté).

La page d'un formulaire montre les réponses lisibles et imprimables, les fichiers à ouvrir ou télécharger, et la checklist des accès. Coche « Vérifié » quand tu as testé un accès.

## 6. Automatisations à la fin

Si elles sont activées pour l'envoi :

- **Projet** : si le client n'a aucun projet actif, un projet « <Client> · Onboarding » est créé à partir du modèle « Onboarding client ». Puis une tâche « Vérifier l'accès : X » est ajoutée par accès non vérifié, en priorité haute si le client ne l'a pas confirmé.
- **KPI** : le CPA et le ROAS cibles sont enregistrés dans le reporting du client.
- **Fiche client** : le site web et le secteur sont complétés s'ils sont vides.
- **Notification** dans la boîte de réception (et par email si configuré) pour la personne qui a envoyé le formulaire et le responsable du client.

« Relancer les automatisations » sur la page du formulaire rejoue le tout sans créer de doublons.

## Technique

- Tables `onboarding_settings`, `onboarding_templates`, `onboarding_forms`, `onboarding_files` (migration `0071_onboarding.sql`).
- La page publique passe uniquement par les routes `/api/onboarding/<token>/save|upload|files|submit`, en service role, avec le jeton du lien.
- Fichiers dans le bucket privé `attachments`, chemin `<workspace_id>/onboarding/<form_id>/…`.
- Limites : si deux onglets sont ouverts sur le même formulaire, la dernière sauvegarde l'emporte ; les routes publiques ne sont protégées que par le jeton de 32 caractères.
