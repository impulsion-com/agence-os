-- =====================================================================
-- 0072 : bibliothèque créative (creative strategy) + métriques par annonce
-- Additive : nouvelles tables, RPC de lecture, données de démo.
--  - ad_ads : catalogue des annonces synchronisées (nom, vignette, fréquence 7 j)
--  - ad_metrics_ad_daily : métriques quotidiennes par annonce (dont vidéo)
--  - creative_concepts / creative_variants / creative_assets / creative_ads :
--    concepts créatifs par client, variantes, fichiers et annonces liées
-- =====================================================================

-- ---------------------------------------------------------------------
-- Annonces (catalogue) : alimenté par la synchro (service role)
-- ---------------------------------------------------------------------
create table if not exists public.ad_ads (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_id text not null,
  name text not null default '',
  campaign_id text,
  campaign_name text not null default '',
  adset_id text,
  adset_name text not null default '',
  status text,
  -- image, video, carousel, dpa, search, other
  format text,
  thumbnail_url text,
  -- fréquence et couverture sur les 7 derniers jours (Meta)
  frequency_7d numeric(8,2),
  reach_7d bigint,
  synced_at timestamptz not null default now(),
  primary key (ad_account_id, ad_id)
);
create index if not exists ad_ads_ws on public.ad_ads (workspace_id);

-- ---------------------------------------------------------------------
-- Métriques quotidiennes par annonce
--  video_3s : vues de 3 secondes (Meta : action « video_view »)
--  thruplay : Meta ThruPlay (15 s ou fin) ; Google : vues TrueView
--  video_p25…p100 : lectures jusqu'à 25/50/75/100 % (Google : taux × impressions)
-- ---------------------------------------------------------------------
create table if not exists public.ad_metrics_ad_daily (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  campaign_id text not null default '',
  adset_id text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint,
  clicks bigint not null default 0,
  conversions numeric(14,2) not null default 0,
  conversion_value numeric(14,2) not null default 0,
  video_3s bigint,
  video_p25 bigint,
  video_p50 bigint,
  video_p75 bigint,
  video_p100 bigint,
  thruplay bigint,
  primary key (ad_account_id, date, ad_id)
);
create index if not exists ad_metrics_ad_daily_ws on public.ad_metrics_ad_daily (workspace_id, date);
create index if not exists ad_metrics_ad_daily_ad on public.ad_metrics_ad_daily (workspace_id, ad_id, date);

alter table public.ad_ads enable row level security;
alter table public.ad_metrics_ad_daily enable row level security;
drop policy if exists "lecture membres" on public.ad_ads;
drop policy if exists "lecture membres" on public.ad_metrics_ad_daily;
create policy "lecture membres" on public.ad_ads for select using (public.is_member(workspace_id));
create policy "lecture membres" on public.ad_metrics_ad_daily for select using (public.is_member(workspace_id));

-- ---------------------------------------------------------------------
-- Concepts créatifs
-- ---------------------------------------------------------------------
create table if not exists public.creative_concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  angle text not null default '',
  hook text not null default '',
  persona text not null default '',
  -- niveaux de conscience de Schwartz
  awareness text check (awareness in ('unaware','problem','solution','product','most')),
  format text not null default 'static' check (format in ('static','carousel','short_video','ugc','motion','dpa','other')),
  platforms text[] not null default '{}',
  status text not null default 'idea' check (status in ('idea','brief','production','ready','testing','winner','loser','fatigued')),
  -- { context, script, shots, instructions, dos, donts, cta, duration, references }
  brief jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  verdict text not null default '',
  launched_at date,
  owner_id uuid references auth.users(id) on delete set null,
  cover_path text,
  position double precision not null default 0,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creative_concepts_ws on public.creative_concepts (workspace_id, status);
create index if not exists creative_concepts_task on public.creative_concepts (task_id) where task_id is not null;

-- Variantes : plusieurs hooks / visuels / textes d'un même concept
create table if not exists public.creative_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null references public.creative_concepts(id) on delete cascade,
  name text not null,
  hook text not null default '',
  notes text not null default '',
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists creative_variants_concept on public.creative_variants (concept_id);

