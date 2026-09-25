-- =====================================================================
-- Tracking et attribution : requêtes de lecture (RPC) et données de démo.
-- Additive : aucune table modifiée. Les RPC de lecture sont en security
-- definer (la RLS évaluée ligne à ligne est trop lente sur les points de
-- contact) et vérifient une seule fois que l'appelant est membre de l'espace.
-- =====================================================================

create index if not exists touchpoints_site_visitor_ts on public.touchpoints (site_id, visitor_id, ts);
create index if not exists visitors_site_identified on public.visitors (site_id, identified_at) where email is not null;

-- ---------------------------------------------------------------------
-- Conversions d'une période avec les points de contact de la personne
-- (tous ses visiteurs fusionnés par email) dans la fenêtre d'attribution.
-- Pour le site de l'agence (company_id null), les deals gagnés du CRM dont
-- le contact a l'email d'un visiteur comptent comme conversion « deal_won ».
-- ---------------------------------------------------------------------
drop function if exists public.tracking_conversions(uuid, date, date, int);
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
    select e.id::text as id, e.ts, e.type, e.name, coalesce(e.value, 0) as value, e.currency, e.source,
           e.visitor_id, v.email
    from tracking_events e
    left join visitors v on v.id = e.visitor_id
    where e.site_id = p_site and e.type <> 'pageview'
      and exists (select 1 from site)
      and (p_types is null or e.type = any(p_types))
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz
    union all
    select 'deal:' || d.id::text, d.closed_at, 'deal_won', d.title, d.value, null, 'crm',
           (select vv.id from visitors vv where vv.site_id = p_site and vv.email = lower(c.email) order by vv.last_seen desc limit 1),
           lower(c.email)
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
  -- tous les visiteurs de la personne (fusion par email)
  pc as (
    select c.*, case when c.email is null then array[c.visitor_id]
                     else coalesce((select array_agg(vv.id) from visitors vv where vv.site_id = p_site and vv.email = c.email), array[c.visitor_id]) end as vids
    from conv c
  )
  select c.id, c.ts, c.type, c.name, c.value, c.currency, c.source,
         coalesce(c.email, c.visitor_id::text, c.id) as person, c.email, c.visitor_id,
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
grant execute on function public.tracking_conversions(uuid, date, date, int, text[]) to authenticated;
revoke execute on function public.tracking_conversions(uuid, date, date, int, text[]) from anon, public;

