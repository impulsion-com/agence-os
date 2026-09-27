-- =====================================================================
-- Onboarding client par formulaire
-- 1. Réglages d'onboarding par espace (identifiants de l'agence affichés
--    au client : Business Manager Meta, compte administrateur Google Ads,
--    email à inviter ; automatisations par défaut)
-- 2. Modèles de formulaire (sections et questions en jsonb), trois modèles
--    fournis par défaut pour les espaces existants et futurs
-- 3. Formulaires envoyés : copie figée du modèle, réponses, progression,
--    lien public /f/<token>, vérification des accès par l'agence
-- 4. Fichiers déposés par le client (bucket privé « attachments »,
--    chemin <workspace_id>/onboarding/<form_id>/...)
-- 5. Nouveau type de notification « onboarding » (ajouté à la liste
--    existante, quelle qu'elle soit)
-- 6. Données de démo : load_demo_onboarding / clear_demo_onboarding
--    (admins) et _demo_onboarding / _clear_demo_onboarding (service role)
-- La page publique passe exclusivement par les routes /api/onboarding/*
-- en service role : aucune policy ne vise le rôle anon.
-- Migration additive : aucune table existante modifiée (hors contrainte
-- de type des notifications, élargie).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Réglages
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  meta_business_id text not null default '',
  google_mcc_id text not null default '',
  access_email text not null default '',
  intro text not null default '',
  auto_project boolean not null default true,
  auto_kpis boolean not null default true,
  auto_company boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Modèles
-- sections : [{ id, title, description, questions: [{ id, type, label, help,
--   required, placeholder, options, unit, map, accept, items }] }]
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text,
  name text not null,
  description text not null default '',
  icon text not null default 'list-checks',
  sections jsonb not null default '[]'::jsonb,
  position int not null default 0,
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_templates_ws on public.onboarding_templates (workspace_id);
create unique index if not exists onboarding_templates_key on public.onboarding_templates (workspace_id, key) where key is not null;

-- ---------------------------------------------------------------------
-- 3. Formulaires envoyés
-- answers  : { <question_id>: texte | [choix] | { <item_id>: { done, value } } }
-- verified : { "<question_id>:<item_id>": { at, by } } (accès vérifiés par l'agence)
-- options  : { project, kpis, company } automatisations à la fin
-- automation : compte rendu des automatisations exécutées
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid references public.onboarding_templates(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  intro text not null default '',
  sections jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  verified jsonb not null default '{}'::jsonb,
  status text not null default 'sent' check (status in ('sent','in_progress','completed')),
  progress int not null default 0 check (progress between 0 and 100),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  options jsonb not null default '{"project": true, "kpis": true, "company": true}'::jsonb,
  automation jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  email_sent_at timestamptz,
  opened_at timestamptz,
  last_activity_at timestamptz,
  completed_at timestamptz,
  reminded_at timestamptz,
  remind_count int not null default 0,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_forms_ws on public.onboarding_forms (workspace_id, created_at desc);
create index if not exists onboarding_forms_company on public.onboarding_forms (company_id);

-- ---------------------------------------------------------------------
-- 4. Fichiers
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.onboarding_forms(id) on delete cascade,
  question_id text not null,
  name text not null,
  path text not null unique,
  size bigint not null default 0,
  mime text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists onboarding_files_form on public.onboarding_files (form_id);

-- updated_at
create or replace function public.touch_onboarding()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists onboarding_templates_touch on public.onboarding_templates;
create trigger onboarding_templates_touch before update on public.onboarding_templates
  for each row execute function public.touch_onboarding();
drop trigger if exists onboarding_forms_touch on public.onboarding_forms;
create trigger onboarding_forms_touch before update on public.onboarding_forms
  for each row execute function public.touch_onboarding();
drop trigger if exists onboarding_settings_touch on public.onboarding_settings;
create trigger onboarding_settings_touch before update on public.onboarding_settings
  for each row execute function public.touch_onboarding();

-- RLS : lecture pour tout membre, écriture pour les non-invités
alter table public.onboarding_settings enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.onboarding_forms enable row level security;
alter table public.onboarding_files enable row level security;

do $$
declare t text;
begin
  foreach t in array array['onboarding_settings','onboarding_templates','onboarding_forms','onboarding_files'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "ajout membres" on public.%I', t);
    execute format('drop policy if exists "modif membres" on public.%I', t);
    execute format('drop policy if exists "suppression membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "ajout membres" on public.%I for insert with check (public.can_write(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Type de notification « onboarding » : on relit la contrainte
--    actuelle et on y ajoute la valeur, pour ne pas écraser les types
--    ajoutés par d'autres migrations.
-- ---------------------------------------------------------------------
do $$
declare def text; kinds text[];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if def is not null and def !~ '\monboarding\M' then
    select array_agg(m[1]) into kinds from regexp_matches(def, '''([a-z_]+)''', 'g') as m;
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || (select string_agg(quote_literal(k), ', ') from unnest(kinds || 'onboarding'::text) k) || ']))';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2 bis. Modèles par défaut
-- ---------------------------------------------------------------------
create or replace function public.onboarding_default_templates()
returns table (key text, name text, description text, icon text, sections jsonb, "position" int)
language sql immutable set search_path = public as $$
  values
    ('ecommerce', 'Onboarding e-commerce',
      'Boutique en ligne : produits, panier moyen, ROAS cible, catalogue et accès Meta, Google, Shopify.',
      'shopping-bag', $j$[{"id":"company","title":"Votre entreprise et votre offre","description":"Quelques informations pour bien comprendre votre marque et ce que vous vendez.","questions":[{"id":"brand_name","type":"short","label":"Nom commercial de la marque","required":true},{"id":"website","type":"url","label":"Adresse de votre boutique en ligne","required":true,"placeholder":"https://","map":"company.website"},{"id":"industry","type":"single","label":"Secteur d'activité","required":true,"options":["E-commerce","SaaS","Formation","Immobilier","Santé","Restauration","Services B2B","Local","Autre"],"map":"company.industry"},{"id":"pitch","type":"long","label":"Présentez votre activité en quelques phrases","required":true,"placeholder":"Ce que vous vendez, à qui, depuis quand..."},{"id":"hero_products","type":"long","label":"Vos produits phares et leur prix","required":true,"placeholder":"Un produit par ligne"},{"id":"aov","type":"number","label":"Panier moyen","unit":"€"},{"id":"margin","type":"number","label":"Marge brute moyenne","unit":"%"},{"id":"usp","type":"long","label":"Qu'est-ce qui vous différencie de vos concurrents ?"},{"id":"promos","type":"long","label":"Offres, lancements ou promotions prévus dans les 3 prochains mois"}]},{"id":"personas","title":"Vos clients et personas","description":"Plus nous connaissons vos clients, plus vos publicités leur parleront.","questions":[{"id":"ideal_customer","type":"long","label":"Qui est votre client idéal ?","required":true,"placeholder":"Âge, situation, centres d'intérêt, ce qui le décide à acheter..."},{"id":"markets","type":"multi","label":"Pays où vous livrez","required":true,"options":["France","Belgique","Suisse","Canada","Reste de l'Europe","International"]},{"id":"pains","type":"long","label":"Quels problèmes ou envies votre produit résout-il ?"},{"id":"objections","type":"long","label":"Les freins les plus fréquents avant l'achat","placeholder":"Prix, délais de livraison, doute sur la qualité..."},{"id":"repeat","type":"number","label":"Part de clients qui rachètent","unit":"%"}]},{"id":"competitors","title":"Concurrents","description":"Nous analyserons leurs publicités actives dans les bibliothèques publicitaires.","questions":[{"id":"competitors","type":"long","label":"Vos 3 principaux concurrents","required":true,"placeholder":"Nom ou site, un par ligne"},{"id":"admired","type":"short","label":"Une marque dont vous admirez la publicité"}]},{"id":"goals","title":"Objectifs et KPI","description":"Ces chiffres servent de référence à nos rapports mensuels.","questions":[{"id":"main_goal","type":"single","label":"Votre objectif principal","required":true,"options":["Augmenter les ventes en ligne","Rentabiliser les campagnes existantes","Lancer un nouveau produit","Conquérir un nouveau pays","Développer la notoriété"]},{"id":"roas_target","type":"number","label":"ROAS cible","unit":"x","map":"kpi.roas","help":"Chiffre d'affaires généré pour 1 € de publicité. 3 signifie 3 € de ventes pour 1 € dépensé."},{"id":"cpa_target","type":"number","label":"Coût par achat maximum acceptable","unit":"€","map":"kpi.cpa"},{"id":"revenue","type":"number","label":"Chiffre d'affaires mensuel en ligne actuel","unit":"€"},{"id":"start_date","type":"date","label":"Date de lancement souhaitée"}]},{"id":"budget","title":"Budget","description":"Le budget publicitaire est payé directement aux plateformes, en dehors de nos honoraires.","questions":[{"id":"budget","type":"single","label":"Budget publicitaire mensuel prévu","required":true,"options":["Moins de 1 000 €","1 000 à 3 000 €","3 000 à 10 000 €","10 000 à 30 000 €","Plus de 30 000 €"]},{"id":"platforms","type":"multi","label":"Plateformes envisagées","options":["Meta (Facebook, Instagram)","Google Ads","TikTok","Pinterest","Je ne sais pas encore"]},{"id":"seasonality","type":"long","label":"Saisonnalité et temps forts de l'année","placeholder":"Black Friday, Noël, soldes, fête des mères..."}]},{"id":"history","title":"Historique publicitaire","description":"Pour repartir de ce qui a déjà été appris, plutôt que de zéro.","questions":[{"id":"ads_before","type":"single","label":"Avez-vous déjà fait de la publicité en ligne ?","required":true,"options":["Oui, en interne","Oui, avec une agence ou un freelance","Non, jamais"]},{"id":"learnings","type":"long","label":"Ce qui a fonctionné, ou pas, jusqu'ici"},{"id":"past_spend","type":"number","label":"Dépense publicitaire mensuelle moyenne ces 3 derniers mois","unit":"€"}]},{"id":"brand","title":"Marque et créations","description":"Tout ce qui nous aide à produire des publicités fidèles à votre marque.","questions":[{"id":"logo","type":"file","label":"Votre logo","required":true,"accept":"images","help":"Idéalement en SVG ou en PNG haute définition sur fond transparent."},{"id":"charter","type":"file","label":"Charte graphique (couleurs, typographies)","accept":"docs"},{"id":"creatives","type":"file","label":"Créations publicitaires existantes","accept":"any","help":"Visuels, vidéos, publicités qui ont bien fonctionné. Jusqu'à 50 Mo par fichier."},{"id":"assets_link","type":"url","label":"Lien vers un dossier partagé (photos, vidéos)","placeholder":"https://drive.google.com/..."},{"id":"tone","type":"multi","label":"Le ton de votre marque","options":["Premium","Chaleureux","Expert","Décalé","Engagé","Minimaliste","Pédagogue"]},{"id":"never","type":"long","label":"Ce qu'il ne faut jamais dire ou montrer","placeholder":"Mots, images, sujets, concurrents à ne pas citer..."}]},{"id":"legal","title":"Contraintes légales","description":"Pour ne jamais diffuser une publicité refusée ou non conforme.","questions":[{"id":"legal_regulated","type":"single","label":"Votre secteur est-il soumis à une réglementation publicitaire particulière ?","required":true,"options":["Non","Oui (santé, alcool, finance, compléments alimentaires...)","Je ne sais pas"]},{"id":"legal_mentions","type":"long","label":"Mentions obligatoires ou allégations interdites","placeholder":"Ex. : « Sous réserve d'acceptation du dossier », pas de promesse de résultat..."},{"id":"legal_validator","type":"short","label":"Qui valide les publicités avant leur diffusion ?","placeholder":"Prénom, nom et email"}]},{"id":"access","title":"Accès aux outils","description":"Nous travaillons dans vos comptes, qui restent votre propriété : vous pouvez retirer nos accès à tout moment.","questions":[{"id":"access","type":"access","label":"Donnez-nous accès à vos comptes","required":true,"help":"Suivez les étapes de chaque outil, puis cochez « C'est fait ». Vous n'avez aucun mot de passe à nous transmettre.","items":[{"id":"meta_bm","name":"Business Manager Meta","platform":"meta_bm","link":"https://business.facebook.com/settings","idLabel":"ID de votre Business Manager","steps":["Ouvrez business.facebook.com/settings avec le compte administrateur de votre entreprise.","Copiez l'identifiant affiché sous le nom de votre entreprise (Informations sur l'entreprise) et collez-le ci-dessous.","Allez dans Utilisateurs > Partenaires, cliquez sur Ajouter puis « Donner à un partenaire l'accès à vos ressources ».","Saisissez l'ID de partenaire de {agence} : {meta_bm_id}, puis validez."]},{"id":"meta_ads","name":"Compte publicitaire, page et pixel Meta","platform":"meta_ads","link":"https://business.facebook.com/settings/ad-accounts","idLabel":"ID du compte publicitaire (act_...)","steps":["Dans les paramètres du Business Manager, ouvrez Comptes > Comptes publicitaires.","Sélectionnez votre compte publicitaire et copiez son identifiant.","Cliquez sur Attribuer des partenaires, saisissez l'ID {meta_bm_id} et cochez « Gérer les campagnes ».","Faites de même pour votre page Facebook, votre compte Instagram et votre pixel (Sources de données > Ensembles de données)."]},{"id":"google_ads","name":"Google Ads","platform":"google_ads","link":"https://ads.google.com","idLabel":"Numéro client Google Ads (123-456-7890)","steps":["Connectez-vous à ads.google.com : votre numéro client s'affiche en haut à droite (format 123-456-7890).","Collez-le ci-dessous : {agence} vous enverra une demande d'association depuis son compte administrateur {google_mcc_id}.","Dans Google Ads, ouvrez Administration > Accès et sécurité > Gestionnaires, puis acceptez la demande de {agence}."]},{"id":"ga4","name":"Google Analytics 4","platform":"ga4","link":"https://analytics.google.com","idLabel":"ID de la propriété GA4 (facultatif)","steps":["Ouvrez analytics.google.com, puis Administration (roue crantée en bas à gauche).","Dans la colonne Propriété, cliquez sur Gestion des accès à la propriété.","Cliquez sur +, puis Ajouter des utilisateurs, et saisissez {email_acces}.","Choisissez le rôle Éditeur et cliquez sur Ajouter."]},{"id":"gtm","name":"Google Tag Manager","platform":"gtm","link":"https://tagmanager.google.com","idLabel":"ID du conteneur (GTM-XXXXXXX)","steps":["Ouvrez tagmanager.google.com et sélectionnez le conteneur de votre site.","Cliquez sur Administration, puis Gestion des utilisateurs dans la colonne Conteneur.","Ajoutez {email_acces} avec l'autorisation Publier, puis envoyez l'invitation.","Pas encore de conteneur ? Cochez simplement la case : nous le créerons avec vous."]},{"id":"shopify","name":"Shopify (ou votre CMS)","platform":"cms","link":"https://admin.shopify.com","idLabel":"Adresse de votre boutique (xxx.myshopify.com)","steps":["Dans l'administration Shopify, ouvrez Paramètres > Utilisateurs et autorisations.","Cliquez sur Ajouter du personnel et saisissez {email_acces}.","Cochez Commandes, Produits, Canaux de vente et Événements clients (pixels), puis envoyez l'invitation.","Sur WooCommerce, PrestaShop ou un autre CMS : créez un compte Gestionnaire pour {email_acces}."]},{"id":"search_console","name":"Google Search Console","platform":"search_console","link":"https://search.google.com/search-console","steps":["Ouvrez search.google.com/search-console et sélectionnez votre site.","Allez dans Paramètres > Utilisateurs et autorisations.","Cliquez sur Ajouter un utilisateur, saisissez {email_acces} avec l'autorisation Complète."]}]},{"id":"access_notes","type":"long","label":"Un accès pose problème ? Dites-le nous ici","placeholder":"Ex. : le Business Manager appartient à notre ancien prestataire..."}]}]$j$::jsonb, 0),
    ('leads', 'Onboarding génération de leads',
      'Services et B2B : définition du lead qualifié, coût par lead cible, suivi commercial, accès Meta, Google et CRM.',
      'target', $j$[{"id":"company","title":"Votre entreprise et votre offre","description":"Quelques informations pour bien comprendre votre activité.","questions":[{"id":"brand_name","type":"short","label":"Nom de l'entreprise","required":true},{"id":"website","type":"url","label":"Site web","required":true,"placeholder":"https://","map":"company.website"},{"id":"industry","type":"single","label":"Secteur d'activité","required":true,"options":["E-commerce","SaaS","Formation","Immobilier","Santé","Restauration","Services B2B","Local","Autre"],"map":"company.industry"},{"id":"pitch","type":"long","label":"Présentez votre activité en quelques phrases","required":true},{"id":"offer","type":"long","label":"L'offre à promouvoir en priorité et son prix","required":true,"placeholder":"Prestation, formation, abonnement..."},{"id":"customer_value","type":"number","label":"Valeur moyenne d'un client signé","unit":"€","help":"Sur la première vente ou sur toute la durée de la relation, précisez-le dans les notes si besoin."},{"id":"usp","type":"long","label":"Pourquoi vos clients vous choisissent plutôt qu'un concurrent ?"}]},{"id":"personas","title":"Vos cibles et personas","description":"À qui s'adressent les campagnes.","questions":[{"id":"ideal_customer","type":"long","label":"Décrivez votre client idéal","required":true,"placeholder":"Particulier ou entreprise, fonction, taille, situation..."},{"id":"area","type":"short","label":"Zone géographique ciblée","required":true,"placeholder":"France entière, Île-de-France, Lyon + 50 km..."},{"id":"pains","type":"long","label":"Quels problèmes votre offre résout-elle ?"},{"id":"objections","type":"long","label":"Les objections les plus fréquentes en rendez-vous"}]},{"id":"funnel","title":"Qualification et suivi des leads","description":"Un lead n'a de valeur que s'il est rappelé vite et bien.","questions":[{"id":"qualified","type":"long","label":"Qu'est-ce qu'un lead qualifié pour vous ?","required":true,"placeholder":"Budget, besoin, délai, zone, statut..."},{"id":"followup","type":"single","label":"Délai de rappel d'un nouveau lead","required":true,"options":["Moins d'une heure","Dans la journée","Sous 48 h","Plus de 48 h"]},{"id":"followup_who","type":"short","label":"Qui rappelle les leads ?","placeholder":"Prénom, rôle"},{"id":"close_rate","type":"number","label":"Taux de transformation lead vers client","unit":"%"},{"id":"lead_form","type":"single","label":"Où arrivent les demandes aujourd'hui ?","options":["Formulaire du site","Appels téléphoniques","Prise de rendez-vous en ligne","Messages (WhatsApp, Messenger)","Plusieurs canaux"]}]},{"id":"competitors","title":"Concurrents","description":"Nous analyserons leurs publicités et leurs pages.","questions":[{"id":"competitors","type":"long","label":"Vos 3 principaux concurrents","required":true,"placeholder":"Nom ou site, un par ligne"}]},{"id":"goals","title":"Objectifs et KPI","description":"Ces chiffres servent de référence à nos rapports mensuels.","questions":[{"id":"leads_goal","type":"number","label":"Nombre de leads souhaités par mois","required":true},{"id":"cpa_target","type":"number","label":"Coût par lead cible","unit":"€","map":"kpi.cpa"},{"id":"start_date","type":"date","label":"Date de lancement souhaitée"}]},{"id":"budget","title":"Budget et historique","description":"Le budget publicitaire est payé directement aux plateformes, en dehors de nos honoraires.","questions":[{"id":"budget","type":"single","label":"Budget publicitaire mensuel prévu","required":true,"options":["Moins de 1 000 €","1 000 à 3 000 €","3 000 à 10 000 €","Plus de 10 000 €"]},{"id":"platforms","type":"multi","label":"Plateformes envisagées","options":["Meta (Facebook, Instagram)","Google Ads","LinkedIn Ads","TikTok","Je ne sais pas encore"]},{"id":"ads_before","type":"single","label":"Avez-vous déjà fait de la publicité en ligne ?","required":true,"options":["Oui, en interne","Oui, avec une agence ou un freelance","Non, jamais"]},{"id":"learnings","type":"long","label":"Ce qui a fonctionné, ou pas, jusqu'ici"}]},{"id":"brand","title":"Marque et créations","description":"Tout ce qui nous aide à produire des publicités fidèles à votre marque.","questions":[{"id":"logo","type":"file","label":"Votre logo","required":true,"accept":"images","help":"Idéalement en SVG ou en PNG haute définition sur fond transparent."},{"id":"charter","type":"file","label":"Charte graphique (couleurs, typographies)","accept":"docs"},{"id":"creatives","type":"file","label":"Publicités, brochures ou présentations existantes","accept":"any","help":"Visuels, vidéos, publicités qui ont bien fonctionné. Jusqu'à 50 Mo par fichier."},{"id":"assets_link","type":"url","label":"Lien vers un dossier partagé (photos, vidéos)","placeholder":"https://drive.google.com/..."},{"id":"tone","type":"multi","label":"Le ton de votre marque","options":["Premium","Chaleureux","Expert","Décalé","Engagé","Minimaliste","Pédagogue"]},{"id":"never","type":"long","label":"Ce qu'il ne faut jamais dire ou montrer","placeholder":"Mots, images, sujets, concurrents à ne pas citer..."}]},{"id":"legal","title":"Contraintes légales","description":"Pour ne jamais diffuser une publicité refusée ou non conforme.","questions":[{"id":"legal_regulated","type":"single","label":"Votre secteur est-il soumis à une réglementation publicitaire particulière ?","required":true,"options":["Non","Oui (santé, alcool, finance, compléments alimentaires...)","Je ne sais pas"]},{"id":"legal_mentions","type":"long","label":"Mentions obligatoires ou allégations interdites","placeholder":"Ex. : « Sous réserve d'acceptation du dossier », pas de promesse de résultat..."},{"id":"legal_validator","type":"short","label":"Qui valide les publicités avant leur diffusion ?","placeholder":"Prénom, nom et email"}]},{"id":"access","title":"Accès aux outils","description":"Nous travaillons dans vos comptes, qui restent votre propriété : vous pouvez retirer nos accès à tout moment.","questions":[{"id":"access","type":"access","label":"Donnez-nous accès à vos comptes","required":true,"help":"Suivez les étapes de chaque outil, puis cochez « C'est fait ». Vous n'avez aucun mot de passe à nous transmettre.","items":[{"id":"meta_bm","name":"Business Manager Meta","platform":"meta_bm","link":"https://business.facebook.com/settings","idLabel":"ID de votre Business Manager","steps":["Ouvrez business.facebook.com/settings avec le compte administrateur de votre entreprise.","Copiez l'identifiant affiché sous le nom de votre entreprise (Informations sur l'entreprise) et collez-le ci-dessous.","Allez dans Utilisateurs > Partenaires, cliquez sur Ajouter puis « Donner à un partenaire l'accès à vos ressources ».","Saisissez l'ID de partenaire de {agence} : {meta_bm_id}, puis validez."]},{"id":"meta_ads","name":"Compte publicitaire, page et pixel Meta","platform":"meta_ads","link":"https://business.facebook.com/settings/ad-accounts","idLabel":"ID du compte publicitaire (act_...)","steps":["Dans les paramètres du Business Manager, ouvrez Comptes > Comptes publicitaires.","Sélectionnez votre compte publicitaire et copiez son identifiant.","Cliquez sur Attribuer des partenaires, saisissez l'ID {meta_bm_id} et cochez « Gérer les campagnes ».","Faites de même pour votre page Facebook, votre compte Instagram et votre pixel (Sources de données > Ensembles de données)."]},{"id":"google_ads","name":"Google Ads","platform":"google_ads","link":"https://ads.google.com","idLabel":"Numéro client Google Ads (123-456-7890)","steps":["Connectez-vous à ads.google.com : votre numéro client s'affiche en haut à droite (format 123-456-7890).","Collez-le ci-dessous : {agence} vous enverra une demande d'association depuis son compte administrateur {google_mcc_id}.","Dans Google Ads, ouvrez Administration > Accès et sécurité > Gestionnaires, puis acceptez la demande de {agence}."]},{"id":"ga4","name":"Google Analytics 4","platform":"ga4","link":"https://analytics.google.com","idLabel":"ID de la propriété GA4 (facultatif)","steps":["Ouvrez analytics.google.com, puis Administration (roue crantée en bas à gauche).","Dans la colonne Propriété, cliquez sur Gestion des accès à la propriété.","Cliquez sur +, puis Ajouter des utilisateurs, et saisissez {email_acces}.","Choisissez le rôle Éditeur et cliquez sur Ajouter."]},{"id":"gtm","name":"Google Tag Manager","platform":"gtm","link":"https://tagmanager.google.com","idLabel":"ID du conteneur (GTM-XXXXXXX)","steps":["Ouvrez tagmanager.google.com et sélectionnez le conteneur de votre site.","Cliquez sur Administration, puis Gestion des utilisateurs dans la colonne Conteneur.","Ajoutez {email_acces} avec l'autorisation Publier, puis envoyez l'invitation.","Pas encore de conteneur ? Cochez simplement la case : nous le créerons avec vous."]},{"id":"cms","name":"Site web (WordPress, Webflow...)","platform":"cms","idLabel":"Outil utilisé pour votre site","steps":["Connectez-vous à l'administration de votre site.","Créez un compte utilisateur pour {email_acces} avec le rôle Éditeur (ou Administrateur si nous devons installer le suivi).","Si votre site est géré par un prestataire, transmettez-lui simplement cette demande et cochez la case une fois l'accès créé."]},{"id":"crm","name":"Votre CRM (HubSpot, Pipedrive, Axonaut...)","platform":"other","idLabel":"Nom de votre CRM","steps":["Invitez {email_acces} comme utilisateur de votre CRM, en lecture seule si possible.","Nous en avons besoin pour relier les leads aux campagnes et mesurer le coût par client signé.","Pas de CRM ? Cochez la case et précisez où arrivent vos demandes (email, tableur...)."]}]},{"id":"access_notes","type":"long","label":"Un accès pose problème ? Dites-le nous ici","placeholder":"Ex. : le Business Manager appartient à notre ancien prestataire..."}]}]$j$::jsonb, 1),
    ('local', 'Onboarding local / prise de RDV',
      'Commerces et prestataires locaux : zone de chalandise, prestations, prise de rendez-vous, fiche Google.',
      'calendar', $j$[{"id":"company","title":"Votre établissement","description":"Pour cibler les bonnes personnes, au bon endroit.","questions":[{"id":"brand_name","type":"short","label":"Nom de l'établissement","required":true},{"id":"website","type":"url","label":"Site web","placeholder":"https://","map":"company.website"},{"id":"industry","type":"single","label":"Secteur d'activité","required":true,"options":["E-commerce","SaaS","Formation","Immobilier","Santé","Restauration","Services B2B","Local","Autre"],"map":"company.industry"},{"id":"address","type":"long","label":"Adresse(s) de l'établissement","required":true,"placeholder":"Une adresse par ligne"},{"id":"radius","type":"number","label":"Rayon de votre zone de chalandise","required":true,"unit":"km"},{"id":"hours","type":"long","label":"Horaires d'ouverture"},{"id":"phone","type":"phone","label":"Téléphone affiché dans les publicités"}]},{"id":"offer","title":"Vos prestations","description":"Ce que vous voulez remplir en priorité.","questions":[{"id":"services","type":"long","label":"Prestations proposées et leurs prix","required":true,"placeholder":"Une prestation par ligne"},{"id":"priority_service","type":"short","label":"La prestation à mettre en avant en priorité","required":true},{"id":"customer_value","type":"number","label":"Valeur moyenne d'un client","unit":"€"},{"id":"usp","type":"long","label":"Pourquoi vos clients vous choisissent ?"}]},{"id":"personas","title":"Votre clientèle","description":"Qui sont les clients que vous aimeriez voir plus souvent ?","questions":[{"id":"ideal_customer","type":"long","label":"Décrivez votre client idéal","required":true},{"id":"competitors","type":"long","label":"Vos principaux concurrents dans le secteur","placeholder":"Nom ou site, un par ligne"}]},{"id":"booking","title":"Prise de rendez-vous","description":"Pour mesurer chaque rendez-vous obtenu grâce aux publicités.","questions":[{"id":"booking_tool","type":"single","label":"Comment vos clients prennent-ils rendez-vous ?","required":true,"options":["Calendly","Planity","Doctolib","Formulaire du site","Téléphone uniquement","Autre outil"]},{"id":"booking_link","type":"url","label":"Lien de prise de rendez-vous","placeholder":"https://"},{"id":"capacity","type":"number","label":"Nombre de rendez-vous supplémentaires que vous pouvez absorber par semaine"}]},{"id":"goals","title":"Objectifs et budget","description":"Le budget publicitaire est payé directement aux plateformes, en dehors de nos honoraires.","questions":[{"id":"appointments_goal","type":"number","label":"Nombre de rendez-vous souhaités par mois","required":true},{"id":"cpa_target","type":"number","label":"Coût par rendez-vous cible","unit":"€","map":"kpi.cpa"},{"id":"budget","type":"single","label":"Budget publicitaire mensuel prévu","required":true,"options":["Moins de 500 €","500 à 1 000 €","1 000 à 3 000 €","Plus de 3 000 €"]},{"id":"ads_before","type":"single","label":"Avez-vous déjà fait de la publicité en ligne ?","required":true,"options":["Oui","Non, jamais"]},{"id":"start_date","type":"date","label":"Date de lancement souhaitée"}]},{"id":"brand","title":"Marque et créations","description":"Tout ce qui nous aide à produire des publicités fidèles à votre marque.","questions":[{"id":"logo","type":"file","label":"Votre logo","required":true,"accept":"images","help":"Idéalement en SVG ou en PNG haute définition sur fond transparent."},{"id":"charter","type":"file","label":"Charte graphique (couleurs, typographies)","accept":"docs"},{"id":"creatives","type":"file","label":"Photos de l'établissement, de l'équipe ou de vos réalisations","accept":"any","help":"Visuels, vidéos, publicités qui ont bien fonctionné. Jusqu'à 50 Mo par fichier."},{"id":"assets_link","type":"url","label":"Lien vers un dossier partagé (photos, vidéos)","placeholder":"https://drive.google.com/..."},{"id":"tone","type":"multi","label":"Le ton de votre marque","options":["Premium","Chaleureux","Expert","Décalé","Engagé","Minimaliste","Pédagogue"]},{"id":"never","type":"long","label":"Ce qu'il ne faut jamais dire ou montrer","placeholder":"Mots, images, sujets, concurrents à ne pas citer..."}]},{"id":"legal","title":"Contraintes légales","description":"Pour ne jamais diffuser une publicité refusée ou non conforme.","questions":[{"id":"legal_regulated","type":"single","label":"Votre secteur est-il soumis à une réglementation publicitaire particulière ?","required":true,"options":["Non","Oui (santé, alcool, finance, compléments alimentaires...)","Je ne sais pas"]},{"id":"legal_mentions","type":"long","label":"Mentions obligatoires ou allégations interdites","placeholder":"Ex. : « Sous réserve d'acceptation du dossier », pas de promesse de résultat..."},{"id":"legal_validator","type":"short","label":"Qui valide les publicités avant leur diffusion ?","placeholder":"Prénom, nom et email"}]},{"id":"access","title":"Accès aux outils","description":"Vos comptes restent votre propriété : vous pouvez retirer nos accès à tout moment.","questions":[{"id":"access","type":"access","label":"Donnez-nous accès à vos comptes","required":true,"help":"Suivez les étapes de chaque outil, puis cochez « C'est fait ». Vous n'avez aucun mot de passe à nous transmettre.","items":[{"id":"gbp","name":"Fiche d'établissement Google","platform":"gbp","link":"https://business.google.com","idLabel":"Nom exact de la fiche","steps":["Recherchez le nom de votre établissement sur Google en étant connecté au compte propriétaire de la fiche.","Cliquez sur les trois points du panneau de gestion, puis Paramètres de la fiche > Personnes et accès.","Cliquez sur Ajouter, saisissez {email_acces} et choisissez le rôle Gestionnaire."]},{"id":"meta_bm","name":"Business Manager Meta","platform":"meta_bm","link":"https://business.facebook.com/settings","idLabel":"ID de votre Business Manager","steps":["Ouvrez business.facebook.com/settings avec le compte administrateur de votre entreprise.","Copiez l'identifiant affiché sous le nom de votre entreprise (Informations sur l'entreprise) et collez-le ci-dessous.","Allez dans Utilisateurs > Partenaires, cliquez sur Ajouter puis « Donner à un partenaire l'accès à vos ressources ».","Saisissez l'ID de partenaire de {agence} : {meta_bm_id}, puis validez."]},{"id":"meta_ads","name":"Compte publicitaire, page et pixel Meta","platform":"meta_ads","link":"https://business.facebook.com/settings/ad-accounts","idLabel":"ID du compte publicitaire (act_...)","steps":["Dans les paramètres du Business Manager, ouvrez Comptes > Comptes publicitaires.","Sélectionnez votre compte publicitaire et copiez son identifiant.","Cliquez sur Attribuer des partenaires, saisissez l'ID {meta_bm_id} et cochez « Gérer les campagnes ».","Faites de même pour votre page Facebook, votre compte Instagram et votre pixel (Sources de données > Ensembles de données)."]},{"id":"google_ads","name":"Google Ads","platform":"google_ads","link":"https://ads.google.com","idLabel":"Numéro client Google Ads (123-456-7890)","steps":["Connectez-vous à ads.google.com : votre numéro client s'affiche en haut à droite (format 123-456-7890).","Collez-le ci-dessous : {agence} vous enverra une demande d'association depuis son compte administrateur {google_mcc_id}.","Dans Google Ads, ouvrez Administration > Accès et sécurité > Gestionnaires, puis acceptez la demande de {agence}."]},{"id":"ga4","name":"Google Analytics 4","platform":"ga4","link":"https://analytics.google.com","idLabel":"ID de la propriété GA4 (facultatif)","steps":["Ouvrez analytics.google.com, puis Administration (roue crantée en bas à gauche).","Dans la colonne Propriété, cliquez sur Gestion des accès à la propriété.","Cliquez sur +, puis Ajouter des utilisateurs, et saisissez {email_acces}.","Choisissez le rôle Éditeur et cliquez sur Ajouter."]},{"id":"gtm","name":"Google Tag Manager","platform":"gtm","link":"https://tagmanager.google.com","idLabel":"ID du conteneur (GTM-XXXXXXX)","steps":["Ouvrez tagmanager.google.com et sélectionnez le conteneur de votre site.","Cliquez sur Administration, puis Gestion des utilisateurs dans la colonne Conteneur.","Ajoutez {email_acces} avec l'autorisation Publier, puis envoyez l'invitation.","Pas encore de conteneur ? Cochez simplement la case : nous le créerons avec vous."]},{"id":"cms","name":"Site web (WordPress, Webflow...)","platform":"cms","idLabel":"Outil utilisé pour votre site","steps":["Connectez-vous à l'administration de votre site.","Créez un compte utilisateur pour {email_acces} avec le rôle Éditeur (ou Administrateur si nous devons installer le suivi).","Si votre site est géré par un prestataire, transmettez-lui simplement cette demande et cochez la case une fois l'accès créé."]}]},{"id":"access_notes","type":"long","label":"Un accès pose problème ? Dites-le nous ici","placeholder":"Ex. : le Business Manager appartient à notre ancien prestataire..."}]}]$j$::jsonb, 2)
$$;

-- Crée les réglages et les modèles par défaut manquants (idempotent)
create or replace function public.seed_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into onboarding_settings (workspace_id) values (ws) on conflict (workspace_id) do nothing;
  insert into onboarding_templates (workspace_id, key, name, description, icon, sections, position, created_by)
  select ws, d.key, d.name, d.description, d.icon, d.sections, d.position, null
  from onboarding_default_templates() d
  on conflict (workspace_id, key) where key is not null do nothing;
end $$;
revoke execute on function public.seed_onboarding(uuid) from anon, authenticated, public;
grant execute on function public.seed_onboarding(uuid) to service_role;

-- Bouton « Restaurer les modèles par défaut » : désarchive et recrée les manquants
create or replace function public.restore_onboarding_templates(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write(ws) then raise exception 'réservé aux membres de l''espace'; end if;
  update onboarding_templates set archived = false where workspace_id = ws and key in (select key from onboarding_default_templates());
  perform seed_onboarding(ws);
end $$;
revoke execute on function public.restore_onboarding_templates(uuid) from anon, public;
grant execute on function public.restore_onboarding_templates(uuid) to authenticated;

create or replace function public.seed_workspace_defaults_onboarding()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform seed_onboarding(new.id);
  return new;
end $$;
drop trigger if exists workspaces_seed_onboarding on public.workspaces;
create trigger workspaces_seed_onboarding after insert on public.workspaces
  for each row execute function public.seed_workspace_defaults_onboarding();

select public.seed_onboarding(id) from public.workspaces;

-- ---------------------------------------------------------------------
-- 6. Données de démo : un onboarding terminé (Maison Lumen) et un en
--    cours (Atelier Brun). À appeler après load_demo_data.
-- ---------------------------------------------------------------------
create or replace function public._clear_demo_onboarding(ws uuid)
returns void language sql security definer set search_path = public as $$
  delete from onboarding_forms where workspace_id = ws and is_demo;
$$;
revoke execute on function public._clear_demo_onboarding(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_onboarding(uuid) to service_role;

create or replace function public._demo_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := coalesce(auth.uid(), (select user_id from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1));
  c_lumen uuid; k_lumen uuid; c_brun uuid; k_brun uuid; p_lumen uuid;
  t_ecom onboarding_templates; t_local onboarding_templates;
begin
  perform _clear_demo_onboarding(ws);
  perform seed_onboarding(ws);
  select * into t_ecom from onboarding_templates where workspace_id = ws and key = 'ecommerce';
  select * into t_local from onboarding_templates where workspace_id = ws and key = 'local';
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' order by created_at limit 1;
  select id into c_brun from companies where workspace_id = ws and name = 'Atelier Brun' order by created_at limit 1;
  select id into k_lumen from contacts where workspace_id = ws and company_id = c_lumen order by created_at limit 1;
  select id into k_brun from contacts where workspace_id = ws and company_id = c_brun order by created_at limit 1;
  select id into p_lumen from projects where workspace_id = ws and company_id = c_lumen and archived_at is null order by created_at limit 1;

  if c_lumen is not null then
    insert into onboarding_forms (workspace_id, template_id, company_id, contact_id, project_id, title, sections, answers, verified,
      status, progress, options, automation, sent_at, email_sent_at, opened_at, last_activity_at, completed_at, is_demo, created_by)
    values (ws, t_ecom.id, c_lumen, k_lumen, p_lumen, 'Onboarding e-commerce · Maison Lumen', t_ecom.sections,
      jsonb_build_object(
        'brand_name', 'Maison Lumen',
        'website', 'https://maisonlumen.fr',
        'industry', 'E-commerce',
        'pitch', 'Nous dessinons et éditons des luminaires en petites séries, fabriqués dans des ateliers en France. Vente en ligne uniquement depuis 2021, avec un showroom sur rendez-vous à Lyon.',
        'hero_products', E'Suspension Halo : 240 €\nLampe à poser Dune : 165 €\nApplique Arc : 129 €\nCoffret ampoules vintage : 39 €',
        'aov', '180',
        'margin', '62',
        'usp', 'Design signé, fabrication française, garantie 5 ans et livraison offerte dès 100 €.',
        'promos', 'Collection hiver le 15 octobre, Black Friday (-20 % sur tout le site), coffrets cadeaux de Noël.',
        'ideal_customer', 'Femmes et hommes de 30 à 55 ans, propriétaires, qui refont leur intérieur et suivent des comptes déco sur Instagram et Pinterest. Sensibles au made in France.',
        'markets', jsonb_build_array('France', 'Belgique', 'Suisse'),
        'pains', 'Trouver un luminaire qui sort de l''ordinaire sans payer le prix d''une galerie.',
        'objections', E'Peur que le rendu ne corresponde pas aux photos\nDélais de fabrication (10 jours)',
        'repeat', '18',
        'competitors', E'Market Set\nHay\nSammode',
        'admired', 'Caravane',
        'main_goal', 'Augmenter les ventes en ligne',
        'roas_target', '3,5',
        'cpa_target', '45',
        'revenue', '38000',
        'start_date', to_char(current_date + 7, 'YYYY-MM-DD'),
        'budget', '10 000 à 30 000 €',
        'platforms', jsonb_build_array('Meta (Facebook, Instagram)', 'Google Ads', 'Pinterest'),
        'seasonality', 'Novembre et décembre représentent 35 % du chiffre d''affaires annuel. Creux en juillet et août.',
        'ads_before', 'Oui, en interne',
        'learnings', 'Les vidéos d''ambiance en intérieur marchent mieux que les photos produit sur fond blanc. Le retargeting catalogue est très rentable.',
        'past_spend', '9000',
        'assets_link', 'https://drive.google.com/drive/folders/maison-lumen-medias',
        'tone', jsonb_build_array('Premium', 'Chaleureux', 'Minimaliste'),
        'never', 'Ne jamais parler de « pas cher » ni de « promo » hors Black Friday.',
        'legal_regulated', 'Non',
        'legal_validator', 'Claire Dubois, claire@maisonlumen.fr',
        'access', jsonb_build_object(
          'meta_bm', jsonb_build_object('done', true, 'value', '1029384756102938'),
          'meta_ads', jsonb_build_object('done', true, 'value', 'act_556677889900'),
          'google_ads', jsonb_build_object('done', true, 'value', '482-193-7765'),
          'ga4', jsonb_build_object('done', true, 'value', '391827364'),
          'gtm', jsonb_build_object('done', true, 'value', 'GTM-K7LMN2P'),
          'shopify', jsonb_build_object('done', true, 'value', 'maison-lumen.myshopify.com'),
          'search_console', jsonb_build_object('skip', true)),
        'access_notes', 'La Search Console est gérée par notre développeur : il vous ajoute cette semaine.'),
      jsonb_build_object(
        'access:meta_bm', jsonb_build_object('at', now() - interval '8 days', 'by', me),
        'access:meta_ads', jsonb_build_object('at', now() - interval '8 days', 'by', me),
        'access:ga4', jsonb_build_object('at', now() - interval '7 days', 'by', me),
        'access:shopify', jsonb_build_object('at', now() - interval '7 days', 'by', me)),
      'completed', 100, '{"project": true, "kpis": true, "company": true}'::jsonb,
      jsonb_build_object('at', now() - interval '9 days', 'project_id', p_lumen, 'project_created', false, 'tasks', 0,
        'kpis', jsonb_build_object('roas', 3.5, 'cpa', 45), 'company', '[]'::jsonb),
      now() - interval '12 days', now() - interval '12 days', now() - interval '12 days', now() - interval '9 days', now() - interval '9 days', true, me);
  end if;

  if c_brun is not null then
    insert into onboarding_forms (workspace_id, template_id, company_id, contact_id, title, sections, answers,
      status, progress, sent_at, email_sent_at, opened_at, last_activity_at, reminded_at, remind_count, is_demo, created_by)
    values (ws, t_local.id, c_brun, k_brun, 'Onboarding local / prise de RDV · Atelier Brun', t_local.sections,
      jsonb_build_object(
        'brand_name', 'Atelier Brun',
        'website', 'https://atelier-brun.fr',
        'industry', 'Local',
        'address', '12 rue des Tanneurs, 59000 Lille',
        'radius', '40',
        'hours', 'Du lundi au vendredi, 8 h - 18 h. Showroom le samedi matin sur rendez-vous.',
        'phone', '06 55 44 33 22',
        'services', E'Cuisine sur mesure : à partir de 12 000 €\nDressing : à partir de 3 500 €\nBibliothèque et agencement : sur devis',
        'priority_service', 'Cuisine sur mesure',
        'ideal_customer', 'Propriétaires de maisons anciennes dans la métropole lilloise, 35-60 ans, projet de rénovation dans les 6 mois.',
        'booking_tool', 'Téléphone uniquement',
        'access', jsonb_build_object('gbp', jsonb_build_object('done', true, 'value', 'Atelier Brun Menuiserie'))),
      'in_progress', 32, now() - interval '4 days', now() - interval '4 days', now() - interval '3 days', now() - interval '1 day', now() - interval '1 day', 1, true, me);
  end if;
end $$;
revoke execute on function public._demo_onboarding(uuid) from anon, authenticated, public;
grant execute on function public._demo_onboarding(uuid) to service_role;

create or replace function public.load_demo_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _demo_onboarding(ws);
end $$;
revoke execute on function public.load_demo_onboarding(uuid) from anon, public;
grant execute on function public.load_demo_onboarding(uuid) to authenticated;

create or replace function public.clear_demo_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_onboarding(ws);
end $$;
revoke execute on function public.clear_demo_onboarding(uuid) from anon, public;
grant execute on function public.clear_demo_onboarding(uuid) to authenticated;

revoke execute on function public.onboarding_default_templates() from anon, public;
grant execute on function public.onboarding_default_templates() to authenticated, service_role;
