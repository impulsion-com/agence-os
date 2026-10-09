-- =====================================================================
-- Tracking OS, étape 4 : fiche d'une personne et couverture de l'attribution.
--
-- 1. tracking_funnel compte aussi, par étape, les conversions rattachées à
--    une source (au moins un point de contact non direct dans la fenêtre).
--    C'est le chiffre qui dit si l'on peut se fier au reste : une attribution
--    qui ne couvre que 15 % des ventes ne décrit pas les ventes.
-- 2. tracking_person : tout ce que l'on sait d'une personne sur un site.
-- Rejouable.
-- =====================================================================

drop function if exists public.tracking_funnel(uuid, date, date);
drop function if exists public.tracking_funnel(uuid, date, date, int);
create or replace function public.tracking_funnel(p_site uuid, p_start date, p_end date, p_window int default 30)
returns table (stage_id uuid, type text, events int, people int, value numeric, sourced int)
language sql stable set search_path = public as $$
  with c as (
    select x.type, x.person, x.value,
           exists (select 1 from jsonb_array_elements(x.touches) t where coalesce(t->>'channel', 'direct') <> 'direct') as sourced
    from public.tracking_conversions(p_site, p_start, p_end, p_window, null) x
  )
  select s.id, null::text, count(c.type)::int, count(distinct c.person)::int, coalesce(sum(c.value), 0),
         (count(*) filter (where c.sourced))::int
  from tracking_stages s
  left join c on c.type = s.key or c.type = any(s.aliases)
  where s.site_id = p_site
  group by s.id
  union all
  select null::uuid, c.type, count(*)::int, count(distinct c.person)::int, coalesce(sum(c.value), 0),
         (count(*) filter (where c.sourced))::int
  from c
  where not exists (select 1 from tracking_stages s where s.site_id = p_site and (c.type = s.key or c.type = any(s.aliases)))
  group by c.type;
$$;
revoke execute on function public.tracking_funnel(uuid, date, date, int) from anon, public;
grant execute on function public.tracking_funnel(uuid, date, date, int) to authenticated;

-- ---------------------------------------------------------------------
-- Fiche d'une personne : identités, appareils, points de contact et
-- évènements (hors pages vues), les plus récents d'abord, 300 au plus.
-- ---------------------------------------------------------------------
create or replace function public.tracking_person(p_site uuid, p_person uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with site as (
    select s.id from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id)
  ),
  v as (
    select vv.* from visitors vv where vv.site_id = p_site and vv.person_id = p_person and exists (select 1 from site)
  )
  select case when not exists (select 1 from v) then null else jsonb_build_object(
    'person_id', p_person,
    'name', (select max(name) from v),
    'emails', coalesce((select jsonb_agg(distinct email) from v where email is not null), '[]'::jsonb),
    'phones', coalesce((select jsonb_agg(distinct phone) from v where phone is not null and phone <> ''), '[]'::jsonb),
    'contact_id', (select (array_agg(contact_id) filter (where contact_id is not null))[1] from v),
    'first_seen', (select min(first_seen) from v),
    -- Une conversion envoyée par un serveur ne rafraîchit pas le visiteur : la dernière activité regarde aussi les évènements
    'last_seen', greatest((select max(last_seen) from v), (select max(e.ts) from tracking_events e where e.visitor_id in (select id from v))),
    'pageviews', (select count(*) from tracking_events e where e.visitor_id in (select id from v) and e.type = 'pageview'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'device', device, 'country', country, 'first_seen', first_seen, 'last_seen', last_seen,
        'server', anon_id like 'srv\_%'
      ) order by first_seen) from v), '[]'::jsonb),
    'touches', coalesce((select jsonb_agg(x.j order by x.ts desc) from (
        select t.ts, jsonb_build_object(
          'ts', t.ts, 'channel', t.channel, 'platform', t.platform, 'source', t.utm_source, 'medium', t.utm_medium,
          'campaign', t.utm_campaign, 'content', t.utm_content, 'term', t.utm_term,
          'campaign_key', t.campaign_key, 'adset_key', t.adset_key, 'ad_key', t.ad_key,
          'landing_url', left(t.landing_url, 300), 'referrer', left(t.referrer, 200), 'visitor_id', t.visitor_id
        ) as j
        from touchpoints t where t.visitor_id in (select id from v)
        order by t.ts desc limit 300) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x.j order by x.ts desc) from (
        select e.ts, jsonb_build_object(
          'id', e.id, 'ts', e.ts, 'type', e.type, 'name', e.name, 'value', e.value, 'currency', e.currency,
          'source', e.source, 'order_id', e.order_id, 'url', left(e.url, 300)
        ) as j
        from tracking_events e where e.visitor_id in (select id from v) and e.type <> 'pageview'
        order by e.ts desc limit 300) x), '[]'::jsonb)
  ) end;
$$;
revoke execute on function public.tracking_person(uuid, uuid) from anon, public;
grant execute on function public.tracking_person(uuid, uuid) to authenticated;
