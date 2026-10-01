-- =====================================================================
-- 0095 : analytics de site dans le reporting (Google Analytics 4, Microsoft Clarity)
-- Migration additive : nouvelles tables, une colonne sur reports, fonctions de lecture.
--  - ad_connections accepte la plateforme « ga4 » (même client OAuth Google que
--    Google Ads, scope analytics.readonly) : les jetons restent sans policy client ;
--  - analytics_sources : propriété GA4 ou projet Clarity associé à un client ;
--  - analytics_secrets : jeton API Clarity, sans policy (service role uniquement) ;
--  - ga4_channels_daily, ga4_pages_daily, ga4_dims_daily : métriques GA4 par jour ;
--  - clarity_daily : instantané quotidien Clarity (l'API ne donne aucun historique) ;
--  - reports.sections : sections facultatives d'un rapport (« site », « behavior ») ;
--  - _site_analytics : agrégats d'un client sur une période, partagés par le tableau
--    de bord (site_analytics), le rapport public (public_report), le portail client
--    (portal_site_analytics, portal_report) et le serveur MCP.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Connexions : une connexion Google Analytics est une ligne ad_connections
-- (platform = 'ga4'), listée par la vue ad_connections_public comme les autres.
-- Le cache ad_connections.accounts contient alors les propriétés accessibles.
-- ---------------------------------------------------------------------
alter table public.ad_connections drop constraint if exists ad_connections_platform_check;
alter table public.ad_connections add constraint ad_connections_platform_check
  check (platform in ('meta','google','ga4'));

-- ---------------------------------------------------------------------
-- Sources d'analytics d'un client (une ou plusieurs par client et par outil)
--  ga4     : external_id = identifiant numérique de la propriété, connection_id = connexion Google
--  clarity : external_id = identifiant du projet Clarity (liens vers le tableau de bord)
--  settings : { key_event: nom de l'évènement clé retenu comme conversion (GA4, null = tous),
--               token_exp: expiration du jeton Clarity (lue dans le jeton, non secrète) }
-- ---------------------------------------------------------------------
create table if not exists public.analytics_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  kind text not null check (kind in ('ga4','clarity')),
  connection_id uuid references public.ad_connections(id) on delete set null,
  external_id text not null,
  name text not null default '',
  currency text,
  timezone text,
  settings jsonb not null default '{}'::jsonb,
  first_synced_at timestamptz,
  last_synced_at timestamptz,
  sync_error text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, external_id)
);
create index if not exists analytics_sources_company on public.analytics_sources (company_id, kind);

-- Jeton API Clarity : jamais lisible par le navigateur (RLS sans policy + droits retirés)
create table if not exists public.analytics_secrets (
  source_id uuid primary key references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- GA4 : métriques quotidiennes (écrites par la synchro, service role)
-- ---------------------------------------------------------------------
-- Jour × groupe de canaux × source / medium (principales sources, le reste regroupé en « (autres) »)
create table if not exists public.ga4_channels_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  channel text not null default '',
  source text not null default '',
  medium text not null default '',
  sessions bigint not null default 0,
  users bigint not null default 0,
  new_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_seconds bigint not null default 0,
  key_events numeric(14,2) not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  primary key (source_id, date, channel, source, medium)
);

-- Jour × page de destination (principales pages, le reste en « (autres) »)
create table if not exists public.ga4_pages_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  page text not null,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  key_events numeric(14,2) not null default 0,
  primary key (source_id, date, page)
);

-- Jour × dimension simple : total (value = ''), device, country
create table if not exists public.ga4_dims_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  dim text not null check (dim in ('total','device','country')),
  value text not null default '',
  sessions bigint not null default 0,
  users bigint not null default 0,
  new_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_seconds bigint not null default 0,
  key_events numeric(14,2) not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  pageviews bigint not null default 0,
  primary key (source_id, date, dim, value)
);

-- ---------------------------------------------------------------------
-- Clarity : un instantané par jour.
--  scope = 'page'    : key = URL (sans paramètres), device = appareil
--  scope = 'device'  : key = appareil (totaux exacts par appareil)
--  scope = 'channel' : key = canal d'acquisition
--  *_sessions : sessions concernées par le signal (sessions × pourcentage Clarity) ;
--  les compteurs sans suffixe sont le nombre d'occurrences.
--  window_days > 1 : jour reconstitué à partir d'un agrégat de 2 ou 3 jours (synchro manquée).
-- ---------------------------------------------------------------------
create table if not exists public.clarity_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  scope text not null check (scope in ('page','device','channel')),
  key text not null default '',
  device text not null default '',
  sessions numeric(14,2) not null default 0,
  bot_sessions numeric(14,2) not null default 0,
  users numeric(14,2) not null default 0,
  pages_per_session numeric(10,2),
  scroll_depth numeric(6,2),
  total_time numeric(10,2),
  active_time numeric(10,2),
  dead_clicks numeric(14,2) not null default 0,
  dead_sessions numeric(14,2) not null default 0,
  rage_clicks numeric(14,2) not null default 0,
  rage_sessions numeric(14,2) not null default 0,
  quickbacks numeric(14,2) not null default 0,
  quickback_sessions numeric(14,2) not null default 0,
  excessive_scrolls numeric(14,2) not null default 0,
  excessive_sessions numeric(14,2) not null default 0,
  script_errors numeric(14,2) not null default 0,
  script_error_sessions numeric(14,2) not null default 0,
  error_clicks numeric(14,2) not null default 0,
  error_click_sessions numeric(14,2) not null default 0,
  window_days smallint not null default 1,
  primary key (source_id, date, scope, key, device)
);

