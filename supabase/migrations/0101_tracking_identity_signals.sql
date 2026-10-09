-- =====================================================================
-- Tracking OS, étape 2 : identité par email ET téléphone, signaux pour le
-- renvoi aux régies.
--
-- 1. visitors.person_id : une personne = tous les visiteurs reliés par un
--    même email ou un même téléphone (un appareil, puis un autre, puis un
--    autre email avec le même numéro). Jusqu'ici la fusion se faisait à la
--    lecture, par email seulement.
-- 2. visitor_signals : ce que Meta et Google demandent pour rapprocher une
--    conversion d'un clic (cookies _fbp / _fbc / _ga, adresse IP et
--    navigateur de la visite). Aucune policy : service role seulement.
--    L'IP est effacée après 30 jours.
-- 3. Les fonctions de lecture regroupent par personne.
-- Rejouable.
-- =====================================================================

alter table public.visitors add column if not exists person_id uuid;
-- Téléphone au format international sans « + » (33612345678), pour le rapprochement
alter table public.visitors add column if not exists phone_e164 text;
create index if not exists visitors_site_person on public.visitors (site_id, person_id) where person_id is not null;
create index if not exists visitors_site_phone on public.visitors (site_id, phone_e164) where phone_e164 is not null;

-- Visiteurs déjà identifiés : une personne par email, comme le faisait la lecture.
with p as (
  select v.site_id, v.email, gen_random_uuid() as pid
  from public.visitors v
  where v.email is not null
  group by v.site_id, v.email
  having bool_and(v.person_id is null)
)
update public.visitors v set person_id = p.pid
from p where v.site_id = p.site_id and v.email = p.email;