-- ---------------------------------------------------------------------
-- Statistiques de trafic d'une période : visiteurs uniques, nouveaux
-- identifiés, pages vues, et visiteurs par jour.
-- ---------------------------------------------------------------------
create or replace function public.tracking_stats(p_site uuid, p_start date, p_end date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id)) then null else jsonb_build_object(
    'visitors', (select count(distinct t.visitor_id) from touchpoints t
                 where t.site_id = p_site and t.ts >= p_start::timestamptz and t.ts < (p_end + 1)::timestamptz),
    'identified', (select count(*) from (
                     select v.email from visitors v where v.site_id = p_site and v.email is not null
                     group by v.email
                     having min(v.identified_at) >= p_start::timestamptz and min(v.identified_at) < (p_end + 1)::timestamptz) x),
    'leads', (select count(distinct coalesce(v.email, e.visitor_id::text)) from tracking_events e left join visitors v on v.id = e.visitor_id
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
grant execute on function public.tracking_stats(uuid, date, date) to authenticated;
revoke execute on function public.tracking_stats(uuid, date, date) from anon, public;

-- ---------------------------------------------------------------------
-- Personnes identifiées d'un site (regroupées par email), avec leurs achats.
-- ---------------------------------------------------------------------
create or replace function public.tracking_people(p_site uuid, p_q text default '', p_limit int default 100)
returns table (
  email text, name text, phone text, visitors int, contact_id uuid,
  first_seen timestamptz, last_seen timestamptz, identified_at timestamptz,
  purchases int, revenue numeric, leads int
)
language sql stable security definer set search_path = public as $$
  with g as (
    select v.email, max(v.name) as name, max(v.phone) as phone, count(*)::int as visitors,
           (array_agg(v.contact_id) filter (where v.contact_id is not null))[1] as contact_id,
           min(v.first_seen) as first_seen, max(v.last_seen) as last_seen, min(v.identified_at) as identified_at,
           array_agg(v.id) as ids
    from visitors v
    where v.site_id = p_site and v.email is not null
      and exists (select 1 from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id))
      and (coalesce(p_q, '') = '' or v.email ilike '%' || p_q || '%' or v.name ilike '%' || p_q || '%')
    group by v.email
    order by max(v.last_seen) desc
    limit greatest(1, least(p_limit, 500))
  )
  select g.email, g.name, g.phone, g.visitors, g.contact_id, g.first_seen, g.last_seen, g.identified_at,
         (select count(*)::int from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('purchase', 'deal_won')),
         (select coalesce(sum(e.value), 0) from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('purchase', 'deal_won')),
         (select count(*)::int from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('lead', 'booking'))
  from g
  order by g.last_seen desc;
$$;
grant execute on function public.tracking_people(uuid, text, int) to authenticated;
revoke execute on function public.tracking_people(uuid, text, int) from anon, public;

-- =====================================================================
-- Données de démo : un site suivi pour Maison Lumen et Kalia Cosmetics,
-- 60 jours de visiteurs, points de contact, identifications et achats.
-- Les campagnes Meta ont campaign_key = md5(nom), comme ad_metrics_daily
-- dans 0003_demo_data.sql, pour rapprocher attribution et dépense.
-- =====================================================================

-- Un point de contact + ses pages vues (usage interne du générateur)
create or replace function public.demo_tracking_touch(
  p_site uuid, p_ws uuid, p_vis uuid, p_ts timestamptz, p_ch text, p_domain text,
  p_camp text, p_adset text, p_ad text, p_pages text[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  page text := p_pages[1 + floor(random() * array_length(p_pages, 1))::int];
  url text; ref text := ''; src text; med text; cmp text; cnt text; trm text; uid text;
  cid_t text; cid text; ck text; ak text; dk text; pf text;
  n int := 1 + floor(random() * 3)::int;
begin
  if p_ch = 'paid_meta' then
    src := case when random() < 0.35 then 'instagram' else 'facebook' end; med := 'paid_social';
    cmp := p_camp; cnt := p_ad; trm := p_adset; pf := 'meta';
    ck := md5(p_camp); ak := '2385' || lpad((abs(hashtext(p_camp || p_adset)) % 100000000)::text, 8, '0');
    dk := '2386' || lpad((abs(hashtext(p_camp || p_ad)) % 100000000)::text, 8, '0');
    cid_t := 'fbclid'; cid := 'IwAR' || substr(md5(random()::text), 1, 22);
    url := 'https://' || p_domain || page || '?utm_source=' || src || '&utm_medium=paid_social&utm_campaign=' || replace(p_camp, ' ', '+')
      || '&utm_content=' || replace(p_ad, ' ', '+') || '&utm_id=' || ck || '&aos_adset=' || ak || '&aos_ad=' || dk || '&fbclid=' || cid;
    ref := case when random() < 0.5 then 'https://l.facebook.com/' else '' end;
  elsif p_ch = 'paid_google' then
    src := 'google'; med := 'cpc'; cmp := p_camp; trm := p_adset; pf := 'google';
    ck := '2187' || lpad((abs(hashtext(p_camp)) % 1000000)::text, 6, '0'); ak := '1563' || lpad((abs(hashtext(p_camp || p_adset)) % 1000000)::text, 6, '0');
    cid_t := 'gclid'; cid := 'Cj0KCQ' || substr(md5(random()::text), 1, 24);
    url := 'https://' || p_domain || page || '?utm_source=google&utm_medium=cpc&utm_campaign=' || replace(p_camp, ' ', '+') || '&utm_id=' || ck || '&gclid=' || cid;
    ref := 'https://www.google.com/';
  elsif p_ch = 'organic_search' then
    pf := 'google'; url := 'https://' || p_domain || page; ref := case when random() < 0.85 then 'https://www.google.com/' else 'https://www.bing.com/' end;
  elsif p_ch = 'email' then
    src := 'newsletter'; med := 'email'; cmp := p_camp; url := 'https://' || p_domain || page || '?utm_source=newsletter&utm_medium=email&utm_campaign=' || replace(p_camp, ' ', '+');
  elsif p_ch = 'organic_social' then
    pf := 'instagram'; url := 'https://' || p_domain || page; ref := 'https://www.instagram.com/';
  else
    url := 'https://' || p_domain || page;
  end if;
  insert into touchpoints (site_id, workspace_id, visitor_id, ts, landing_url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id,
                           click_id_type, click_id, channel, platform, campaign_key, adset_key, ad_key)
  values (p_site, p_ws, p_vis, p_ts, url, ref, src, med, cmp, cnt, trm, case when p_ch in ('paid_meta', 'paid_google') then ck end,
          cid_t, cid, p_ch, pf, ck, ak, dk);
  insert into tracking_events (site_id, workspace_id, visitor_id, type, url, ts)
  select p_site, p_ws, p_vis, 'pageview', 'https://' || p_domain || (case when g = 1 then page else p_pages[1 + floor(random() * array_length(p_pages, 1))::int] end),
         least(now(), p_ts + make_interval(secs => (g - 1) * (20 + floor(random() * 90)::int)))
  from generate_series(1, n) g;
end $$;
revoke execute on function public.demo_tracking_touch(uuid, uuid, uuid, timestamptz, text, text, text, text, text, text[]) from anon, authenticated, public;

-- Générateur (sans contrôle de rôle) : appelé par load_demo_tracking ou en SQL direct.
create or replace function public.demo_tracking_seed(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  cfg record; site uuid; comp uuid; d int; n int; i int; k int; extra int;
  vis uuid; vis2 uuid; t0 timestamptz; t timestamptz; conv_ts timestamptz; r float; ch text; ch2 text;
  camp text; adset text; ad text; buy boolean; ident boolean; em text; nm text; ph text; val numeric;
  created int := 0;
  fns text[] := array['Camille','Léa','Manon','Chloé','Inès','Sarah','Julie','Emma','Lucie','Pauline','Thomas','Lucas','Hugo','Nicolas','Julien','Antoine','Maxime','Karim','Sofia','Nadia','Élise','Margaux','Yanis','Mehdi'];
  lns text[] := array['Martin','Bernard','Dubois','Durand','Lefebvre','Moreau','Laurent','Simon','Michel','Garcia','Roux','Fournier','Girard','Bonnet','Mercier','Faure','Rousseau','Blanc','Guerin','Muller','Henry','Perrin','Morel','Mathieu'];
  mails text[] := array['exemple.fr','exemple.com','mail-demo.fr','demo-mail.fr'];
  devs text[] := array['mobile','mobile','mobile','desktop','desktop','tablet'];
  ctry text[] := array['FR','FR','FR','FR','FR','FR','FR','BE','CH','CA'];
begin
  perform setseed(0.4242);
  for cfg in
    select * from (values
      ('Maison Lumen', 'maisonlumen.fr', 150, 1.0, 185.0, 70.0, 460.0,
        'Advantage+ Shopping', array['Broad FR 25-55', 'Intérêts déco maison'], array['UGC Suspension Opale', 'Carrousel best-sellers', 'Vidéo atelier'],
        'Retargeting 30 j', array['Visiteurs 30 j', 'Paniers abandonnés'], array['Lampadaire Arc statique', 'Offre retour panier'],
        'Shopping Luminaires', 'Newsletter hebdo',
        array['/', '/collections/suspensions', '/produits/suspension-opale', '/collections/lampadaires', '/produits/lampadaire-arc', '/blog/eclairer-un-salon']),
      ('Kalia Cosmetics', 'kalia-cosmetics.com', 200, 1.7, 56.0, 22.0, 130.0,
        'Prospection UGC', array['Broad femmes 25-45', 'Lookalike acheteuses 3 %'], array['UGC routine du soir', 'Avant après sérum', 'Témoignage Inès'],
        'Catalogue DPA', array['Vues produit 14 j', 'Acheteuses 180 j'], array['DPA carrousel', 'DPA collection'],
        'Search marque Kalia', 'Newsletter nouveautés',
        array['/', '/produits/serum-eclat', '/collections/soins-visage', '/produits/creme-nuit-reparatrice', '/blog/routine-peau-seche'])
    ) as x(company, domain, per_day, cr, aov, vmin, vmax, camp1, adsets1, ads1, camp2, adsets2, ads2, gcamp, ecamp, pages)
  loop
    select c.id into comp from companies c where c.workspace_id = ws and c.name = cfg.company limit 1;
    if comp is null then continue; end if;
    delete from tracking_sites s where s.workspace_id = ws and s.company_id = comp and s.settings->>'demo' = 'true';
    insert into tracking_sites (workspace_id, company_id, name, domains, settings, last_event_at)
    values (ws, comp, cfg.company, array[cfg.domain, 'checkout.' || cfg.domain],
            jsonb_build_object('window_days', 30, 'model', 'last_click', 'auto_contacts', false, 'consent', 'required', 'capture_forms', true, 'demo', true),
            now() - interval '4 minutes')
    returning id into site;
    created := created + 1;

    for d in reverse 60..0 loop
      n := round(cfg.per_day * (0.8 + 0.4 * random()) * (1 + (60 - d) * 0.004) * (case when d = 0 then 0.4 else 1 end));
      for i in 1..n loop
        t0 := (current_date - d)::timestamptz + make_interval(secs => floor(random() * 86400)::int);
        if t0 > now() then t0 := now() - make_interval(secs => floor(random() * 3600)::int); end if;
        insert into visitors (site_id, workspace_id, anon_id, device, country, first_seen, last_seen)
        values (site, ws, 'demo_' || substr(md5(random()::text || i::text), 1, 18), devs[1 + floor(random() * 6)::int], ctry[1 + floor(random() * 10)::int], t0, t0)
        returning id into vis;

        r := random();
        ch := case when r < 0.55 then 'paid_meta' when r < 0.62 then 'paid_google' when r < 0.75 then 'organic_search'
                   when r < 0.80 then 'email' when r < 0.88 then 'organic_social' else 'direct' end;
        if ch = 'paid_meta' then
          if random() < 0.8 then camp := cfg.camp1; adset := cfg.adsets1[1 + floor(random() * 2)::int]; ad := cfg.ads1[1 + floor(random() * 3)::int];
          else camp := cfg.camp2; adset := cfg.adsets2[1 + floor(random() * 2)::int]; ad := cfg.ads2[1 + floor(random() * 2)::int]; end if;
        elsif ch = 'paid_google' then camp := cfg.gcamp; adset := 'Groupe principal'; ad := null;
        elsif ch = 'email' then camp := cfg.ecamp; adset := null; ad := null;
        else camp := null; adset := null; ad := null; end if;
        perform demo_tracking_touch(site, ws, vis, t0, ch, cfg.domain, camp, adset, ad, cfg.pages);

        -- visites suivantes (retargeting, email, direct, recherche)
        r := random();
        extra := case when r < 0.55 then 0 when r < 0.85 then 1 else 2 end;
        t := t0;
        for k in 1..extra loop
          exit when t + make_interval(secs => 3600 * 2 + floor(random() * 3600 * 24 * 5)::int) > now();
          t := t + make_interval(secs => 3600 * 2 + floor(random() * 3600 * 24 * 5)::int);
          if t > now() then t := now() - interval '5 minutes'; end if;
          r := random();
          ch2 := case when r < 0.5 then 'paid_meta' when r < 0.7 then 'email' when r < 0.9 then 'direct' else 'organic_search' end;
          if ch2 = 'paid_meta' then camp := cfg.camp2; adset := cfg.adsets2[1 + floor(random() * 2)::int]; ad := cfg.ads2[1 + floor(random() * 2)::int];
          elsif ch2 = 'email' then camp := cfg.ecamp; adset := null; ad := null;
          else camp := null; adset := null; ad := null; end if;
          perform demo_tracking_touch(site, ws, vis, t, ch2, cfg.domain, camp, adset, ad, cfg.pages);
        end loop;
        update visitors set last_seen = t where id = vis;

        buy := random() < 0.055 * cfg.cr * (1 + 0.7 * extra) * (case when ch = 'paid_meta' then 1.1 else 0.7 end);
        ident := buy or random() < 0.16;
        if not ident then continue; end if;

        nm := fns[1 + floor(random() * array_length(fns, 1))::int] || ' ' || lns[1 + floor(random() * array_length(lns, 1))::int];
        em := lower(translate(split_part(nm, ' ', 1), 'éèÉÈëï', 'eeEEei')) || '.' || lower(split_part(nm, ' ', 2)) || floor(random() * 900 + 10)::int
              || '@' || mails[1 + floor(random() * 4)::int];
        ph := case when random() < 0.4 then '06' || lpad(floor(random() * 100000000)::int::text, 8, '0') end;
        conv_ts := t + make_interval(secs => 120 + floor(random() * 5400)::int);
        if conv_ts > now() then conv_ts := greatest(t, now() - make_interval(secs => 60 + floor(random() * 1800)::int)); end if;
        update visitors set email = em, name = nm, phone = ph, identified_at = case when buy then conv_ts else t end where id = vis;
        insert into tracking_events (site_id, workspace_id, visitor_id, type, name, order_id, source, ts)
        values (site, ws, vis, 'lead', 'identify', 'auto:' || em, 'script', case when buy then conv_ts else t end)
        on conflict do nothing;

        if buy then
          -- 8 % des acheteurs finalisent sur un autre appareil (fusion par email)
          if random() < 0.08 then
            insert into visitors (site_id, workspace_id, anon_id, email, name, device, country, first_seen, last_seen, identified_at)
            values (site, ws, 'demo_' || substr(md5(random()::text || 'b'), 1, 18), em, nm, 'desktop', 'FR', conv_ts - interval '10 minutes', conv_ts, conv_ts)
            returning id into vis2;
            perform demo_tracking_touch(site, ws, vis2, conv_ts - interval '10 minutes', 'direct', cfg.domain, null, null, null, cfg.pages);
            vis := vis2;
          end if;
          val := round((cfg.aov * (0.6 + 0.8 * random()))::numeric, 2);
          val := greatest(cfg.vmin, least(cfg.vmax, val));
          insert into tracking_events (site_id, workspace_id, visitor_id, type, name, value, currency, order_id, url, source, ts)
          values (site, ws, vis, 'purchase', 'purchase', val, 'EUR', 'demo-' || substr(md5(random()::text), 1, 10),
                  'https://checkout.' || cfg.domain || '/merci', case when random() < 0.7 then 'script' else 'api' end, conv_ts);
        end if;
      end loop;
    end loop;
  end loop;
  return created;
end $$;
revoke execute on function public.demo_tracking_seed(uuid) from anon, authenticated, public;

-- Points d'entrée pour l'interface (réservés aux admins de l'espace)
create or replace function public.load_demo_tracking(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform demo_tracking_seed(ws);
end $$;
revoke execute on function public.load_demo_tracking(uuid) from anon, public;
grant execute on function public.load_demo_tracking(uuid) to authenticated;

create or replace function public.clear_demo_tracking(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  delete from tracking_sites where workspace_id = ws and settings->>'demo' = 'true';
end $$;
revoke execute on function public.clear_demo_tracking(uuid) from anon, public;
grant execute on function public.clear_demo_tracking(uuid) to authenticated;
