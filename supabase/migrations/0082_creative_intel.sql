-- =====================================================================
-- 0082 : veille concurrentielle (API Meta Ad Library) + tagging et
-- recommandations IA de la bibliothèque créa. Additive.
--  - creative_intel_settings : jeton Ad Library collé à la main (aucune
--    policy : service role uniquement, jamais renvoyé au navigateur)
--  - competitor_watches : surveillances par client (page ou mot-clé)
--  - competitor_ads : pubs de la bibliothèque publicitaire (une par
--    espace et par identifiant d'archive), tags IA
--  - creative_recommendations : historique des recommandations IA
--  - creative_concepts : source (inspiration concurrente) + tags IA
--  - notifications.kind : ajout de « creative »
-- =====================================================================

-- ---------------------------------------------------------------------
-- Réglages : jeton manuel (secret) et état du dernier test
-- ---------------------------------------------------------------------
create table if not exists public.creative_intel_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  access_token text,
  token_label text,
  token_user_id text,
  token_expires_at timestamptz,
  token_checked_at timestamptz,
  token_ok boolean,
  token_error text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.creative_intel_settings enable row level security;
-- aucune policy : lecture / écriture par le service role uniquement

-- État lisible par les membres (sans le jeton)
create or replace function public.creative_intel_status(ws uuid)
returns table (
  has_manual boolean, manual_label text, manual_expires_at timestamptz, manual_checked_at timestamptz,
  manual_ok boolean, manual_error text,
  has_connection boolean, connection_label text, connection_expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    (s.access_token is not null), s.token_label, s.token_expires_at, s.token_checked_at, s.token_ok, s.token_error,
    (c.id is not null), c.label, c.expires_at
  from (select 1) one
  left join creative_intel_settings s on s.workspace_id = ws
  left join lateral (
    select id, label, expires_at from ad_connections
    where workspace_id = ws and platform = 'meta' and (expires_at is null or expires_at > now())
    order by created_at desc limit 1
  ) c on true
  where public.is_member(ws);
$$;
revoke execute on function public.creative_intel_status(uuid) from anon, public;
grant execute on function public.creative_intel_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Surveillances
-- ---------------------------------------------------------------------
create table if not exists public.competitor_watches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null default 'page' check (kind in ('page', 'keyword')),
  page_id text,
  page_name text not null default '',
  search_terms text not null default '',
  countries text[] not null default '{FR}',
  active_only boolean not null default true,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  last_notified_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint competitor_watches_target check (
    (kind = 'page' and page_id is not null and page_id ~ '^[0-9]{3,30}$')
    or (kind = 'keyword' and length(trim(search_terms)) between 2 and 100)
  )
);
create index if not exists competitor_watches_ws on public.competitor_watches (workspace_id);

-- ---------------------------------------------------------------------
-- Pubs concurrentes (API Ad Library). Pas de dépense ni d'impressions
-- pour les pubs commerciales ; aucun média stocké (lien d'aperçu seulement).
-- ---------------------------------------------------------------------
create table if not exists public.competitor_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  watch_id uuid references public.competitor_watches(id) on delete cascade,
  archive_id text not null,
  page_id text not null default '',
  page_name text not null default '',
  bodies text[] not null default '{}',
  titles text[] not null default '{}',
  descriptions text[] not null default '{}',
  captions text[] not null default '{}',
  start_time timestamptz,
  stop_time timestamptz,
  -- URL d'aperçu sans le jeton (le paramètre access_token est retiré)
  snapshot_url text,
  platforms text[] not null default '{}',
  languages text[] not null default '{}',
  eu_reach bigint,
  target_ages text,
  target_gender text,
  target_locations jsonb,
  is_active boolean not null default true,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- tags IA : { angle, hook_type, hook, awareness, format, promise, proof, offer, cta, persona }
  ai_tags jsonb,
  ai_tags_hash text,
  ai_tagged_at timestamptz,
  concept_id uuid references public.creative_concepts(id) on delete set null,
  is_demo boolean not null default false,
  unique (workspace_id, archive_id)
);
create index if not exists competitor_ads_watch on public.competitor_ads (watch_id);
create index if not exists competitor_ads_ws_seen on public.competitor_ads (workspace_id, first_seen desc);

-- ---------------------------------------------------------------------
-- Recommandations IA (historique par client)
-- ---------------------------------------------------------------------
create table if not exists public.creative_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  model text not null default '',
  -- { summary, opportunities: [{ title, kind, why, evidence, competitor_ads, brief }] }
  output jsonb not null default '{}'::jsonb,
  -- chiffres transmis au modèle (traçabilité)
  stats jsonb not null default '{}'::jsonb,
  usage jsonb,
  -- concepts créés depuis une opportunité : { "<index>": "<concept id>" }
  created_concepts jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists creative_recommendations_ws on public.creative_recommendations (workspace_id, company_id, created_at desc);

-- RLS : lecture membres ; l'insertion passe par le serveur (service role)
alter table public.competitor_watches enable row level security;
alter table public.competitor_ads enable row level security;
alter table public.creative_recommendations enable row level security;
do $$
declare t text;
begin
  foreach t in array array['competitor_watches','competitor_ads','creative_recommendations'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "ajout membres" on public.%I', t);
    execute format('drop policy if exists "modif membres" on public.%I', t);
    execute format('drop policy if exists "suppression membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
end $$;
-- Les surveillances se créent depuis le navigateur
create policy "ajout membres" on public.competitor_watches for insert with check (public.can_write(workspace_id));

-- ---------------------------------------------------------------------
-- Concepts : inspiration concurrente et tags IA
-- ---------------------------------------------------------------------
-- source : { type: 'competitor', ad_id, archive_id, page_name, url } | { type: 'recommendation', recommendation_id }
alter table public.creative_concepts add column if not exists source jsonb;
alter table public.creative_concepts add column if not exists ai_tags jsonb;
alter table public.creative_concepts add column if not exists ai_tags_hash text;
alter table public.creative_concepts add column if not exists ai_tagged_at timestamptz;

-- ---------------------------------------------------------------------
-- Notifications : type « creative » (on relit la contrainte actuelle)
-- ---------------------------------------------------------------------
do $$
declare def text; kinds text[];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if def is not null and def !~ '\mcreative\M' then
    select array_agg(m[1]) into kinds from regexp_matches(def, '''([a-z_]+)''', 'g') as m;
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || (select string_agg(quote_literal(k), ', ') from unnest(kinds || 'creative'::text) k) || ']))';
  end if;
end $$;

-- =====================================================================
-- Données de démo : 2 surveillances par client démo, 40 pubs fictives
-- (aperçu Meta indisponible : snapshot_url null), tags IA pré-remplis,
-- tags des concepts démo et une recommandation d'exemple (Kalia).
-- =====================================================================
create or replace function public._clear_demo_intel(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from creative_recommendations where workspace_id = ws and is_demo;
  delete from competitor_ads where workspace_id = ws and is_demo;
  delete from competitor_watches where workspace_id = ws and is_demo;
  update creative_concepts set ai_tags = null, ai_tags_hash = null, ai_tagged_at = null where workspace_id = ws and is_demo;
end $$;
revoke execute on function public._clear_demo_intel(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_intel(uuid) to service_role;

create or replace function public._demo_intel(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_lumen uuid; c_kalia uuid; me uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid;
  n int := 0;
begin
  perform _clear_demo_intel(ws);
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' limit 1;
  select id into c_kalia from companies where workspace_id = ws and name = 'Kalia Cosmetics' limit 1;
  if c_lumen is null and c_kalia is null then return 0; end if;
  select user_id into me from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1;

  if c_lumen is not null then
    insert into competitor_watches (workspace_id, company_id, kind, page_id, page_name, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_lumen, 'page', '9990000000101', 'Atelier Lueur', '{FR}', false, now() - interval '5 hours', true, me, now() - interval '60 days')
    returning id into w1;
    insert into competitor_watches (workspace_id, company_id, kind, page_id, page_name, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_lumen, 'page', '9990000000102', 'Nordlys Maison', '{FR,BE}', false, now() - interval '5 hours', true, me, now() - interval '40 days')
    returning id into w2;
  end if;
  if c_kalia is not null then
    insert into competitor_watches (workspace_id, company_id, kind, page_id, page_name, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_kalia, 'page', '9990000000201', 'Belle Racine', '{FR}', false, now() - interval '5 hours', true, me, now() - interval '60 days')
    returning id into w3;
    insert into competitor_watches (workspace_id, company_id, kind, search_terms, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_kalia, 'keyword', 'sérum vitamine C', '{FR}', false, now() - interval '5 hours', true, me, now() - interval '40 days')
    returning id into w4;
  end if;

  insert into competitor_ads (workspace_id, watch_id, archive_id, page_id, page_name, bodies, titles, start_time, stop_time, snapshot_url,
                              platforms, languages, eu_reach, is_active, first_seen, last_seen, ai_tags, ai_tags_hash, ai_tagged_at, is_demo)
  select ws, w.id, 'demo-' || x.k, x.pid, x.page, array[x.body], array[x.title],
         now() - make_interval(days => x.start), case when x.stop is null then null else now() - make_interval(days => x.stop) end, null,
         x.plats, '{fr}', x.reach, x.stop is null,
         now() - make_interval(days => least(x.start, x.wage)),
         case when x.stop is null then now() - interval '5 hours' else now() - make_interval(days => x.stop) end,
         jsonb_build_object('angle', x.angle, 'hook_type', x.hook, 'hook', split_part(x.body, '. ', 1), 'awareness', x.aw, 'format', x.fmt,
           'promise', x.promise, 'proof', x.proof, 'offer', x.offer, 'cta', x.cta, 'persona', x.persona),
         'demo', now() - interval '5 hours', true
  from (values
    -- clé, surveillance, âge surveillance, page id, page, texte, titre, lancée (j), arrêtée (j), plateformes, portée UE, angle, type de hook, conscience, format, promesse, preuve, offre, CTA, persona
    ('a1', 1, 60, '9990000000101', 'Atelier Lueur', 'Chaque lampe Atelier Lueur est tournée à la main dans notre atelier de Bretagne. Du chêne massif, une lumière chaude, et 10 ans de garantie.', 'La lampe Céleste, en chêne massif', 74, null::int, '{facebook,instagram}'::text[], 420000::bigint, 'Artisanat et fait main', 'autorite', 'product', 'short_video', 'Une lampe faite pour durer', 'Fabrication artisanale, garantie 10 ans', '', 'Découvrir', 'Amateur de design durable'),
    ('a2', 1, 60, '9990000000101', 'Atelier Lueur', 'Chaque lampe Atelier Lueur est tournée à la main dans notre atelier de Bretagne. Du chêne massif, une lumière chaude, et 10 ans de garantie.', 'Céleste : le chêne qui éclaire', 58, null, '{facebook,instagram}', 310000, 'Artisanat et fait main', 'autorite', 'product', 'short_video', 'Une lampe faite pour durer', 'Fabrication artisanale, garantie 10 ans', '', 'Découvrir', 'Amateur de design durable'),
    ('a3', 1, 60, '9990000000101', 'Atelier Lueur', 'Chaque lampe Atelier Lueur est tournée à la main dans notre atelier de Bretagne. Du chêne massif, une lumière chaude, et 10 ans de garantie.', 'Tournée à la main en Bretagne', 41, null, '{instagram}', 150000, 'Artisanat et fait main', 'autorite', 'product', 'short_video', 'Une lampe faite pour durer', 'Fabrication artisanale, garantie 10 ans', '', 'Découvrir', 'Amateur de design durable'),
    ('a4', 1, 60, '9990000000101', 'Atelier Lueur', 'Ton salon est trop sombre le soir ? Une seule lampe d''appoint bien placée change toute l''ambiance. On t''explique où la mettre.', 'Le guide de la lumière du soir', 36, null, '{facebook,instagram}', 520000, 'Ambiance cocooning', 'question', 'problem', 'ugc', 'Un salon chaleureux avec une seule lampe', 'Démonstration en situation', '', 'En savoir plus', 'Propriétaire qui décore, 30-45 ans'),
    ('a5', 1, 60, '9990000000101', 'Atelier Lueur', 'Ton salon est trop sombre le soir ? Une seule lampe d''appoint bien placée change toute l''ambiance. On t''explique où la mettre.', '3 erreurs d''éclairage à éviter', 30, null, '{instagram}', 210000, 'Ambiance cocooning', 'question', 'problem', 'ugc', 'Un salon chaleureux avec une seule lampe', 'Démonstration en situation', '', 'En savoir plus', 'Propriétaire qui décore, 30-45 ans'),
    ('a6', 1, 60, '9990000000101', 'Atelier Lueur', '-25 % sur toute la collection Céleste jusqu''à dimanche. Livraison offerte dès 80 €.', 'Offre de rentrée', 12, 5, '{facebook,instagram}', 90000, 'Promotion', 'offre', 'most', 'static', '-25 % sur la collection', '', '-25 % et livraison offerte', 'Acheter', 'Cliente qui attend les promos'),
    ('a7', 1, 60, '9990000000101', 'Atelier Lueur', '« J''ai hésité 6 mois, je regrette de ne pas l''avoir prise avant. » Claire, cliente depuis 2024.', '4,8/5 sur 1 900 avis', 22, null, '{facebook,instagram}', 130000, 'Preuve sociale', 'temoignage', 'product', 'static', 'Un achat qu''on ne regrette pas', '1 900 avis, note 4,8/5', '', 'Acheter', 'Acheteuse qui hésite'),
    ('a8', 1, 60, '9990000000101', 'Atelier Lueur', 'Nouvelle collection : la suspension Brume, en lin lavé et laiton. Découvre-la en avant-première.', 'Nouveau : suspension Brume', 4, null, '{facebook,instagram}', null, 'Nouveauté produit', 'curiosite', 'product', 'carousel', 'Une suspension inédite', '', 'Avant-première', 'Découvrir', 'Cliente fidèle'),
    ('a9', 1, 60, '9990000000101', 'Atelier Lueur', 'Pourquoi nos abat-jour ne jaunissent jamais : le lin lavé traité sans produit chimique, expliqué en 30 secondes.', 'Le secret du lin lavé', 3, null, '{instagram}', null, 'Artisanat et fait main', 'curiosite', 'solution', 'short_video', 'Des abat-jour qui restent beaux', 'Explication du procédé', '', 'En savoir plus', 'Amateur de design durable'),
    ('a10', 1, 60, '9990000000101', 'Atelier Lueur', 'Idée cadeau : une lampe qu''on garde 20 ans. Emballage cadeau offert jusqu''au 24 décembre.', 'Le cadeau qui dure', 2, null, '{facebook,instagram}', null, 'Cadeau', 'promesse', 'unaware', 'static', 'Un cadeau durable', '', 'Emballage cadeau offert', 'Acheter', 'Acheteur cadeau, 30-55 ans'),
    ('b1', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Lampadaire Fjord, 89 €', 95, null, '{facebook,instagram,audience_network}', 890000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', 'Livraison 48 h', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b2', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Fjord : le best-seller à 89 €', 80, null, '{facebook,instagram}', 640000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', 'Best-seller', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b3', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Livré en 48 h, installé en 5 min', 63, null, '{instagram}', 350000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', 'Livraison 48 h', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b4', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Design nordique dès 89 €', 47, null, '{facebook,instagram}', 280000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', '', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b5', 2, 40, '9990000000102', 'Nordlys Maison', 'Avant / après : même salon, même soirée, trois points lumineux en plus.', 'Le salon transformé', 51, null, '{facebook,instagram}', 460000, 'Transformation avant/après', 'contraste', 'problem', 'short_video', 'Transformer une pièce sans travaux', 'Avant / après filmé', '', 'Découvrir', 'Propriétaire qui décore, 30-45 ans'),
    ('b6', 2, 40, '9990000000102', 'Nordlys Maison', 'Avant / après : même salon, même soirée, trois points lumineux en plus.', '3 points lumineux, tout change', 33, null, '{instagram}', 190000, 'Transformation avant/après', 'contraste', 'problem', 'short_video', 'Transformer une pièce sans travaux', 'Avant / après filmé', '', 'Découvrir', 'Propriétaire qui décore, 30-45 ans'),
    ('b7', 2, 40, '9990000000102', 'Nordlys Maison', 'Les ampoules à 2 700 K, c''est la règle d''or des décorateurs. Toutes nos lampes sont livrées avec.', 'La règle des 2 700 K', 27, 9, '{facebook,instagram}', 70000, 'Expertise déco', 'autorite', 'solution', 'carousel', 'Une lumière de décorateur', 'Conseil d''expert', 'Ampoule incluse', 'En savoir plus', 'Passionnée de déco'),
    ('b8', 2, 40, '9990000000102', 'Nordlys Maison', 'Notre designer te montre comment éclairer une pièce en 3 couches : ambiance, accent, lecture.', 'Éclairer en 3 couches', 19, null, '{facebook,instagram}', 110000, 'Expertise déco', 'chiffre', 'problem', 'ugc', 'Une pièce bien éclairée', 'Démonstration par un designer', '', 'En savoir plus', 'Passionnée de déco'),
    ('b9', 2, 40, '9990000000102', 'Nordlys Maison', 'Offre Black Friday en avance : -30 % sur les suspensions pour les inscrits.', 'Accès anticipé -30 %', 6, null, '{facebook,instagram}', null, 'Promotion', 'offre', 'most', 'static', '-30 % en avant-première', '', '-30 % pour les inscrits', 'S''inscrire', 'Cliente qui attend les promos'),
    ('b10', 2, 40, '9990000000102', 'Nordlys Maison', 'Tu passes 4 heures par soir sous un plafonnier ? Ton cerveau croit qu''il est midi.', 'Le plafonnier, ennemi du sommeil', 15, null, '{facebook,instagram,messenger}', 240000, 'Bien-être et sommeil', 'douleur', 'unaware', 'ugc', 'Mieux dormir grâce à la lumière du soir', 'Argument scientifique', '', 'En savoir plus', 'Actif stressé, 25-40 ans'),
    ('c1', 3, 60, '9990000000201', 'Belle Racine', 'Ma peau tiraillait tous les soirs. Depuis 3 semaines avec l''huile Racine, plus rien. Je vous montre ma routine en entier.', 'La routine de Léa, 34 ans', 88, null, '{facebook,instagram}', 1250000, 'Témoignage transformation', 'temoignage', 'problem', 'ugc', 'Une peau confortable en 3 semaines', 'Témoignage cliente filmé', '', 'Acheter', 'Peau sèche, 30-45 ans'),
    ('c2', 3, 60, '9990000000201', 'Belle Racine', 'Ma peau tiraillait tous les soirs. Depuis 3 semaines avec l''huile Racine, plus rien. Je vous montre ma routine en entier.', '3 semaines, plus de tiraillements', 70, null, '{facebook,instagram}', 780000, 'Témoignage transformation', 'temoignage', 'problem', 'ugc', 'Une peau confortable en 3 semaines', 'Témoignage cliente filmé', '', 'Acheter', 'Peau sèche, 30-45 ans'),
    ('c3', 3, 60, '9990000000201', 'Belle Racine', 'Ma peau tiraillait tous les soirs. Depuis 3 semaines avec l''huile Racine, plus rien. Je vous montre ma routine en entier.', 'L''huile qui a sauvé ma peau sèche', 52, null, '{instagram}', 420000, 'Témoignage transformation', 'temoignage', 'problem', 'ugc', 'Une peau confortable en 3 semaines', 'Témoignage cliente filmé', '', 'Acheter', 'Peau sèche, 30-45 ans'),
    ('c4', 3, 60, '9990000000201', 'Belle Racine', 'Une dermatologue lit la liste INCI de ta crème de nuit. Spoiler : 9 ingrédients sur 32 servent vraiment.', 'La dermato décrypte ta crème', 44, null, '{facebook,instagram}', 670000, 'Expertise et transparence', 'autorite', 'solution', 'short_video', 'Payer seulement pour ce qui agit', 'Avis de dermatologue', '', 'En savoir plus', 'Consommatrice clean beauty'),
    ('c5', 3, 60, '9990000000201', 'Belle Racine', 'Une dermatologue lit la liste INCI de ta crème de nuit. Spoiler : 9 ingrédients sur 32 servent vraiment.', '9 ingrédients utiles sur 32', 31, null, '{instagram}', 210000, 'Expertise et transparence', 'autorite', 'solution', 'short_video', 'Payer seulement pour ce qui agit', 'Avis de dermatologue', '', 'En savoir plus', 'Consommatrice clean beauty'),
    ('c6', 3, 60, '9990000000201', 'Belle Racine', '5 ingrédients, 0 compromis. Notre sérum tient sur une étiquette de 3 lignes.', 'Le sérum le plus court de France', 25, 10, '{facebook,instagram}', 150000, 'Formule courte', 'chiffre', 'product', 'static', 'Une formule sans superflu', 'Liste INCI de 5 ingrédients', '', 'Acheter', 'Consommatrice clean beauty'),
    ('c7', 3, 60, '9990000000201', 'Belle Racine', 'Pourquoi ton sérum vitamine C devient orange (et pourquoi il ne sert plus à rien).', 'Ton sérum est-il oxydé ?', 17, null, '{facebook,instagram}', 330000, 'Éducation ingrédients', 'curiosite', 'problem', 'short_video', 'Un sérum qui reste actif', 'Explication chimique simple', '', 'En savoir plus', 'Peau terne, 30-45 ans'),
    ('c8', 3, 60, '9990000000201', 'Belle Racine', 'Coffret routine complète à -20 % pour ta première commande. Satisfaite ou remboursée 30 jours.', 'Coffret découverte -20 %', 9, null, '{facebook,instagram}', 95000, 'Offre découverte', 'offre', 'most', 'carousel', 'Tester sans risque', 'Satisfaite ou remboursée', '-20 % sur la première commande', 'Acheter', 'Nouvelle cliente'),
    ('c9', 3, 60, '9990000000201', 'Belle Racine', 'Nouvelle crème de nuit au bakuchiol : l''alternative douce au rétinol, testée sur 60 peaux sensibles.', 'Le rétinol sans irritation', 5, null, '{facebook,instagram}', null, 'Alternative douce', 'contraste', 'solution', 'ugc', 'Les effets du rétinol sans irritation', 'Test sur 60 peaux sensibles', '', 'Découvrir', 'Peau sensible, 35-50 ans'),
    ('c10', 3, 60, '9990000000201', 'Belle Racine', 'J''ai testé 12 crèmes de nuit en 2 ans. Voici la seule que je rachète.', '12 crèmes testées, 1 gagnante', 1, null, '{instagram}', null, 'Témoignage transformation', 'chiffre', 'solution', 'ugc', 'La crème de nuit qu''on rachète', 'Comparaison vécue', '', 'Acheter', 'Débutante skincare'),
    ('d1', 4, 40, '9990000000301', 'Oléa Paris', 'Teint terne en hiver ? 7 gouttes de notre sérum vitamine C chaque matin, et ton teint retrouve son éclat en 14 jours.', 'L''éclat en 14 jours', 66, null, '{facebook,instagram}', 980000, 'Résultats visibles', 'question', 'problem', 'ugc', 'Un teint éclatant en 14 jours', 'Délai chiffré', '', 'Acheter', 'Peau terne, 30-45 ans'),
    ('d2', 4, 40, '9990000000301', 'Oléa Paris', 'Teint terne en hiver ? 7 gouttes de notre sérum vitamine C chaque matin, et ton teint retrouve son éclat en 14 jours.', 'Sérum Éclat : 7 gouttes suffisent', 49, null, '{facebook,instagram}', 510000, 'Résultats visibles', 'question', 'problem', 'ugc', 'Un teint éclatant en 14 jours', 'Délai chiffré', '', 'Acheter', 'Peau terne, 30-45 ans'),
    ('d3', 4, 40, '9990000000301', 'Oléa Paris', 'Teint terne en hiver ? 7 gouttes de notre sérum vitamine C chaque matin, et ton teint retrouve son éclat en 14 jours.', 'Vitamine C stabilisée à 15 %', 34, null, '{instagram}', 260000, 'Résultats visibles', 'question', 'problem', 'ugc', 'Un teint éclatant en 14 jours', 'Concentration affichée', '', 'Acheter', 'Peau terne, 30-45 ans'),
    ('d4', 4, 40, '9990000000301', 'Oléa Paris', '« Mes taches brunes ont pâli en 6 semaines. » 4 200 avis, 4,7/5.', '4,7/5 sur 4 200 avis', 40, null, '{facebook,instagram}', 400000, 'Preuve sociale', 'temoignage', 'product', 'static', 'Des taches atténuées', '4 200 avis, note 4,7/5', '', 'Acheter', 'Peau à taches, 40-55 ans'),
    ('d5', 4, 40, '9990000000302', 'Maison Verdure', 'Vitamine C, niacinamide ou acide hyaluronique : lequel choisir selon ta peau ? Le guide en 20 secondes.', 'Quel sérum pour ta peau ?', 29, null, '{facebook,instagram}', 190000, 'Éducation ingrédients', 'question', 'solution', 'short_video', 'Choisir le bon sérum', 'Guide pédagogique', '', 'En savoir plus', 'Débutante skincare'),
    ('d6', 4, 40, '9990000000302', 'Maison Verdure', 'Sérum vitamine C bio, fabriqué dans la Drôme. 29 € au lieu de 39 € cette semaine.', '-25 % sur le sérum bio', 11, 4, '{facebook,instagram}', 60000, 'Promotion', 'offre', 'most', 'static', 'Un sérum bio à prix réduit', 'Fabrication française', '29 € au lieu de 39 €', 'Acheter', 'Consommatrice bio'),
    ('d7', 4, 40, '9990000000302', 'Maison Verdure', 'Pas de vitamine C pure sur peau sensible : voici la forme qui ne pique pas.', 'La vitamine C qui ne pique pas', 20, null, '{instagram}', 150000, 'Alternative douce', 'contraste', 'solution', 'ugc', 'La vitamine C sans picotements', 'Forme dérivée expliquée', '', 'Découvrir', 'Peau sensible, 35-50 ans'),
    ('d8', 4, 40, '9990000000201', 'Belle Racine', 'Notre sérum vitamine C arrive. 1 000 flacons pour le lancement, liste d''attente ouverte.', 'Lancement sérum vitamine C', 6, null, '{facebook,instagram}', null, 'Nouveauté produit', 'curiosite', 'product', 'static', 'Être parmi les premières', 'Série limitée', 'Liste d''attente', 'S''inscrire', 'Cliente fidèle'),
    ('d9', 4, 40, '9990000000301', 'Oléa Paris', 'POV : tu arrêtes le fond de teint parce que ta peau n''en a plus besoin.', 'Plus besoin de fond de teint', 4, null, '{instagram}', null, 'Transformation avant/après', 'curiosite', 'unaware', 'ugc', 'Une peau nette sans maquillage', '', '', 'Découvrir', 'Active 25-35 ans'),
    ('d10', 4, 40, '9990000000302', 'Maison Verdure', 'Dermatologue : « la vitamine C le matin, le rétinol le soir, jamais l''inverse. »', 'L''ordre qui change tout', 13, null, '{facebook,instagram}', 120000, 'Expertise et transparence', 'autorite', 'solution', 'short_video', 'Une routine qui fonctionne', 'Avis de dermatologue', '', 'En savoir plus', 'Débutante skincare')
  ) as x(k, wn, wage, pid, page, body, title, start, stop, plats, reach, angle, hook, aw, fmt, promise, proof, offer, cta, persona)
  join (values (1, w1), (2, w2), (3, w3), (4, w4)) as w(n, id) on w.n = x.wn
  where w.id is not null;
  get diagnostics n = row_count;

  -- Tags IA des concepts démo (déduits de leurs champs)
  update creative_concepts c set
    ai_tags = jsonb_build_object(
      'angle', c.angle,
      'hook_type', case when c.hook like '%?%' then 'question'
                        when c.hook ~ '^(J''|Je |Mon |Ma |Mes )' then 'temoignage'
                        when c.hook ~* '(erreur|tiraille|sombre|attente)' then 'douleur'
                        when c.hook ~ '[0-9]' then 'chiffre'
                        when c.hook ~* '(POV|lis |secret)' then 'curiosite'
                        else 'promesse' end,
      'hook', c.hook, 'awareness', c.awareness, 'format', c.format,
      'promise', '', 'proof', '', 'offer', '', 'cta', coalesce(c.brief->>'cta', ''), 'persona', c.persona),
    ai_tags_hash = 'demo', ai_tagged_at = now()
  where c.workspace_id = ws and c.is_demo;

  -- Recommandation d'exemple (Kalia)
  if c_kalia is not null then
    insert into creative_recommendations (workspace_id, company_id, model, output, stats, is_demo, created_by, created_at)
    values (ws, c_kalia, 'exemple', $j${
      "summary": "Tes gagnants reposent sur la preuve visible (avant / après, routine) au niveau « conscient du produit » et « de la solution ». Les concurrents scalent surtout le témoignage « peau qui tiraille » et le décryptage par une dermatologue, deux terrains où tu n'as aucune créa en ligne. Ton angle ingrédients a échoué en motion design : il mérite une seconde chance en face caméra.",
      "opportunities": [
        {
          "title": "Le témoignage « peau qui tiraille » en routine complète",
          "kind": "scale",
          "why": "Belle Racine fait tourner le même témoignage depuis 88 jours en 3 variantes (portée UE cumulée de 2,45 M) : c'est leur créa la plus durable. Chez toi, le hook « Si ta peau tiraille après la douche » atteint 44 % de hook rate, le meilleur du compte, mais n'existe qu'en une seule annonce. Ton UGC témoignage Inès s'essouffle (CTR -35 % vs son pic) : il faut une relève sur le même registre.",
          "evidence": [{"label": "Hook rate du hook « peau qui tiraille »", "value": "44 %"}, {"label": "Longévité du témoignage Belle Racine", "value": "88 jours, 3 variantes"}, {"label": "Témoignage Inès", "value": "Fatigue, CTR -35 %"}],
          "competitor_ads": ["demo-c1", "demo-c2"],
          "brief": {
            "concept_title": "Ma routine du soir quand ma peau tiraille",
            "angle": "Témoignage transformation",
            "hooks": ["Ma peau tiraillait tous les soirs, jusqu'à ce que je change ça", "Si ta peau tiraille après la douche, regarde ma routine en entier", "3 semaines sans tiraillements : je te montre tout"],
            "script": "0-3 s : hook face caméra, visage sans maquillage.\n3-10 s : le problème vécu (tiraillements, crème qui ne suffit plus).\n10-25 s : la routine en 3 gestes, gros plans sur la texture.\n25-35 s : le résultat à 3 semaines, même lumière.\n35-40 s : -15 % sur la première commande.",
            "shots": ["Face caméra dans la salle de bain, lumière de fenêtre", "Gros plan texture sur le dos de la main", "Application sur le visage, plan serré", "Plan résultat, même cadrage qu'au début"],
            "format": "ugc",
            "awareness": "problem",
            "persona": "Peau sèche, 30-45 ans",
            "cta": "Teste la routine avec -15 % sur ta première commande"
          }
        },
        {
          "title": "Une dermatologue décrypte la crème de nuit",
          "kind": "counter",
          "why": "Deux concurrents scalent l'angle expertise : Belle Racine (44 jours, 2 variantes, 670 k de portée) et Maison Verdure (« la vitamine C le matin, le rétinol le soir »). Ton concept « Une dermato répond aux commentaires » est en production depuis des semaines : c'est le moment de le sortir, avec un hook chiffré plus fort que la simple présence d'une experte.",
          "evidence": [{"label": "Longévité Belle Racine (dermato)", "value": "44 jours, 2 variantes"}, {"label": "Ton concept dermato", "value": "En production"}],
          "competitor_ads": ["demo-c4", "demo-d10"],
          "brief": {
            "concept_title": "La dermato lit ta liste d'ingrédients",
            "angle": "Expertise et transparence",
            "hooks": ["Une dermato lit la liste d'ingrédients de ta crème (et elle n'est pas d'accord)", "Sur 30 ingrédients, combien servent vraiment ?", "Ce que ta dermato ne mettrait jamais sur son visage"],
            "script": "0-3 s : la dermatologue tient un pot de crème du commerce, hook.\n3-15 s : elle surligne les ingrédients inutiles.\n15-30 s : elle compare avec la formule Kalia en 5 ingrédients.\n30-40 s : sa recommandation, sans promesse médicale.",
            "shots": ["Plan poitrine de la dermatologue, blouse, fond neutre", "Gros plan sur l'étiquette surlignée", "Comparaison des deux étiquettes côte à côte", "Produit Kalia en main"],
            "format": "short_video",
            "awareness": "solution",
            "persona": "Consommatrice clean beauty",
            "cta": "Découvre la formule en 5 ingrédients"
          }
        },
        {
          "title": "Refaire l'angle ingrédients en face caméra",
          "kind": "gap",
          "why": "Ton motion « 5 ingrédients, rien d'autre » a été coupé avec 19 % de hook rate : c'est le format, pas forcément l'angle. Belle Racine obtient 17 jours et 330 k de portée avec « Pourquoi ton sérum vitamine C devient orange », un hook de curiosité au niveau « conscient du problème ». Tu n'as aucun concept de curiosité en ligne.",
          "evidence": [{"label": "Hook rate du motion ingrédients", "value": "19 %"}, {"label": "Concepts « curiosité » en ligne", "value": "0"}],
          "competitor_ads": ["demo-c7", "demo-d5"],
          "brief": {
            "concept_title": "Pourquoi ta crème ne marche plus",
            "angle": "Éducation ingrédients",
            "hooks": ["Pourquoi ta crème de nuit ne fait plus effet au bout d'un mois", "Retourne ton pot de crème : si tu vois ça, jette-le", "L'ingrédient que tu paies le plus cher et qui ne sert à rien"],
            "script": "0-3 s : hook avec le produit retourné vers la caméra.\n3-15 s : l'explication simple (oxydation, dosage, ordre des ingrédients).\n15-30 s : ce qu'il faut regarder sur une étiquette.\n30-40 s : la formule courte Kalia comme exemple.",
            "shots": ["Face caméra, cuisine ou salle de bain", "Gros plan étiquette", "Comparaison de deux textures", "Produit Kalia posé"],
            "format": "ugc",
            "awareness": "problem",
            "persona": "Consommatrice clean beauty",
            "cta": "Lis notre liste d'ingrédients"
          }
        },
        {
          "title": "Décliner ton avant / après avec un délai chiffré",
          "kind": "scale",
          "why": "Ton avant / après Sérum Éclat est la meilleure créa du compte (ROAS 40 % au-dessus de la moyenne, hook rate au-dessus de 40 %) mais repose sur une seule annonce. Oléa Paris scale la même promesse avec un délai chiffré (« l'éclat en 14 jours ») depuis 66 jours, en 3 variantes et 980 k de portée.",
          "evidence": [{"label": "ROAS avant / après vs moyenne", "value": "+40 %"}, {"label": "Longévité Oléa Paris", "value": "66 jours, 3 variantes"}],
          "competitor_ads": ["demo-d1", "demo-d2", "demo-d3"],
          "brief": {
            "concept_title": "J1, J14, J28 : même lumière, zéro filtre",
            "angle": "Résultats visibles",
            "hooks": ["J14 : même lumière, même téléphone, zéro filtre", "7 gouttes chaque matin pendant 28 jours, voici mon teint", "Le jour où j'ai arrêté l'anticernes"],
            "script": "0-3 s : split screen J1 / J28.\n3-15 s : le geste du matin, 7 gouttes.\n15-30 s : J1, J14, J28 au même endroit et à la même heure.\n30-40 s : appel à l'action.",
            "shots": ["Même cadrage face fenêtre à J1, J14, J28", "Gros plan pipette", "Split screen final"],
            "format": "ugc",
            "awareness": "product",
            "persona": "Peau terne, 30-45 ans",
            "cta": "Teste le Sérum Éclat avec -15 %"
          }
        }
      ]
    }$j$::jsonb,
    '{"exemple": true}'::jsonb, true, me, now() - interval '2 days');
  end if;
  return n;
end $$;
revoke execute on function public._demo_intel(uuid) from anon, authenticated, public;
grant execute on function public._demo_intel(uuid) to service_role;

create or replace function public.load_demo_intel(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_intel(ws);
end $$;
revoke execute on function public.load_demo_intel(uuid) from anon, public;
grant execute on function public.load_demo_intel(uuid) to authenticated;

create or replace function public.clear_demo_intel(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_intel(ws);
end $$;
revoke execute on function public.clear_demo_intel(uuid) from anon, public;
grant execute on function public.clear_demo_intel(uuid) to authenticated;