-- ---------------------------------------------------------------------
-- Rattache un visiteur à sa personne. Si l'email et le téléphone désignent
-- deux personnes jusque-là distinctes, elles fusionnent : la plus ancienne
-- garde son identifiant. is_new dit si la personne vient d'apparaître.
-- ---------------------------------------------------------------------
create or replace function public.tracking_link_person(p_visitor uuid, p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v visitors;
  known uuid[];
  pid uuid;
begin
  -- Chaîne vide = inconnu (l'appelant n'a pas toujours les deux)
  p_email := nullif(p_email, '');
  p_phone := nullif(p_phone, '');
  select * into v from visitors where id = p_visitor for update;
  if v.id is null then return null; end if;

  select array_agg(distinct x.person_id) into known
  from (
    select o.person_id from visitors o
    where o.site_id = v.site_id and o.person_id is not null
      and ((p_email is not null and o.email = p_email) or (p_phone is not null and o.phone_e164 = p_phone))
    union
    select v.person_id where v.person_id is not null
  ) x;

  if known is null then
    pid := gen_random_uuid();
    update visitors set person_id = pid where id = p_visitor;
    return jsonb_build_object('person_id', pid, 'is_new', true);
  end if;

  select o.person_id into pid from visitors o
  where o.site_id = v.site_id and o.person_id = any(known)
  order by coalesce(o.identified_at, o.first_seen), o.id limit 1;
  pid := coalesce(pid, known[1]);
  update visitors set person_id = pid where site_id = v.site_id and person_id = any(known) and person_id <> pid;
  update visitors set person_id = pid where id = p_visitor and person_id is distinct from pid;
  return jsonb_build_object('person_id', pid, 'is_new', false);
end $$;
revoke execute on function public.tracking_link_person(uuid, text, text) from anon, authenticated, public;
grant execute on function public.tracking_link_person(uuid, text, text) to service_role;

-- Filet pour les écritures qui ne passent pas par tracking_link_person (données de
-- démo, modules voisins) : un visiteur qui reçoit un email rejoint la personne de cet email.
create or replace function public._visitor_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.person_id is null then
    select o.person_id into new.person_id from visitors o
    where o.site_id = new.site_id and o.email = new.email and o.person_id is not null limit 1;
    new.person_id := coalesce(new.person_id, gen_random_uuid());
  end if;
  return new;
end $$;
revoke execute on function public._visitor_person() from anon, authenticated, public;
drop trigger if exists visitor_person on public.visitors;
create trigger visitor_person before insert or update of email on public.visitors
  for each row execute function public._visitor_person();

-- ---------------------------------------------------------------------
-- Signaux publicitaires d'un visiteur
-- ---------------------------------------------------------------------
create table if not exists public.visitor_signals (
  visitor_id uuid primary key references public.visitors(id) on delete cascade,
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fbp text,
  fbc text,
  ga_cid text,
  ip inet,
  ua text,
  seen_at timestamptz not null default now()
);
create index if not exists visitor_signals_ip_age on public.visitor_signals (seen_at) where ip is not null;
-- Aucune policy : ni lecture ni écriture hors service role
alter table public.visitor_signals enable row level security;
revoke all on public.visitor_signals from anon, authenticated;

create or replace function public.tracking_purge_signals()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update visitor_signals set ip = null where ip is not null and seen_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.tracking_purge_signals() from anon, authenticated, public;
grant execute on function public.tracking_purge_signals() to service_role;

-- ---------------------------------------------------------------------
-- Conversions d'une période avec les points de contact de la PERSONNE
-- (tous ses visiteurs, reliés par email ou téléphone) dans la fenêtre.
-- Pour le site de l'agence (company_id null), les deals gagnés du CRM dont
-- le contact a l'email d'un visiteur comptent comme conversion « deal_won ».
-- ---------------------------------------------------------------------
create or replace function public.tracking_conversions(p_site uuid, p_start date, p_end date, p_window int default 30, p_types text[] default null)
returns table (
  id text, ts timestamptz, type text, name text, value numeric, currency text, source text,
  person text, email text, visitor_id uuid, touches jsonb
)
language sql stable security definer set search_path = public as $$
  with site as (
    select s.id, s.workspace_id, s.company_id from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id)
  ),
  conv as (
    select e.id::text as id, e.ts, e.type, e.name, coalesce(e.value, 0) as value, e.currency, e.source, e.visitor_id
    from tracking_events e
    where e.site_id = p_site and e.type <> 'pageview'
      and exists (select 1 from site)
      and (p_types is null or e.type = any(p_types))
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz
    union all
    select 'deal:' || d.id::text, d.closed_at, 'deal_won', d.title, d.value, null, 'crm',
           (select vv.id from visitors vv where vv.site_id = p_site and vv.email = lower(c.email) order by vv.last_seen desc limit 1)
    from deals d
    join site on site.company_id is null and d.workspace_id = site.workspace_id
    join pipeline_stages st on st.id = d.stage_id and st.kind = 'won'
    join contacts c on c.id = d.contact_id
    where (p_types is null or 'deal_won' = any(p_types))
      and d.closed_at >= p_start::timestamptz and d.closed_at < (p_end + 1)::timestamptz
      and c.email <> ''
      and exists (select 1 from visitors vv where vv.site_id = p_site and vv.email = lower(c.email))
      -- pas de doublon si le deal a déjà été envoyé par l'API
      and not exists (select 1 from tracking_events x where x.site_id = p_site and x.type = 'deal_won' and x.order_id = d.id::text)
  ),
  pc as (
    select c.*, v.person_id,
           case when v.person_id is null then array[c.visitor_id]
                else (select array_agg(vv.id) from visitors vv where vv.site_id = p_site and vv.person_id = v.person_id) end as vids
    from conv c
    left join visitors v on v.id = c.visitor_id
  )
  select c.id, c.ts, c.type, c.name, c.value, c.currency, c.source,
         coalesce(c.person_id::text, c.visitor_id::text, c.id) as person,
         (select vv.email from visitors vv where vv.id = any(c.vids) and vv.email is not null order by vv.identified_at desc nulls last limit 1) as email,
         c.visitor_id,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'ts', t.ts, 'channel', t.channel, 'platform', t.platform,
             'source', t.utm_source, 'medium', t.utm_medium, 'campaign', t.utm_campaign, 'content', t.utm_content, 'term', t.utm_term,
             'campaign_key', t.campaign_key, 'adset_key', t.adset_key, 'ad_key', t.ad_key, 'link_id', t.link_id,
             'landing_url', left(t.landing_url, 300), 'referrer', left(t.referrer, 200)
           ) order by t.ts)
           from touchpoints t
           where t.visitor_id = any(c.vids)
             and t.ts <= c.ts and t.ts > c.ts - make_interval(days => greatest(1, least(p_window, 365)))
         ), '[]'::jsonb) as touches
  from pc c
  order by c.ts, c.id;