-- Fichiers (bucket attachments, chemin <workspace>/creatives/<concept>/…)
create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null references public.creative_concepts(id) on delete cascade,
  variant_id uuid references public.creative_variants(id) on delete set null,
  name text not null,
  path text not null,
  size bigint not null default 0,
  mime text not null default '',
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists creative_assets_concept on public.creative_assets (concept_id);

-- Annonces liées (identifiant d'annonce de la plateforme)
create table if not exists public.creative_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null references public.creative_concepts(id) on delete cascade,
  variant_id uuid references public.creative_variants(id) on delete set null,
  platform text not null default 'meta',
  ad_id text not null,
  created_at timestamptz not null default now(),
  unique (concept_id, platform, ad_id)
);
create index if not exists creative_ads_ws_ad on public.creative_ads (workspace_id, ad_id);

do $$
declare t text;
begin
  foreach t in array array['creative_concepts','creative_variants','creative_assets','creative_ads'] loop
    execute format('alter table public.%I enable row level security', t);
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

create or replace function public.touch_creative_concept()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists creative_concepts_touch on public.creative_concepts;
create trigger creative_concepts_touch before update on public.creative_concepts
  for each row execute function public.touch_creative_concept();

-- ---------------------------------------------------------------------
-- Lecture : métriques par annonce d'une période (RLS de l'appelant)
-- ---------------------------------------------------------------------
create or replace function public.creative_ad_daily(p_ws uuid, p_start date, p_end date, p_company uuid default null)
returns table (
  ad_account_id uuid, platform text, company_id uuid, date date, campaign_id text, adset_id text, ad_id text, ad_name text,
  spend numeric, impressions bigint, clicks bigint, conversions numeric, conversion_value numeric,
  video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint, thruplay bigint
)
language sql stable security invoker set search_path = public as $$
  select m.ad_account_id, a.platform, a.company_id, m.date, m.campaign_id, m.adset_id, m.ad_id, m.ad_name,
         m.spend, m.impressions, m.clicks, m.conversions, m.conversion_value,
         m.video_3s, m.video_p25, m.video_p50, m.video_p75, m.video_p100, m.thruplay
  from ad_metrics_ad_daily m
  join ad_accounts a on a.id = m.ad_account_id
  where m.workspace_id = p_ws and m.date between p_start and p_end
    and (p_company is null or a.company_id = p_company)
  order by m.date, m.ad_id;
$$;
grant execute on function public.creative_ad_daily(uuid, date, date, uuid) to authenticated;
revoke execute on function public.creative_ad_daily(uuid, date, date, uuid) from anon, public;

-- ---------------------------------------------------------------------
-- Ventes réelles attribuées aux annonces (tracking first-party).
-- Modèle : dernier point de contact portant un identifiant d'annonce
-- (touchpoints.ad_key, paramètre aos_ad) dans la fenêtre du site,
-- visiteurs fusionnés par email. Achats et deals gagnés.
-- ---------------------------------------------------------------------
create or replace function public.creative_ad_attribution(p_ws uuid, p_start date, p_end date, p_ad_keys text[] default null)
returns table (ad_key text, sales int, revenue numeric)
language sql stable security definer set search_path = public as $$
  with conv as (
    select e.id, e.ts, coalesce(e.value, 0) as value, e.site_id, e.visitor_id, v.email,
           greatest(1, least(coalesce((s.settings->>'window_days')::int, 30), 365)) as win
    from tracking_events e
    join tracking_sites s on s.id = e.site_id
    left join visitors v on v.id = e.visitor_id
    where e.workspace_id = p_ws and public.is_member(p_ws)
      and e.type in ('purchase', 'deal_won')
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz
  ),
  att as (
    select c.value,
      (select t.ad_key from touchpoints t
        where t.site_id = c.site_id
          and t.visitor_id = any(case when c.email is null then array[c.visitor_id]
                                 else coalesce((select array_agg(vv.id) from visitors vv where vv.site_id = c.site_id and vv.email = c.email), array[c.visitor_id]) end)
          and t.ad_key is not null
          and t.ts <= c.ts and t.ts > c.ts - make_interval(days => c.win)
        order by t.ts desc limit 1) as ad_key
    from conv c
  )
  select a.ad_key, count(*)::int, sum(a.value)
  from att a
  where a.ad_key is not null and (p_ad_keys is null or a.ad_key = any(p_ad_keys))
  group by a.ad_key;