create index if not exists ga4_channels_daily_ws on public.ga4_channels_daily (workspace_id, date);
create index if not exists ga4_dims_daily_ws on public.ga4_dims_daily (workspace_id, date);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.analytics_sources enable row level security;
alter table public.analytics_secrets enable row level security;
alter table public.ga4_channels_daily enable row level security;
alter table public.ga4_pages_daily enable row level security;
alter table public.ga4_dims_daily enable row level security;
alter table public.clarity_daily enable row level security;

-- Jetons : aucune policy, et aucun droit de table pour les rôles du navigateur
revoke all on public.analytics_secrets from anon, authenticated;

drop policy if exists "lecture membres" on public.analytics_sources;
drop policy if exists "ajout membres" on public.analytics_sources;
drop policy if exists "modif membres" on public.analytics_sources;
drop policy if exists "suppression membres" on public.analytics_sources;
create policy "lecture membres" on public.analytics_sources for select using (public.is_member(workspace_id));
-- Une propriété GA4 se suit depuis le navigateur (comme un compte publicitaire). Un projet Clarity
-- ne se crée que par la route serveur, qui range son jeton dans analytics_secrets.
create policy "ajout membres" on public.analytics_sources for insert
  with check (public.can_write(workspace_id) and kind = 'ga4' and not is_demo);
create policy "modif membres" on public.analytics_sources for update
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "suppression membres" on public.analytics_sources for delete using (public.can_write(workspace_id));