$$;

-- ---------------------------------------------------------------------
-- Statistiques de trafic : les identifiés et les prospects se comptent par personne.
-- ---------------------------------------------------------------------
create or replace function public.tracking_stats(p_site uuid, p_start date, p_end date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id)) then null else jsonb_build_object(
    'visitors', (select count(distinct t.visitor_id) from touchpoints t
                 where t.site_id = p_site and t.ts >= p_start::timestamptz and t.ts < (p_end + 1)::timestamptz),
    'identified', (select count(*) from (
                     select v.person_id from visitors v where v.site_id = p_site and v.person_id is not null
                     group by v.person_id
                     having min(v.identified_at) >= p_start::timestamptz and min(v.identified_at) < (p_end + 1)::timestamptz) x),
    'leads', (select count(distinct coalesce(v.person_id::text, e.visitor_id::text)) from tracking_events e left join visitors v on v.id = e.visitor_id
              where e.site_id = p_site and e.type in ('lead', 'booking') and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz),
    'pageviews', (select count(*) from tracking_events e
                  where e.site_id = p_site and e.type = 'pageview' and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', x.d, 'v', x.v) order by x.d) from (
                select (t.ts at time zone 'UTC')::date as d, count(distinct t.visitor_id) as v
                from touchpoints t
                where t.site_id = p_site and t.ts >= p_start::timestamptz and t.ts < (p_end + 1)::timestamptz
                group by 1) x), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------
-- Personnes identifiées d'un site, avec leurs achats. Une personne peut
-- n'avoir qu'un téléphone (conversion envoyée par un CRM sans email).
-- ---------------------------------------------------------------------
drop function if exists public.tracking_people(uuid, text, int);
create or replace function public.tracking_people(p_site uuid, p_q text default '', p_limit int default 100)
returns table (
  person_id uuid, email text, name text, phone text, visitors int, contact_id uuid,
  first_seen timestamptz, last_seen timestamptz, identified_at timestamptz,
  purchases int, revenue numeric, leads int
)
language sql stable security definer set search_path = public as $$
  with g as (
    select v.person_id,
           (array_agg(v.email order by v.identified_at desc nulls last) filter (where v.email is not null))[1] as email,
           max(v.name) as name, max(v.phone) as phone, count(*)::int as visitors,
           (array_agg(v.contact_id) filter (where v.contact_id is not null))[1] as contact_id,
           min(v.first_seen) as first_seen, max(v.last_seen) as last_seen, min(v.identified_at) as identified_at,
           array_agg(v.id) as ids
    from visitors v
    where v.site_id = p_site and v.person_id is not null
      and exists (select 1 from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id))
    group by v.person_id
    having coalesce(p_q, '') = ''
        or bool_or(v.email ilike '%' || p_q || '%' or v.name ilike '%' || p_q || '%' or v.phone ilike '%' || p_q || '%')
    order by max(v.last_seen) desc
    limit greatest(1, least(p_limit, 500))
  )
  select g.person_id, g.email, g.name, g.phone, g.visitors, g.contact_id, g.first_seen, g.last_seen, g.identified_at,
         (select count(*)::int from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('purchase', 'deal_won')),
         (select coalesce(sum(e.value), 0) from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('purchase', 'deal_won')),
         (select count(*)::int from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('lead', 'booking'))
  from g
  order by g.last_seen desc;
$$;
grant execute on function public.tracking_people(uuid, text, int) to authenticated;
revoke execute on function public.tracking_people(uuid, text, int) from anon, public;