$$;
grant execute on function public.creative_ad_attribution(uuid, date, date, text[]) to authenticated;
revoke execute on function public.creative_ad_attribution(uuid, date, date, text[]) from anon, public;

-- =====================================================================
-- Données de démo : annonces Meta de Maison Lumen et Kalia (métriques par
-- annonce obtenues en répartissant ad_metrics_daily, donc cohérentes avec
-- le reporting), ~23 concepts reliés aux annonces et aux tâches créa.
-- Les identifiants d'annonce suivent la formule du seed de tracking
-- ('2386' || hashtext(campagne || annonce)) : l'attribution réelle s'affiche.
-- =====================================================================
create or replace function public._clear_demo_creatives(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from creative_concepts where workspace_id = ws and is_demo;
  delete from ad_metrics_ad_daily m using ad_accounts a
    where a.id = m.ad_account_id and a.workspace_id = ws and a.external_id like 'demo-%';
  delete from ad_ads d using ad_accounts a
    where a.id = d.ad_account_id and a.workspace_id = ws and a.external_id like 'demo-%';
end $$;
revoke execute on function public._clear_demo_creatives(uuid) from anon, authenticated, public;

create or replace function public._demo_creatives(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_lumen uuid; c_kalia uuid; p_lum uuid; p_kal uuid; t_lum uuid; t_kal uuid; t_kal2 uuid;
  me uuid;
  r record; cid uuid; vid uuid; n int := 0; k text; v_ad text;
  concept_ids jsonb := '{}'::jsonb;
begin
  perform _clear_demo_creatives(ws);
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' limit 1;
  select id into c_kalia from companies where workspace_id = ws and name = 'Kalia Cosmetics' limit 1;
  if c_lumen is null and c_kalia is null then return 0; end if;
  select id into p_lum from projects where workspace_id = ws and key = 'LUM' limit 1;
  select id into p_kal from projects where workspace_id = ws and key = 'KAL' limit 1;
  select id into t_lum from tasks where project_id = p_lum and title like 'Brief créa%' limit 1;
  select id into t_kal from tasks where project_id = p_kal and title like '8 nouveaux concepts%' limit 1;
  select id into t_kal2 from tasks where project_id = p_kal and title like 'Scripts UGC%' limit 1;
  select user_id into me from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1;

  -- ---------- Annonces : répartition des métriques de campagne ----------
  drop table if exists _ads;
  drop table if exists _rows;
  create temp table _ads on commit drop as
  select * from (values
    -- ext, campagne, annonce, ensemble, lancée (jours), arrêtée, poids, cpm, ctr, perf, panier, hook (null = statique), hold, fatigue dès (jours), format
    ('demo-lumen-meta', 'Advantage+ Shopping', 'UGC Suspension Opale', 'Broad FR 25-55', 999, 0, 1.4, 1.00, 1.15, 1.35, 1.05, 0.34, 0.30, null::int, 'video'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Carrousel best-sellers', 'Broad FR 25-55', 999, 0, 1.0, 0.95, 0.90, 0.78, 0.95, null, null, null, 'carousel'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Vidéo atelier', 'Intérêts déco maison', 999, 0, 1.1, 1.05, 1.10, 1.12, 1.10, 0.29, 0.24, 24, 'video'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Motion lampadaire Arc', 'Broad FR 25-55', 35, 0, 0.8, 1.00, 1.00, 0.98, 1.20, 0.25, 0.20, null, 'video'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Statique cadeau Noël', 'Broad FR 25-55', 12, 0, 0.9, 0.90, 1.20, 1.50, 1.00, null, null, null, 'image'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'UGC cocooning soirée', 'Intérêts déco maison', 25, 0, 1.0, 1.00, 1.25, 1.28, 1.00, 0.38, 0.33, null, 'video'),
    ('demo-lumen-meta', 'Retargeting 30 j', 'Lampadaire Arc statique', 'Visiteurs 30 j', 999, 0, 1.0, 1.00, 1.00, 1.05, 1.25, null, null, null, 'image'),
    ('demo-lumen-meta', 'Retargeting 30 j', 'Offre retour panier', 'Paniers abandonnés', 999, 0, 1.0, 1.10, 1.30, 1.20, 0.90, null, null, null, 'image'),
    ('demo-lumen-meta', 'Retargeting 30 j', 'Avis clientes 4,9', 'Visiteurs 30 j', 40, 0, 0.7, 1.00, 0.85, 0.92, 1.00, null, null, null, 'image'),
    ('demo-kalia-meta', 'Prospection UGC', 'UGC routine du soir', 'Broad femmes 25-45', 999, 0, 1.3, 1.00, 1.10, 1.22, 1.00, 0.36, 0.31, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Avant après sérum', 'Broad femmes 25-45', 999, 0, 1.2, 1.00, 1.20, 1.42, 1.05, 0.41, 0.28, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Témoignage Inès', 'Lookalike acheteuses 3 %', 999, 0, 1.1, 1.00, 1.15, 1.18, 1.00, 0.33, 0.29, 26, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Hook peau qui tiraille', 'Broad femmes 25-45', 18, 0, 1.0, 1.00, 1.30, 1.30, 0.95, 0.44, 0.27, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Motion ingrédients', 'Lookalike acheteuses 3 %', 30, 0, 0.7, 0.95, 0.75, 0.62, 0.90, 0.19, 0.14, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Statique avis 4,8', 'Broad femmes 25-45', 45, 0, 0.6, 0.90, 0.80, 0.84, 1.00, null, null, null, 'image'),
    ('demo-kalia-meta', 'Prospection UGC', 'UGC 3 erreurs routine', 'Broad femmes 25-45', 8, 0, 0.9, 1.00, 1.20, 1.16, 1.00, 0.39, 0.26, null, 'video'),
    ('demo-kalia-meta', 'Catalogue DPA', 'DPA carrousel', 'Vues produit 14 j', 999, 0, 1.0, 1.00, 1.00, 1.03, 1.00, null, null, null, 'dpa'),
    ('demo-kalia-meta', 'Catalogue DPA', 'DPA collection', 'Acheteuses 180 j', 999, 0, 1.0, 1.00, 0.95, 0.96, 1.00, null, null, null, 'dpa')
  ) as x(ext, campaign, ad, adset, launch, stop, wt, cpmf, ctrf, perf, aovf, hook, hold, fat, fmt);

  create temp table _rows on commit drop as
  with base as (
    select m.ad_account_id, m.date, m.campaign_id, m.spend, m.impressions, m.clicks, m.conversions, m.conversion_value,
           a.*, (current_date - m.date) as ago,
           '2386' || lpad((abs(hashtext(a.campaign || a.ad)) % 100000000)::text, 8, '0') as ad_id,
           '2385' || lpad((abs(hashtext(a.campaign || a.adset)) % 100000000)::text, 8, '0') as adset_id,
           0.85 + 0.3 * ((hashtext(a.ad || m.date::text) & 255) / 255.0) as noise,
           0.9 + 0.2 * ((hashtext(m.date::text || a.ad) & 255) / 255.0) as noise2
    from ad_metrics_daily m
    join ad_accounts acc on acc.id = m.ad_account_id and acc.workspace_id = ws
    join _ads a on a.ext = acc.external_id and a.campaign = m.campaign_name
    where (current_date - m.date) <= a.launch and (current_date - m.date) >= a.stop
  ),
  f as (
    select b.*,
      least(1.0, (b.launch - b.ago + 1) / 3.0) as ramp,
      case when b.fat is not null and b.ago < b.fat then greatest(0.42, 1 - (b.fat - b.ago) * 0.028) else 1 end as fatf
    from base b
  ),
  ww as (
    select f.*,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise as ws_spend,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.cpmf as ws_imp,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.cpmf * f.ctrf * f.fatf as ws_clk,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.perf * f.fatf * f.noise2 as ws_conv,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.perf * f.fatf * f.noise2 * f.aovf as ws_val
    from f
  )
  select w.*,
    round((w.spend * w.ws_spend / sum(w.ws_spend) over p)::numeric, 2) as a_spend,
    round(w.impressions * w.ws_imp / sum(w.ws_imp) over p)::bigint as a_imp,
    round(w.clicks * w.ws_clk / sum(w.ws_clk) over p)::bigint as a_clk,
    round((w.conversions * w.ws_conv / sum(w.ws_conv) over p)::numeric, 2) as a_conv,
    round((w.conversion_value * w.ws_val / sum(w.ws_val) over p)::numeric, 2) as a_val
  from ww w
  window p as (partition by w.ad_account_id, w.date, w.campaign_id);

  insert into ad_metrics_ad_daily (ad_account_id, workspace_id, date, campaign_id, adset_id, ad_id, ad_name, spend, impressions, reach, clicks,
                                   conversions, conversion_value, video_3s, video_p25, video_p50, video_p75, video_p100, thruplay)
  select q.ad_account_id, ws, q.date, q.campaign_id, q.adset_id, q.ad_id, q.ad, q.a_spend, q.a_imp, round(q.a_imp / 1.18)::bigint, q.a_clk,
         q.a_conv, q.a_val,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2)::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * least(0.95, q.hold * 2.2))::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * least(0.9, q.hold * 1.5))::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * q.hold * 1.05)::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * q.hold * 0.7)::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * q.hold)::bigint end
  from _rows q;
  get diagnostics n = row_count;

  insert into ad_ads (ad_account_id, workspace_id, ad_id, name, campaign_id, campaign_name, adset_id, adset_name, status, format, frequency_7d, reach_7d)
  select distinct on (q.ad_account_id, q.ad_id) q.ad_account_id, ws, q.ad_id, q.ad, q.campaign_id, q.campaign, q.adset_id, q.adset,
         'ACTIVE', q.fmt,
         case when q.fat is not null then 3.6 + ((hashtext(q.ad) & 7) / 10.0) when q.campaign like 'Retargeting%' or q.campaign like 'Catalogue%' then 2.6 + ((hashtext(q.ad) & 7) / 10.0) else 1.4 + ((hashtext(q.ad) & 7) / 10.0) end,
         (select round(sum(x.a_imp) / 2.4)::bigint from _rows x where x.ad_id = q.ad_id and x.ago <= 7)
  from _rows q
  order by q.ad_account_id, q.ad_id;

  -- ---------- Concepts ----------
  for r in
    select * from (values
      -- clé, client, titre, angle, hook, persona, conscience, format, statut, annonces liées, variantes (nom|hook;…), tags, verdict, lancé il y a (jours), tâche
      ('lum-opale', 'lumen', 'Suspension Opale en situation', 'Cocooning', 'Mon salon a changé d''ambiance avec une seule lampe', 'Claire, 38 ans, propriétaire qui décore', 'solution', 'ugc', 'winner',
        array['UGC Suspension Opale'], 'V1 salon|Mon salon a changé d''ambiance avec une seule lampe;V2 chambre|Ma chambre ressemble enfin à un hôtel', array['Hiver','Best-seller'],
        'Gagnant : ROAS 30 % au-dessus du compte sur 90 jours, hook rate stable autour de 34 %. À décliner en 3 nouveaux hooks.', 90, null),
      ('lum-best', 'lumen', 'Les best-sellers de la saison', 'Preuve sociale', 'Les 5 luminaires que nos clientes rachètent', 'Acheteuse qui compare', 'product', 'carousel', 'loser',
        array['Carrousel best-sellers'], null, array['Catalogue'], 'Perdant : CPA 25 % au-dessus de la moyenne, le carrousel dilue le message. On le coupe au prochain rafraîchissement.', 90, null),
      ('lum-atelier', 'lumen', 'Dans l''atelier Lumen', 'Artisanat et design signé', 'Chaque abat-jour est soufflé à la main, à 40 km de Lyon', 'Amateur de design, sensible au fait main', 'product', 'short_video', 'fatigued',
        array['Vidéo atelier'], 'V1 souffleur|Chaque abat-jour est soufflé à la main;V2 chiffres|3 heures de travail pour une seule suspension', array['Marque'],
        'Épuisé : CTR en baisse de plus de 30 % depuis son pic, fréquence au-dessus de 3,5. Nouveau montage à prévoir.', 90, null),
      ('lum-arc', 'lumen', 'Lampadaire Arc sans perçage', 'Artisanat et design signé', 'Un arc de 2 mètres, zéro perçage', 'Locataire en appartement', 'solution', 'motion', 'testing',
        array['Motion lampadaire Arc', 'Lampadaire Arc statique'], 'Motion|Un arc de 2 mètres, zéro perçage;Statique retargeting|Toujours en train d''y penser ?', array['Hiver'], '', 35, null),
      ('lum-cadeau', 'lumen', 'Idée cadeau lumineuse', 'Cadeau de Noël', 'Le cadeau qu''on garde 20 ans', 'Acheteur cadeau, 30-55 ans', 'unaware', 'static', 'testing',
        array['Statique cadeau Noël'], 'Carte cadeau|Le cadeau qu''on garde 20 ans;Emballage|Déjà emballé, livré avant le 20 décembre', array['Noël','Black Friday'], '', 12, 'lum'),
      ('lum-cocooning', 'lumen', 'Soirée cocooning', 'Cocooning', 'POV : 18 h, tu n''allumes plus que la lampe d''appoint', 'Claire, 38 ans, propriétaire qui décore', 'problem', 'ugc', 'testing',
        array['UGC cocooning soirée'], 'POV|POV : 18 h, tu n''allumes plus que la lampe d''appoint;Question|Pourquoi ton salon fait « salle d''attente » le soir ?', array['Hiver'], '', 25, 'lum'),
      ('lum-retour', 'lumen', 'Livraison offerte et retours 60 jours', 'Réassurance', 'Tu hésites ? Essaie-la 60 jours chez toi', 'Visiteuse qui a abandonné son panier', 'most', 'static', 'winner',
        array['Offre retour panier'], null, array['Retargeting'], 'Gagnant en retargeting : meilleur CTR du compte, ROAS 5+.', 90, null),
      ('lum-avis', 'lumen', 'Avis clientes 4,9 / 5', 'Preuve sociale', '4,9 / 5 sur 2 300 avis vérifiés', 'Visiteuse qui a abandonné son panier', 'product', 'static', 'testing',
        array['Avis clientes 4,9'], null, array['Retargeting'], '', 40, null),
      ('lum-avantapres', 'lumen', 'Avant / après : le salon sombre', 'Cocooning', 'Même pièce, même heure, une seule lampe en plus', 'Claire, 38 ans, propriétaire qui décore', 'problem', 'ugc', 'production',
        null, 'Avant après|Même pièce, même heure, une seule lampe en plus;Timelapse|De 17 h à 22 h dans mon salon', array['Hiver'], '', null, 'lum'),
      ('lum-bf', 'lumen', 'Black Friday : -20 % sur les suspensions', 'Offre', 'Les suspensions à -20 %, 4 jours seulement', 'Acheteuse qui attend les promos', 'most', 'static', 'brief',
        null, null, array['Black Friday'], '', null, 'lum'),
      ('lum-designer', 'lumen', 'Le designer raconte la collection hiver', 'Artisanat et design signé', 'J''ai dessiné cette lampe en pensant à ma grand-mère', 'Amateur de design, sensible au fait main', 'unaware', 'short_video', 'idea',
        null, null, array['Marque'], '', null, null),
      ('kal-routine', 'kalia', 'Routine du soir en 3 gestes', 'Routine simplifiée', 'Ma routine du soir tient en 90 secondes', 'Active 30-45 ans, peu de temps', 'solution', 'ugc', 'winner',
        array['UGC routine du soir'], 'V1 90 secondes|Ma routine du soir tient en 90 secondes;V2 3 produits|3 produits, pas un de plus;V3 démaquillage|Je me démaquille en 20 secondes', array['Evergreen'],
        'Gagnant : ROAS stable 20 % au-dessus du compte, hook rate 36 %. Tester les V2 et V3 en hooks.', 90, null),
      ('kal-avantapres', 'kalia', 'Avant / après Sérum Éclat', 'Résultats visibles', 'J28 : même lumière, même téléphone, zéro filtre', 'Peau terne, 30-45 ans', 'product', 'ugc', 'winner',
        array['Avant après sérum'], 'J28|J28 : même lumière, même téléphone, zéro filtre;Zoom|Zoom sur mes pores, sans maquillage', array['Sérum','Evergreen'],
        'Meilleure créa du compte : ROAS +40 %, hook rate au-dessus de 40 %. Priorité : 3 nouvelles créatrices sur le même format.', 90, null),
      ('kal-ines', 'kalia', 'Témoignage Inès', 'Preuve sociale', 'J''ai arrêté 6 produits pour un seul', 'Débutante skincare', 'solution', 'ugc', 'fatigued',
        array['Témoignage Inès'], null, array['Témoignage'], 'Épuisé : CTR -35 % depuis son pic, fréquence 3,7. Refaire le hook avec une autre créatrice.', 90, null),
      ('kal-tiraille', 'kalia', 'Peau qui tiraille après la douche', 'Problème peau sèche', 'Si ta peau tiraille après la douche, écoute ça', 'Peau sèche, 30-45 ans', 'problem', 'ugc', 'testing',
        array['Hook peau qui tiraille'], 'Question|Si ta peau tiraille après la douche, écoute ça;Erreur|L''erreur que tu fais juste après la douche', array['Crème nuit'], '', 18, null),
      ('kal-ingredients', 'kalia', '5 ingrédients, rien d''autre', 'Ingrédients naturels', 'Lis la liste d''ingrédients de ta crème', 'Consommatrice clean beauty', 'problem', 'motion', 'loser',
        array['Motion ingrédients'], null, array['Crème nuit'], 'Perdant : hook rate 19 %, les 3 premières secondes n''arrêtent pas le scroll. Angle à retravailler en UGC.', 30, null),
      ('kal-avis', 'kalia', 'Note 4,8 / 5 sur 12 000 avis', 'Preuve sociale', '12 000 femmes ont changé de crème de nuit', 'Débutante skincare', 'product', 'static', 'testing',
        array['Statique avis 4,8'], null, array['Crème nuit'], '', 45, null),
      ('kal-erreurs', 'kalia', '3 erreurs qui ruinent ta routine', 'Routine simplifiée', 'Erreur n°1 : tu mets ton sérum sur une peau sèche', 'Débutante skincare', 'problem', 'ugc', 'testing',
        array['UGC 3 erreurs routine'], null, array['Sérum'], '', 8, 'kal'),
      ('kal-dpa', 'kalia', 'Catalogue dynamique', 'Produit', 'Tes produits vus, avec la livraison offerte', 'Visiteuse qui a vu un produit', 'most', 'dpa', 'testing',
        array['DPA carrousel', 'DPA collection'], null, array['Retargeting'], '', 90, null),
      ('kal-dermato', 'kalia', 'Une dermato répond aux commentaires', 'Expertise', 'Une dermato lit vos commentaires (et elle n''est pas d''accord)', 'Consommatrice clean beauty', 'solution', 'short_video', 'production',
        null, null, array['Expertise'], '', null, 'kal2'),
      ('kal-coffret', 'kalia', 'Unboxing coffret de Noël', 'Cadeau de Noël', 'Le coffret que je m''offre avant de l''offrir', 'Acheteuse cadeau', 'unaware', 'ugc', 'brief',
        null, null, array['Noël'], '', null, 'kal2'),
      ('kal-matin', 'kalia', 'Routine express du matin', 'Routine simplifiée', '2 minutes chrono, café compris', 'Active 30-45 ans, peu de temps', 'solution', 'ugc', 'idea',
        null, null, array['Evergreen'], '', null, 'kal'),
      ('kal-comparatif', 'kalia', 'Crème de pharmacie ou Kalia ?', 'Comparaison', 'J''ai comparé ma crème de pharmacie à 34 € avec celle-ci', 'Peau sèche, 30-45 ans', 'solution', 'static', 'ready',
        null, null, array['Crème nuit'], '', null, 'kal')
    ) as x(key, client, title, angle, hook, persona, awareness, format, status, ads, variants, tags, verdict, launched, task)
  loop
    if (r.client = 'lumen' and c_lumen is null) or (r.client = 'kalia' and c_kalia is null) then continue; end if;
    insert into creative_concepts (workspace_id, company_id, project_id, task_id, title, angle, hook, persona, awareness, format, platforms, status,
                                   brief, tags, verdict, launched_at, owner_id, position, is_demo, created_by, created_at)
    values (ws,
      case r.client when 'lumen' then c_lumen else c_kalia end,
      case r.client when 'lumen' then p_lum else p_kal end,
      case r.task when 'lum' then t_lum when 'kal' then t_kal when 'kal2' then t_kal2 end,
      r.title, r.angle, r.hook, r.persona, r.awareness, r.format, array['meta'], r.status,
      jsonb_build_object(
        'context', case r.client
          when 'lumen' then 'Maison Lumen crée des luminaires design fabriqués en France (panier moyen 180 €). Ton chaleureux, jamais luxe froid. Objectif : ventes en ligne, ROAS cible 3,5.'
          else 'Kalia Cosmetics : cosmétique naturelle en vente directe, formules courtes (5 à 8 ingrédients). Ton complice, preuve avant promesse. Objectif : achats, CPA cible 25 €.' end,
        'script', case when r.format in ('ugc', 'short_video') then
          '0-3 s : ' || r.hook || E'\n3-10 s : le problème vécu, en une phrase, face caméra.\n10-25 s : démonstration du produit en situation réelle (gros plans).\n25-35 s : le résultat, sans exagération.\n35-40 s : appel à l''action.'
          when r.format = 'motion' then E'Plan 1 : accroche en texte animé (' || r.hook || E')\nPlan 2 : produit en rotation lente\nPlan 3 : 3 bénéfices en surimpression\nPlan 4 : logo + offre'
          else 'Accroche : ' || r.hook || E'\nVisuel : produit en situation, lumière naturelle.\nTexte court : un bénéfice, une preuve.' end,
        'shots', case when r.format in ('ugc', 'short_video') then E'Plan face caméra (lumière de fenêtre)\nGros plan produit en main\nPlan d''ambiance (pièce ou salle de bain)\nPlan résultat' else E'Format 4:5 et 9:16\nProduit centré, marge de sécurité de 14 % en haut et en bas' end,
        'instructions', 'Filmer au téléphone, en vertical 9:16, sans filtre. Parler comme à une amie, pas de texte appris par cœur. Livrer 3 prises du hook.',
        'dos', E'Montrer le produit dans les 3 premières secondes\nSous-titres lisibles\nUne seule idée par vidéo',
        'donts', E'Pas de musique sous droits\nPas de promesse médicale ou de « miracle »\nPas de logo concurrent visible',
        'cta', case r.client when 'lumen' then 'Découvre la collection sur maisonlumen.fr' else 'Teste la routine avec -15 % sur ta première commande' end,
        'duration', case when r.format in ('ugc', 'short_video') then '30 à 45 s' when r.format = 'motion' then '10 à 15 s' else '' end),
      r.tags, r.verdict, case when r.launched is not null then current_date - r.launched end, me, (n + 1) * 1000, true, me,
      now() - make_interval(days => coalesce(r.launched, 3) + 4))
    returning id into cid;
    n := n + 1;

    -- variantes
    if r.variants is not null then
      declare vparts text[] := string_to_array(r.variants, ';'); i int := 0;
      begin
        foreach k in array vparts loop
          i := i + 1;
          insert into creative_variants (workspace_id, concept_id, name, hook, position)
          values (ws, cid, split_part(k, '|', 1), split_part(k, '|', 2), i * 1000)
          returning id into vid;
          -- chaque annonce liée est rattachée à la variante de même rang (si elle existe)
          if r.ads is not null and array_length(r.ads, 1) >= i then
            insert into creative_ads (workspace_id, concept_id, variant_id, platform, ad_id)
            select ws, cid, vid, 'meta', a.ad_id from (select distinct x.ad_id from _rows x where x.ad = r.ads[i]) a
            on conflict do nothing;
          end if;
        end loop;
      end;
    end if;
    if r.ads is not null then
      foreach v_ad in array r.ads loop
        insert into creative_ads (workspace_id, concept_id, platform, ad_id)
        select ws, cid, 'meta', x.ad_id from (select distinct y.ad_id from _rows y where y.ad = v_ad) x
        on conflict do nothing;
      end loop;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._demo_creatives(uuid) from anon, authenticated, public;
grant execute on function public._demo_creatives(uuid) to service_role;
grant execute on function public._clear_demo_creatives(uuid) to service_role;

-- Points d'entrée pour l'interface (réservés aux admins de l'espace)
create or replace function public.load_demo_creatives(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_creatives(ws);
end $$;
revoke execute on function public.load_demo_creatives(uuid) from anon, public;
grant execute on function public.load_demo_creatives(uuid) to authenticated;

create or replace function public.clear_demo_creatives(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_creatives(ws);
end $$;
revoke execute on function public.clear_demo_creatives(uuid) from anon, public;
grant execute on function public.clear_demo_creatives(uuid) to authenticated;