do $$
declare t text;
begin
  foreach t in array array['ga4_channels_daily','ga4_pages_daily','ga4_dims_daily','clarity_daily'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Rapports : sections facultatives (« site » = trafic du site, « behavior » = comportement)
-- ---------------------------------------------------------------------
alter table public.reports add column if not exists sections text[] not null default '{}';

-- ---------------------------------------------------------------------
-- Agrégats d'un client sur une période (fonction interne, sans contrôle d'accès :
-- jamais exécutable par anon ni authenticated, seulement par les fonctions ci-dessous
-- et par le service role).
--  p_prev_start / p_prev_end : période de comparaison (par défaut, même durée juste avant)
--  p_client : true = version destinée au client final (ni identifiant externe, ni erreur de synchro,
--             ni tracking first-party)
--  p_parts  : parties à calculer ('ga4', 'clarity')
-- ---------------------------------------------------------------------
create or replace function public._site_analytics(
  p_company uuid, p_start date, p_end date,
  p_prev_start date default null, p_prev_end date default null,
  p_client boolean default false, p_parts text[] default array['ga4','clarity']
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ps date; v_pe date;
  g_ids uuid[]; c_ids uuid[];
  ga jsonb := null; cl jsonb := null; fp jsonb := null;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'période invalide' using errcode = '22023';
  end if;
  v_ps := coalesce(p_prev_start, p_start - (p_end - p_start) - 1);
  if v_ps >= p_start or p_start - v_ps > 800 then v_ps := p_start - (p_end - p_start) - 1; end if;
  v_pe := coalesce(p_prev_end, p_start - 1);
  if v_pe >= p_start or v_pe < v_ps then v_pe := p_start - 1; end if;

  if 'ga4' = any(p_parts) then
    select array_agg(s.id) into g_ids from analytics_sources s where s.company_id = p_company and s.kind = 'ga4';
  end if;
  if 'clarity' = any(p_parts) then
    select array_agg(s.id) into c_ids from analytics_sources s where s.company_id = p_company and s.kind = 'clarity';
  end if;

  -- ------------------------------ GA4 ------------------------------
  if g_ids is not null then
    ga := jsonb_build_object(
      'sources', (select jsonb_agg(
          jsonb_build_object('id', s.id, 'name', s.name, 'key_event', s.settings->>'key_event', 'last_synced_at', s.last_synced_at, 'demo', s.is_demo)
          || case when p_client then '{}'::jsonb
                  else jsonb_build_object('external_id', s.external_id, 'sync_error', s.sync_error, 'connected', s.connection_id is not null) end
          order by s.name)
        from analytics_sources s where s.id = any(g_ids)),
      'currency', (select s.currency from analytics_sources s where s.id = any(g_ids) and s.currency is not null order by s.created_at limit 1),
      'synced_at', (select max(s.last_synced_at) from analytics_sources s where s.id = any(g_ids)),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', x.date, 'sessions', x.sessions, 'users', x.users, 'new_users', x.new_users,
            'engaged', x.engaged, 'engagement_s', x.engagement_s, 'key_events', x.key_events, 'purchases', x.purchases,
            'revenue', x.revenue, 'pageviews', x.pageviews) order by x.date)
          from (select t.date, sum(t.sessions) as sessions, sum(t.users) as users, sum(t.new_users) as new_users, sum(t.engaged_sessions) as engaged,
                       sum(t.engagement_seconds) as engagement_s, sum(t.key_events) as key_events, sum(t.purchases) as purchases,
                       sum(t.revenue) as revenue, sum(t.pageviews) as pageviews
                from ga4_dims_daily t
                where t.source_id = any(g_ids) and t.dim = 'total' and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.date) x), '[]'::jsonb),
      'channels', coalesce((select jsonb_agg(jsonb_build_object('channel', x.channel, 'sessions', x.s, 'users', x.u, 'new_users', x.nu, 'engaged', x.e,
            'key_events', x.k, 'purchases', x.p, 'revenue', x.r,
            'prev_sessions', x.ps, 'prev_key_events', x.pk, 'prev_revenue', x.pr) order by x.s desc, x.channel)
          from (select t.channel,
                  coalesce(sum(t.sessions) filter (where t.date between p_start and p_end), 0) as s,
                  coalesce(sum(t.users) filter (where t.date between p_start and p_end), 0) as u,
                  coalesce(sum(t.new_users) filter (where t.date between p_start and p_end), 0) as nu,
                  coalesce(sum(t.engaged_sessions) filter (where t.date between p_start and p_end), 0) as e,
                  coalesce(sum(t.key_events) filter (where t.date between p_start and p_end), 0) as k,
                  coalesce(sum(t.purchases) filter (where t.date between p_start and p_end), 0) as p,
                  coalesce(sum(t.revenue) filter (where t.date between p_start and p_end), 0) as r,
                  coalesce(sum(t.sessions) filter (where t.date between v_ps and v_pe), 0) as ps,
                  coalesce(sum(t.key_events) filter (where t.date between v_ps and v_pe), 0) as pk,
                  coalesce(sum(t.revenue) filter (where t.date between v_ps and v_pe), 0) as pr
                from ga4_channels_daily t
                where t.source_id = any(g_ids) and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.channel) x
          where x.s > 0 or x.ps > 0), '[]'::jsonb),
      'sources_medium', coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'medium', x.medium, 'channel', x.channel, 'sessions', x.s,
            'engaged', x.e, 'key_events', x.k, 'purchases', x.p, 'revenue', x.r, 'prev_sessions', x.ps) order by x.s desc, x.source)
          from (select t.source, t.medium, max(t.channel) as channel,
                  coalesce(sum(t.sessions) filter (where t.date between p_start and p_end), 0) as s,
                  coalesce(sum(t.engaged_sessions) filter (where t.date between p_start and p_end), 0) as e,
                  coalesce(sum(t.key_events) filter (where t.date between p_start and p_end), 0) as k,
                  coalesce(sum(t.purchases) filter (where t.date between p_start and p_end), 0) as p,
                  coalesce(sum(t.revenue) filter (where t.date between p_start and p_end), 0) as r,
                  coalesce(sum(t.sessions) filter (where t.date between v_ps and v_pe), 0) as ps
                from ga4_channels_daily t
                where t.source_id = any(g_ids) and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.source, t.medium
                order by 4 desc limit 30) x
          where x.s > 0), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(jsonb_build_object('page', x.page, 'sessions', x.s, 'engaged', x.e, 'key_events', x.k, 'prev_sessions', x.ps) order by x.s desc, x.page)
          from (select t.page,
                  coalesce(sum(t.sessions) filter (where t.date between p_start and p_end), 0) as s,
                  coalesce(sum(t.engaged_sessions) filter (where t.date between p_start and p_end), 0) as e,
                  coalesce(sum(t.key_events) filter (where t.date between p_start and p_end), 0) as k,
                  coalesce(sum(t.sessions) filter (where t.date between v_ps and v_pe), 0) as ps
                from ga4_pages_daily t
                where t.source_id = any(g_ids) and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.page
                order by 2 desc limit 30) x
          where x.s > 0), '[]'::jsonb),
      'devices', coalesce((select jsonb_agg(jsonb_build_object('device', x.value, 'sessions', x.s, 'users', x.u, 'engaged', x.e, 'key_events', x.k, 'revenue', x.r) order by x.s desc, x.value)
          from (select t.value, sum(t.sessions) as s, sum(t.users) as u, sum(t.engaged_sessions) as e, sum(t.key_events) as k, sum(t.revenue) as r
                from ga4_dims_daily t
                where t.source_id = any(g_ids) and t.dim = 'device' and t.date between p_start and p_end
                group by t.value) x
          where x.s > 0), '[]'::jsonb),
      'countries', coalesce((select jsonb_agg(jsonb_build_object('country', x.value, 'sessions', x.s, 'key_events', x.k, 'revenue', x.r) order by x.s desc, x.value)
          from (select t.value, sum(t.sessions) as s, sum(t.key_events) as k, sum(t.revenue) as r
                from ga4_dims_daily t
                where t.source_id = any(g_ids) and t.dim = 'country' and t.date between p_start and p_end
                group by t.value
                order by 2 desc limit 12) x
          where x.s > 0), '[]'::jsonb)
    );
  end if;

  -- ------------------------------ Clarity ------------------------------
  if c_ids is not null then
    cl := jsonb_build_object(
      'sources', (select jsonb_agg(
          jsonb_build_object('id', s.id, 'name', s.name, 'first_synced_at', s.first_synced_at, 'last_synced_at', s.last_synced_at, 'demo', s.is_demo)
          || case when p_client then '{}'::jsonb else jsonb_build_object('external_id', s.external_id, 'sync_error', s.sync_error) end
          order by s.name)
        from analytics_sources s where s.id = any(c_ids)),
      'first_day', (select min(t.date) from clarity_daily t where t.source_id = any(c_ids)),
      'last_day', (select max(t.date) from clarity_daily t where t.source_id = any(c_ids)),
      'synced_at', (select max(s.last_synced_at) from analytics_sources s where s.id = any(c_ids)),
      'daily', coalesce((select jsonb_agg(to_jsonb(x) order by x.d)
          from (select t.date as d, sum(t.sessions) as sessions, sum(t.users) as users,
                       sum(t.dead_clicks) as dead_clicks, sum(t.dead_sessions) as dead_sessions,
                       sum(t.rage_clicks) as rage_clicks, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickbacks) as quickbacks, sum(t.quickback_sessions) as quickback_sessions,
                       sum(t.excessive_scrolls) as excessive_scrolls, sum(t.excessive_sessions) as excessive_sessions,
                       sum(t.script_errors) as script_errors, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.error_clicks) as error_clicks, sum(t.error_click_sessions) as error_click_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time,
                       sum(t.total_time * t.sessions) / nullif(sum(t.sessions) filter (where t.total_time is not null), 0) as total_time,
                       sum(t.pages_per_session * t.sessions) / nullif(sum(t.sessions) filter (where t.pages_per_session is not null), 0) as pages_per_session,
                       max(t.window_days) as window_days
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'device' and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.date) x), '[]'::jsonb),
      'devices', coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc, x.device)
          from (select t.key as device, sum(t.sessions) as sessions, sum(t.users) as users,
                       sum(t.dead_clicks) as dead_clicks, sum(t.dead_sessions) as dead_sessions,
                       sum(t.rage_clicks) as rage_clicks, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickbacks) as quickbacks, sum(t.quickback_sessions) as quickback_sessions,
                       sum(t.excessive_scrolls) as excessive_scrolls, sum(t.excessive_sessions) as excessive_sessions,
                       sum(t.script_errors) as script_errors, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.error_clicks) as error_clicks, sum(t.error_click_sessions) as error_click_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'device' and t.date between p_start and p_end
                group by t.key) x
          where x.sessions > 0), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc, x.url, x.device)
          from (select t.key as url, t.device, sum(t.sessions) as sessions,
                       sum(t.dead_clicks) as dead_clicks, sum(t.dead_sessions) as dead_sessions,
                       sum(t.rage_clicks) as rage_clicks, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickbacks) as quickbacks, sum(t.quickback_sessions) as quickback_sessions,
                       sum(t.excessive_scrolls) as excessive_scrolls, sum(t.excessive_sessions) as excessive_sessions,
                       sum(t.script_errors) as script_errors, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.error_clicks) as error_clicks, sum(t.error_click_sessions) as error_click_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'page' and t.date between p_start and p_end
                group by t.key, t.device
                order by 3 desc limit 240) x
          where x.sessions > 0), '[]'::jsonb),
      'channels', coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc, x.channel)
          from (select t.key as channel, sum(t.sessions) as sessions,
                       sum(t.dead_sessions) as dead_sessions, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickback_sessions) as quickback_sessions, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'channel' and t.date between p_start and p_end
                group by t.key) x
          where x.sessions > 0), '[]'::jsonb)
    );
  end if;

  -- ------------------------------ Tracking first-party (agence seulement) ------------------------------
  if not p_client and exists (select 1 from tracking_sites s where s.company_id = p_company) then
    select jsonb_build_object(
      'purchases', count(*) filter (where e.type in ('purchase','deal_won')),
      'revenue', coalesce(sum(e.value) filter (where e.type in ('purchase','deal_won')), 0),
      'leads', count(*) filter (where e.type in ('lead','booking')))
    into fp
    from tracking_events e join tracking_sites s on s.id = e.site_id
    where s.company_id = p_company and e.type in ('purchase','deal_won','lead','booking')
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz;
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'prev_start', v_ps, 'prev_end', v_pe),
    'ga4', ga, 'clarity', cl, 'first_party', fp);
end $$;
revoke execute on function public._site_analytics(uuid, date, date, date, date, boolean, text[]) from anon, authenticated, public;
grant execute on function public._site_analytics(uuid, date, date, date, date, boolean, text[]) to service_role;

-- Tableau de bord de l'agence : réservé aux membres de l'espace du client (null sinon)
create or replace function public.site_analytics(p_company uuid, p_start date, p_end date, p_prev_start date default null, p_prev_end date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from companies c where c.id = p_company and public.is_member(c.workspace_id)) then
    return null;
  end if;
  return public._site_analytics(p_company, p_start, p_end, p_prev_start, p_prev_end, false);
end $$;
revoke execute on function public.site_analytics(uuid, date, date, date, date) from anon, public;
grant execute on function public.site_analytics(uuid, date, date, date, date) to authenticated;

-- Reporting global : sessions et évènements clés GA4 par client (security invoker : la RLS s'applique)
create or replace function public.analytics_overview(p_ws uuid, p_start date, p_end date)
returns table (company_id uuid, sessions bigint, key_events numeric, purchases numeric, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select s.company_id, sum(t.sessions)::bigint, sum(t.key_events), sum(t.purchases), sum(t.revenue)
  from ga4_dims_daily t
  join analytics_sources s on s.id = t.source_id
  where t.workspace_id = p_ws and t.dim = 'total' and t.date between p_start and p_end and s.company_id is not null
  group by s.company_id;
$$;
revoke execute on function public.analytics_overview(uuid, date, date) from anon, public;
grant execute on function public.analytics_overview(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Portail client : site (GA4) et comportement (Clarity) de CETTE entreprise.
-- Mêmes règles que les autres fonctions portal_* : contrôle d'accès en tête,
-- agrégats seulement, version « client » (sans identifiant externe ni erreur de synchro).
-- ---------------------------------------------------------------------
create or replace function public.portal_site_analytics(p_company uuid, p_start date, p_end date, p_prev_start date default null, p_prev_end date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'reporting');
  perform public.portal_module_require(p_company, 'reporting');
  return public._site_analytics(p_company, p_start, p_end, p_prev_start, p_prev_end, true);
end $$;
revoke execute on function public.portal_site_analytics(uuid, date, date, date, date) from anon, public;
grant execute on function public.portal_site_analytics(uuid, date, date, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Rapport public : ajoute les sections facultatives. Seules les parties cochées
-- sont calculées et renvoyées (version « client »).
-- ---------------------------------------------------------------------
create or replace function public._report_analytics(p_company uuid, p_start date, p_end date, p_sections text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_sections && array['site','behavior'] then
    public._site_analytics(p_company, p_start, p_end, null, null, true,
      array(select x from unnest(array[case when 'site' = any(p_sections) then 'ga4' end, case when 'behavior' = any(p_sections) then 'clarity' end]) as x where x is not null))
  end;
$$;
revoke execute on function public._report_analytics(uuid, date, date, text[]) from anon, authenticated, public;
grant execute on function public._report_analytics(uuid, date, date, text[]) to service_role;

create or replace function public.public_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r reports; res jsonb;
begin
  select * into r from reports where public_token = p_token and shared;
  if r.id is null then return null; end if;
  select jsonb_build_object(
    'report', to_jsonb(r) - 'public_token' - 'created_by',
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(metric, target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id,
        'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks, 'conversions', m.conversions, 'value', m.conversion_value))
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb),
    'analytics', public._report_analytics(r.company_id, r.period_start, r.period_end, r.sections)
  ) into res;
  return res;
end $$;
grant execute on function public.public_report(text) to anon, authenticated;

-- Rapport publié lu dans le portail : mêmes sections
create or replace function public.portal_report(p_company uuid, p_report uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r reports;
begin
  perform public.portal_require(p_company, 'reporting');
  perform public.portal_module_require(p_company, 'reporting');
  select * into r from reports where id = p_report and company_id = p_company and shared;
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'report', jsonb_build_object('id', r.id, 'company_id', r.company_id, 'title', r.title, 'period_start', r.period_start,
      'period_end', r.period_end, 'commentary', r.commentary, 'next_steps', r.next_steps, 'shared', r.shared, 'created_at', r.created_at,
      'sections', r.sections),
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(k.metric, k.target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id, 'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks,
        'conversions', m.conversions, 'value', m.conversion_value) order by m.date)
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb),
    'analytics', public._report_analytics(r.company_id, r.period_start, r.period_end, r.sections)
  );
end $$;
revoke execute on function public.portal_report(uuid, uuid) from anon, public;
grant execute on function public.portal_report(uuid, uuid) to authenticated;

-- =====================================================================
-- Données de démo : une propriété GA4 et un projet Clarity fictifs pour
-- Maison Lumen et Kalia Cosmetics.
--  - GA4 : 90 jours, jusqu'au dernier jour des campagnes de démo. Les canaux payants les suivent
--    (sessions Paid Social = part des clics Meta du jour, achats = part des
--    conversions déclarées par Meta), les autres canaux ont un volume propre.
--  - Clarity : 30 jours, avec deux pages à problèmes par site (clics de rage
--    sur mobile au panier ou au paiement, clics morts sur une fiche produit).
-- Tout est écrit en SQL ensembliste : un seul appel, bien sous les 8 s de l'API.
-- =====================================================================
create or replace function public._clear_demo_analytics(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from analytics_sources where workspace_id = ws and is_demo;
  update reports set sections = '{}'
  where workspace_id = ws and title = 'Rapport mensuel · Maison Lumen' and sections <> '{}'
    and not exists (select 1 from analytics_sources s where s.company_id = reports.company_id);
end $$;
revoke execute on function public._clear_demo_analytics(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_analytics(uuid) to service_role;

create or replace function public._demo_analytics(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  cfg record; comp uuid; g uuid; c uuid; n int := 0; anchor date;
begin
  perform _clear_demo_analytics(ws);
  -- Dernier jour des campagnes de démo : les données de site s'arrêtent le même jour qu'elles
  select coalesce(max(m.date), current_date - 1) into anchor
  from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
  where a.workspace_id = ws and a.external_id like 'demo-%';
  for cfg in
    select * from (values
      ('Maison Lumen', 'lumen', 'maisonlumen.fr', 226.0, 1.0,
        array['/', '/collections/suspensions', '/produits/suspension-opale', '/collections/lampadaires', '/produits/lampadaire-arc', '/blog/eclairer-un-salon', '/panier', '/checkout'],
        '/panier', '/produits/lampadaire-arc'),
      ('Kalia Cosmetics', 'kalia', 'kalia-cosmetics.com', 145.0, 0.85,
        array['/', '/collections/soins-visage', '/produits/serum-eclat', '/produits/creme-nuit-reparatrice', '/blog/routine-peau-seche', '/pages/diagnostic-peau', '/panier', '/checkout'],
        '/checkout', '/produits/serum-eclat')
    ) as x(company, slug, domain, aov, vol, pages, rage_page, dead_page)
  loop
    select co.id into comp from companies co where co.workspace_id = ws and co.name = cfg.company limit 1;
    if comp is null then continue; end if;

    insert into analytics_sources (workspace_id, company_id, kind, external_id, name, currency, timezone, settings, first_synced_at, last_synced_at, is_demo)
    values (ws, comp, 'ga4', 'demo-ga4-' || cfg.slug, cfg.domain || ' (GA4)', 'EUR', 'Europe/Paris', '{"key_event": "purchase"}'::jsonb, (anchor - 89)::timestamptz, (anchor + 1)::timestamptz + interval '5 hours', true)
    returning id into g;
    insert into analytics_sources (workspace_id, company_id, kind, external_id, name, settings, first_synced_at, last_synced_at, is_demo)
    values (ws, comp, 'clarity', 'demo-clarity-' || cfg.slug, cfg.domain, '{}'::jsonb, (anchor - 29)::timestamptz, (anchor + 1)::timestamptz + interval '5 hours', true)
    returning id into c;
    n := n + 2;

    -- ---------- GA4 : jour × canal × source / medium ----------
    insert into ga4_channels_daily (source_id, workspace_id, date, channel, source, medium, sessions, users, new_users, engaged_sessions, engagement_seconds, key_events, purchases, revenue)
    with days as (
      select d::date as date, (anchor - d::date) as ago
      from generate_series(anchor - 89, anchor, interval '1 day') d
    ),
    ads as (
      -- clics et conversions Meta du jour pour ce client (campagnes de démo)
      select m.date, sum(m.clicks)::numeric as clicks, sum(m.conversions) as conv
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.workspace_id = ws and a.company_id = comp and a.platform = 'meta'
      group by m.date
    ),
    ch as (
      select * from (values
        -- canal, source, medium, part des clics Meta, sessions de base, part des conversions Meta, taux de conversion propre, engagement, nouveaux, secondes par session engagée
        ('Paid Social', 'facebook', 'paid', 0.58, 0.0, 0.52, 0.0, 0.44, 0.80, 52),
        ('Paid Social', 'instagram', 'paid', 0.24, 0.0, 0.20, 0.0, 0.41, 0.84, 47),
        ('Paid Search', 'google', 'cpc', 0.0, 22.0, 0.0, 0.031, 0.66, 0.52, 78),
        ('Organic Search', 'google', 'organic', 0.0, 96.0, 0.0, 0.017, 0.69, 0.61, 96),
        ('Organic Search', 'bing', 'organic', 0.0, 9.0, 0.0, 0.014, 0.66, 0.63, 88),
        ('Direct', '(direct)', '(none)', 0.0, 58.0, 0.0, 0.024, 0.60, 0.38, 84),
        ('Email', 'klaviyo', 'email', 0.0, 24.0, 0.0, 0.038, 0.74, 0.08, 102),
        ('Organic Social', 'instagram', 'social', 0.0, 19.0, 0.0, 0.006, 0.47, 0.58, 49),
        ('Organic Social', 'pinterest', 'social', 0.0, 8.0, 0.0, 0.004, 0.43, 0.77, 41),
        ('Referral', 'elle.fr', 'referral', 0.0, 6.0, 0.0, 0.011, 0.63, 0.82, 71),
        ('Unassigned', '(not set)', '(not set)', 0.0, 3.0, 0.0, 0.0, 0.30, 0.70, 30)
      ) as x(channel, source, medium, click_share, base, conv_share, cr, eng, newu, secs)
    ),
    raw as (
      select d.date, ch.*,
        0.82 + 0.36 * ((hashtext(ch.source || ch.medium || d.date::text) & 1023) / 1023.0) as noise,
        0.85 + 0.30 * ((hashtext(d.date::text || ch.source) & 255) / 255.0) as noise2,
        case when extract(isodow from d.date) in (6, 7) then 0.86 else 1.0 end as wk,
        -- newsletter le mardi et le jeudi
        case when ch.channel = 'Email' and extract(isodow from d.date) in (2, 4) then 3.2 else 1.0 end as mail,
        1 + (89 - d.ago) * 0.0025 as trend,
        coalesce(a.clicks, 0) as clicks, coalesce(a.conv, 0) as conv
      from days d cross join ch left join ads a on a.date = d.date
    ),
    s as (
      select r.*,
        greatest(0, round(case when r.click_share > 0 then r.clicks * r.click_share * (0.94 + 0.12 * (r.noise - 0.82) / 0.36)
                               else r.base * cfg.vol * r.noise * r.wk * r.mail * r.trend end))::bigint as sessions
      from raw r
    ),
    k as (
      select s.*,
        round((case when s.conv_share > 0 then s.conv * s.conv_share * s.noise2 else s.sessions * s.cr * s.noise2 end)::numeric)::numeric as purchases
      from s
    )
    select g, ws, k.date, k.channel, k.source, k.medium, k.sessions,
      round(k.sessions * 0.88)::bigint, round(k.sessions * 0.88 * k.newu)::bigint,
      round(k.sessions * k.eng * (0.95 + 0.1 * (k.noise2 - 0.85) / 0.3))::bigint,
      round(k.sessions * k.eng * k.secs)::bigint,
      k.purchases, k.purchases,
      round((k.purchases * cfg.aov * (0.88 + 0.24 * ((hashtext(k.source || k.date::text) & 255) / 255.0)))::numeric, 2)
    from k where k.sessions > 0;

    -- ---------- GA4 : totaux du jour, appareils et pays (dérivés des canaux) ----------
    insert into ga4_dims_daily (source_id, workspace_id, date, dim, value, sessions, users, new_users, engaged_sessions, engagement_seconds, key_events, purchases, revenue, pageviews)
    with t as (
      select date, sum(sessions) as sessions, sum(users) as users, sum(new_users) as new_users, sum(engaged_sessions) as engaged,
             sum(engagement_seconds) as secs, sum(key_events) as k, sum(revenue) as r
      from ga4_channels_daily where source_id = g group by date
    ),
    dims as (
      select * from (values
        -- dimension, valeur, part des sessions, part des achats, part du revenu, engagement relatif
        ('total', '', 1.0, 1.0, 1.0, 1.0),
        ('device', 'mobile', 0.72, 0.55, 0.50, 0.94),
        ('device', 'desktop', 0.24, 0.41, 0.46, 1.17),
        ('device', 'tablet', 0.04, 0.04, 0.04, 1.02),
        ('country', 'France', 0.87, 0.90, 0.90, 1.0),
        ('country', 'Belgium', 0.06, 0.05, 0.05, 1.0),
        ('country', 'Switzerland', 0.04, 0.03, 0.04, 1.0),
        ('country', 'Canada', 0.02, 0.01, 0.01, 1.0),
        ('country', 'Luxembourg', 0.01, 0.01, 0.0, 1.0)
      ) as x(dim, value, sh, ksh, rsh, engf)
    )
    select g, ws, t.date, dims.dim, dims.value,
      round(t.sessions * dims.sh)::bigint,
      round(t.users * dims.sh * (case when dims.dim = 'total' then 0.97 else 1 end))::bigint,
      round(t.new_users * dims.sh)::bigint,
      least(round(t.sessions * dims.sh), round(t.engaged * dims.sh * dims.engf))::bigint,
      round(t.secs * dims.sh * dims.engf)::bigint,
      round(t.k * dims.ksh), round(t.k * dims.ksh), round((t.r * dims.rsh)::numeric, 2),
      round(t.sessions * dims.sh * (case when dims.value = 'desktop' then 3.1 else 2.3 end))::bigint
    from t cross join dims;

    -- ---------- GA4 : pages de destination ----------
    insert into ga4_pages_daily (source_id, workspace_id, date, page, sessions, engaged_sessions, key_events)
    with t as (
      select date, sessions, key_events from ga4_dims_daily where source_id = g and dim = 'total'
    ),
    pg as (
      select * from (values (1, 0.24, 0.55, 0.14), (2, 0.19, 0.61, 0.20), (3, 0.21, 0.52, 0.36), (4, 0.09, 0.60, 0.08),
                            (5, 0.12, 0.49, 0.16), (6, 0.07, 0.72, 0.02), (7, 0.02, 0.81, 0.03), (8, 0.01, 0.88, 0.01)) as x(i, sh, eng, ksh)
    )
    select g, ws, y.date, y.page, y.sessions, round(y.sessions * y.eng)::bigint, round(y.key_events * y.ksh)
    from (
      select t.date, cfg.pages[pg.i] as page,
        round(t.sessions * pg.sh * (0.9 + 0.2 * ((hashtext(t.date::text || pg.i::text) & 255) / 255.0)))::bigint as sessions,
        pg.eng, pg.ksh, t.key_events
      from t cross join pg
    ) y
    union all
    select g, ws, t.date, '(autres)', round(t.sessions * 0.05)::bigint, round(t.sessions * 0.05 * 0.5)::bigint, 0
    from t;

    -- ---------- Clarity : 30 jours, pages × appareil ----------
    insert into clarity_daily (source_id, workspace_id, date, scope, key, device, sessions, bot_sessions, users, pages_per_session, scroll_depth, total_time, active_time,
      dead_clicks, dead_sessions, rage_clicks, rage_sessions, quickbacks, quickback_sessions, excessive_scrolls, excessive_sessions,
      script_errors, script_error_sessions, error_clicks, error_click_sessions)
    with t as (
      -- Clarity voit un peu moins de sessions que GA4 (consentement, bloqueurs)
      select date, sessions * 0.93 as sessions from ga4_dims_daily where source_id = g and dim = 'total' and date > anchor - 30
    ),
    pg as (
      -- page, part des sessions (pages vues, pas seulement les arrivées), profondeur de défilement, temps actif
      select * from (values (1, 0.26, 47.0, 38.0), (2, 0.22, 58.0, 55.0), (3, 0.24, 63.0, 71.0), (4, 0.11, 56.0, 49.0),
                            (5, 0.15, 61.0, 66.0), (6, 0.07, 72.0, 118.0), (7, 0.13, 78.0, 44.0), (8, 0.08, 86.0, 97.0)) as x(i, sh, scroll, active)
    ),
    dv as (
      select * from (values ('Mobile', 0.71, -5.0, 0.86), ('PC', 0.25, 4.0, 1.25), ('Tablet', 0.04, 0.0, 1.05)) as x(device, sh, dscroll, tf)
    ),
    base as (
      select t.date, cfg.pages[pg.i] as page, dv.device,
        round(t.sessions * pg.sh * dv.sh * (0.88 + 0.24 * ((hashtext(t.date::text || pg.i::text || dv.device) & 255) / 255.0))) as sessions,
        pg.scroll + dv.dscroll as scroll, pg.active * dv.tf as active,
        0.8 + 0.4 * ((hashtext(dv.device || pg.i::text || t.date::text) & 255) / 255.0) as nz,
        -- tirages stables entre 0 et 1 : arrondi aléatoire des petits volumes (sinon tout tombe à zéro)
        (hashtext('a' || t.date::text || pg.i::text || dv.device) & 255) / 256.0 as u1,
        (hashtext('b' || t.date::text || pg.i::text || dv.device) & 255) / 256.0 as u2
      from t cross join pg cross join dv
    ),
    r as (
      select b.*,
        -- taux de sessions touchées : base du site, puis les deux pages à problèmes
        (case when b.page = cfg.rage_page and b.device = 'Mobile' then 0.094 when b.page = cfg.rage_page then 0.016 else 0.005 end) * b.nz as rage,
        (case when b.page = cfg.dead_page then (case when b.device = 'PC' then 0.118 else 0.171 end) else 0.041 end) * b.nz as dead,
        (case when b.page = cfg.dead_page then 0.071 when b.page = '/' then 0.046 else 0.027 end) * b.nz as quick,
        (case when b.page like '/blog/%' then 0.031 else 0.011 end) * b.nz as exc,
        (case when b.page = cfg.rage_page then 0.052 else 0.012 end) * b.nz as serr,
        (case when b.page = cfg.rage_page then 0.021 else 0.003 end) * b.nz as eclk
      from base b
    )
    select c, ws, r.date, 'page', 'https://' || cfg.domain || r.page, r.device, r.sessions, round(r.sessions * 0.04), round(r.sessions * 0.9),
      round((1.6 + 0.9 * r.nz)::numeric, 2), round(r.scroll::numeric, 1), round((r.active * 1.9)::numeric), round(r.active::numeric),
      round(floor(r.sessions * r.dead + r.u1) * 1.7), floor(r.sessions * r.dead + r.u1),
      round(floor(r.sessions * r.rage + r.u2) * 2.6), floor(r.sessions * r.rage + r.u2),
      round(floor(r.sessions * r.quick + r.u2) * 1.1), floor(r.sessions * r.quick + r.u2),
      floor(r.sessions * r.exc + r.u1), floor(r.sessions * r.exc + r.u1),
      round(floor(r.sessions * r.serr + r.u1) * 1.4), floor(r.sessions * r.serr + r.u1),
      round(floor(r.sessions * r.eclk + r.u2) * 1.2), floor(r.sessions * r.eclk + r.u2)
    from r where r.sessions > 0;

    -- Clarity : totaux par appareil (somme des pages, une session visitant en moyenne 1,26 page suivie)
    insert into clarity_daily (source_id, workspace_id, date, scope, key, device, sessions, bot_sessions, users, pages_per_session, scroll_depth, total_time, active_time,
      dead_clicks, dead_sessions, rage_clicks, rage_sessions, quickbacks, quickback_sessions, excessive_scrolls, excessive_sessions,
      script_errors, script_error_sessions, error_clicks, error_click_sessions)
    select c, ws, p.date, 'device', p.device, '', round(sum(p.sessions) / 1.26), round(sum(p.bot_sessions) / 1.26), round(sum(p.users) / 1.26),
      round((sum(p.pages_per_session * p.sessions) / nullif(sum(p.sessions), 0))::numeric, 2),
      round((sum(p.scroll_depth * p.sessions) / nullif(sum(p.sessions), 0))::numeric, 1),
      round((sum(p.total_time * p.sessions) / nullif(sum(p.sessions), 0))::numeric), round((sum(p.active_time * p.sessions) / nullif(sum(p.sessions), 0))::numeric),
      sum(p.dead_clicks), round(sum(p.dead_sessions) * 0.9), sum(p.rage_clicks), round(sum(p.rage_sessions) * 0.95),
      sum(p.quickbacks), round(sum(p.quickback_sessions) * 0.9), sum(p.excessive_scrolls), round(sum(p.excessive_sessions) * 0.95),
      sum(p.script_errors), round(sum(p.script_error_sessions) * 0.9), sum(p.error_clicks), round(sum(p.error_click_sessions) * 0.95)
    from clarity_daily p where p.source_id = c and p.scope = 'page'
    group by p.date, p.device;

    -- Clarity : par canal (le trafic payant social revient plus vite en arrière)
    insert into clarity_daily (source_id, workspace_id, date, scope, key, device, sessions, users, scroll_depth, active_time,
      dead_sessions, rage_sessions, quickback_sessions, script_error_sessions)
    with t as (
      select date, sum(sessions) as sessions, sum(dead_sessions) as dead, sum(rage_sessions) as rage, sum(quickback_sessions) as quick, sum(script_error_sessions) as serr,
             sum(scroll_depth * sessions) / nullif(sum(sessions), 0) as scroll, sum(active_time * sessions) / nullif(sum(sessions), 0) as active
      from clarity_daily where source_id = c and scope = 'device' group by date
    ),
    ch as (
      select * from (values ('PaidSocial', 0.52, 1.45, 0.78), ('OrganicSearch', 0.21, 0.62, 1.22), ('Direct', 0.12, 0.70, 1.18),
                            ('Email', 0.06, 0.48, 1.35), ('Social', 0.05, 1.10, 0.85), ('PaidSearch', 0.03, 0.80, 1.10), ('Referral', 0.01, 0.90, 1.00)) as x(channel, sh, qf, ef)
    )
    select c, ws, t.date, 'channel', ch.channel, '', round(t.sessions * ch.sh), round(t.sessions * ch.sh * 0.9),
      round((t.scroll * (0.75 + 0.25 * ch.ef))::numeric, 1), round((t.active * ch.ef)::numeric),
      round(t.dead * ch.sh), round(t.rage * ch.sh), round(t.quick * ch.sh * ch.qf), round(t.serr * ch.sh)
    from t cross join ch;
  end loop;

  -- Le rapport mensuel de démo affiche les deux nouvelles sections
  update reports set sections = array['site', 'behavior']
  where workspace_id = ws and title = 'Rapport mensuel · Maison Lumen' and sections = '{}';
  return n;
end $$;
revoke execute on function public._demo_analytics(uuid) from anon, authenticated, public;
grant execute on function public._demo_analytics(uuid) to service_role;

-- Points d'entrée pour l'interface (réservés aux admins de l'espace)
create or replace function public.load_demo_analytics(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_analytics(ws);
end $$;
revoke execute on function public.load_demo_analytics(uuid) from anon, public;
grant execute on function public.load_demo_analytics(uuid) to authenticated;

create or replace function public.clear_demo_analytics(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_analytics(ws);
end $$;
revoke execute on function public.clear_demo_analytics(uuid) from anon, public;
grant execute on function public.clear_demo_analytics(uuid) to authenticated;
