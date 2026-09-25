-- =====================================================================
-- Liens trackés et raccourcisseur : réglages, statistiques agrégées,
-- attribution (touchpoints du script de tracking), données de démo.
-- Additive : ne modifie aucune table existante hormis une colonne
-- « is_demo » sur links.
-- =====================================================================

-- Règle de nommage des campagnes propre à l'espace (ex. {client}_{objectif}_{date})
create table if not exists public.link_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  naming_rule text not null default '',
  naming_help text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.link_settings enable row level security;
drop policy if exists "lecture membres" on public.link_settings;
drop policy if exists "ajout membres" on public.link_settings;
drop policy if exists "modif membres" on public.link_settings;
create policy "lecture membres" on public.link_settings for select using (public.is_member(workspace_id));
create policy "ajout membres" on public.link_settings for insert with check (public.can_write(workspace_id));
create policy "modif membres" on public.link_settings for update using (public.can_write(workspace_id));

-- Liens de démo (pour les retirer sans toucher aux liens réels)
alter table public.links add column if not exists is_demo boolean not null default false;
create index if not exists link_clicks_ws_ts on public.link_clicks (workspace_id, ts desc);

-- Les codes courts sont uniques pour toute l'instance, mais RLS ne montre que ceux
-- de l'espace : cette fonction répond à « ce code est-il libre ? » sans rien exposer.
create or replace function public.link_code_available(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from links where lower(code) = lower(p_code));
$$;
revoke execute on function public.link_code_available(text) from anon, public;
grant execute on function public.link_code_available(text) to authenticated;

-- Statistiques d'un lien sur une période (jours locaux) : RLS appliquée (security invoker).
create or replace function public.link_stats(
  p_link uuid, p_from date, p_to date, p_tz text default 'Europe/Paris',
  p_prev_from date default null, p_prev_to date default null
)
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (
    select (ts at time zone p_tz) as lt, is_bot, device, browser, os, country,
      coalesce(nullif(regexp_replace(lower(substring(referrer from '^[a-zA-Z]+://([^/:?#]+)')), '^www\.', ''), ''), '') as ref
    from link_clicks
    where link_id = p_link
      and ts >= (p_from::timestamp at time zone p_tz)
      and ts < ((p_to + 1)::timestamp at time zone p_tz)
  ), h as (select * from c where not is_bot)
  select jsonb_build_object(
    'humans', (select count(*) from h),
    'bots', (select count(*) from c where is_bot),
    'prev_humans', case when p_prev_from is null then null else (
      select count(*) from link_clicks where link_id = p_link and not is_bot
        and ts >= (p_prev_from::timestamp at time zone p_tz) and ts < ((p_prev_to + 1)::timestamp at time zone p_tz)) end,
    'days', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'h', hu, 'b', bo) order by d), '[]'::jsonb)
             from (select lt::date as d, count(*) filter (where not is_bot) as hu, count(*) filter (where is_bot) as bo from c group by 1) x),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by k), '[]'::jsonb)
              from (select extract(hour from lt)::int as k, count(*) as n from h group by 1) x),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                  from (select ref as k, count(*) as n from h group by 1 order by 2 desc limit 12) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                from (select coalesce(device, '') as k, count(*) as n from h group by 1) x),
    'browsers', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                 from (select coalesce(browser, '') as k, count(*) as n from h group by 1 order by 2 desc limit 10) x),
    'os', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
           from (select coalesce(os, '') as k, count(*) as n from h group by 1 order by 2 desc limit 10) x),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                  from (select coalesce(country, '') as k, count(*) as n from h group by 1 order by 2 desc limit 12) x)
  );
$$;
revoke execute on function public.link_stats(uuid, date, date, text, date, date) from anon, public;
grant execute on function public.link_stats(uuid, date, date, text, date, date) to authenticated;

-- Attribution « contact » : visiteurs arrivés par un lien (touchpoints.link_id), puis leurs
-- prospects (lead, booking) et ventes (purchase, deal_won) survenus après ce premier passage.
create or replace function public.link_attribution(
  p_ws uuid, p_link uuid default null, p_from timestamptz default null, p_to timestamptz default null
)
returns table (link_id uuid, visitors bigint, leads bigint, sales bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  with tp as (
    select t.link_id, t.visitor_id, min(t.ts) as first_ts
    from touchpoints t
    where t.workspace_id = p_ws and t.link_id is not null
      and (p_link is null or t.link_id = p_link)
      and (p_from is null or t.ts >= p_from)
      and (p_to is null or t.ts < p_to)
    group by 1, 2
  )
  select tp.link_id,
    count(distinct tp.visitor_id),
    count(distinct e.visitor_id) filter (where e.type in ('lead', 'booking')),
    count(distinct e.id) filter (where e.type in ('purchase', 'deal_won')),
    coalesce(sum(e.value) filter (where e.type in ('purchase', 'deal_won')), 0)
  from tp
  left join tracking_events e
    on e.visitor_id = tp.visitor_id and e.ts >= tp.first_ts and e.type in ('lead', 'booking', 'purchase', 'deal_won')
  group by tp.link_id;
$$;
revoke execute on function public.link_attribution(uuid, uuid, timestamptz, timestamptz) from anon, public;
grant execute on function public.link_attribution(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Données de démo : ~13 liens et ~1 500 clics sur 45 jours
-- ---------------------------------------------------------------------
create or replace function public._clear_demo_links(ws uuid)
returns void language sql security definer set search_path = public as $$
  delete from links where workspace_id = ws and is_demo;
$$;
revoke execute on function public._clear_demo_links(uuid) from anon, authenticated, public;

create or replace function public._demo_links(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  sfx text := substr(md5(ws::text), 1, 4);
  me uuid := coalesce(auth.uid(), (select user_id from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1));
  c_kalia uuid; c_lumen uuid; c_velo uuid; c_forma uuid;
  -- id, poids, âge (jours), mode (0 continu, 1 envoi puis décroissance, 2 montée), part mobile, famille de référent
  ids uuid[] := '{}'; weights numeric[] := '{}'; ages int[] := '{}'; modes int[] := '{}'; mobiles numeric[] := '{}'; refs text[] := '{}';
  total numeric; r numeric; acc numeric; k int; n int := 1500;
  lid uuid; age int; mode int; off numeric; hr int; ts_ timestamptz;
  bot boolean; dev text; br text; os_ text; ctry text; ref text; fam text; x numeric;
  -- heures UTC (Paris - 2 h) : pics le midi et le soir
  hours int[] := '{5,6,6,7,7,8,9,10,10,10,11,11,12,13,14,15,16,16,17,17,18,18,18,19,19,19,20,20,21,22}';
begin
  perform _clear_demo_links(ws);
  select id into c_kalia from companies where workspace_id = ws and name = 'Kalia Cosmetics' limit 1;
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' limit 1;
  select id into c_velo from companies where workspace_id = ws and name = 'Vélo Nord' limit 1;
  select id into c_forma from companies where workspace_id = ws and name = 'FormaPro' limit 1;

  -- Liens courts avec clics
  with ins as (
    insert into links (workspace_id, company_id, site_id, name, destination, utm, final_url, code, tags, active, expires_at, created_by, created_at, is_demo)
    select ws, v.company, (select id from tracking_sites s where s.workspace_id = ws and s.company_id = v.company order by created_at limit 1),
      v.name, v.dest, v.utm, v.final, v.code || '-' || sfx, v.tags, v.active, v.expires, me, now() - make_interval(days => v.age), true
    from (values
      ('Bio Instagram Kalia', c_kalia, 'https://kalia-cosmetics.com/', '{"utm_source":"instagram","utm_medium":"bio","utm_campaign":"profil"}'::jsonb,
        'https://kalia-cosmetics.com/?utm_source=instagram&utm_medium=bio&utm_campaign=profil', 'kalia-bio', '{Instagram,Organique}'::text[], true, null::timestamptz, 44),
      ('Story lancement sérum vitamine C', c_kalia, 'https://kalia-cosmetics.com/products/serum-vitamine-c', '{"utm_source":"instagram","utm_medium":"story","utm_campaign":"lancement_serum_vitc","utm_content":"story_swipe"}'::jsonb,
        'https://kalia-cosmetics.com/products/serum-vitamine-c?utm_source=instagram&utm_medium=story&utm_campaign=lancement_serum_vitc&utm_content=story_swipe', 'serum-vitc', '{Instagram,Lancement}', true, null, 21),
      ('Influence @lea.skin (automne)', c_kalia, 'https://kalia-cosmetics.com/collections/routine-automne', '{"utm_source":"instagram","utm_medium":"influence","utm_campaign":"influence_automne_2026","utm_content":"lea_skin"}'::jsonb,
        'https://kalia-cosmetics.com/collections/routine-automne?utm_source=instagram&utm_medium=influence&utm_campaign=influence_automne_2026&utm_content=lea_skin', 'lea-skin', '{Influence}', true, null, 16),
      ('Black Friday Kalia (précommande)', c_kalia, 'https://kalia-cosmetics.com/pages/black-friday', '{"utm_source":"instagram","utm_medium":"story","utm_campaign":"black_friday_2026","utm_content":"precommande"}'::jsonb,
        'https://kalia-cosmetics.com/pages/black-friday?utm_source=instagram&utm_medium=story&utm_campaign=black_friday_2026&utm_content=precommande', 'kalia-bf', '{Instagram,Black Friday}', true, now() + interval '60 days', 9),
      ('Newsletter Maison Lumen octobre', c_lumen, 'https://maisonlumen.fr/collections/nouveautes', '{"utm_source":"newsletter","utm_medium":"email","utm_campaign":"newsletter_octobre","utm_content":"bouton_principal"}'::jsonb,
        'https://maisonlumen.fr/collections/nouveautes?utm_source=newsletter&utm_medium=email&utm_campaign=newsletter_octobre&utm_content=bouton_principal', 'lumen-nl-oct', '{Newsletter}', true, null, 6),
      ('Newsletter Maison Lumen septembre', c_lumen, 'https://maisonlumen.fr/collections/luminaires', '{"utm_source":"newsletter","utm_medium":"email","utm_campaign":"newsletter_septembre","utm_content":"bouton_principal"}'::jsonb,
        'https://maisonlumen.fr/collections/luminaires?utm_source=newsletter&utm_medium=email&utm_campaign=newsletter_septembre&utm_content=bouton_principal', 'lumen-nl-sept', '{Newsletter}', true, null, 36),
      ('Épingle Pinterest suspension Nara', c_lumen, 'https://maisonlumen.fr/products/suspension-nara', '{"utm_source":"pinterest","utm_medium":"social","utm_campaign":"epingles_produits","utm_content":"suspension_nara"}'::jsonb,
        'https://maisonlumen.fr/products/suspension-nara?utm_source=pinterest&utm_medium=social&utm_campaign=epingles_produits&utm_content=suspension_nara', 'nara-pin', '{Organique}', true, null, 40),
      ('QR code salon du Cycle de Lille', c_velo, 'https://velonord.com/essai-velo-electrique', '{"utm_source":"salon_cycle_lille","utm_medium":"qr_code","utm_campaign":"salon_2026","utm_content":"stand_b12"}'::jsonb,
        'https://velonord.com/essai-velo-electrique?utm_source=salon_cycle_lille&utm_medium=qr_code&utm_campaign=salon_2026&utm_content=stand_b12', 'velo-salon', '{QR code,Événement}', true, null, 30),
      ('Flyer boutique Vélo Nord (ancien)', c_velo, 'https://velonord.com/atelier', '{"utm_source":"flyer","utm_medium":"qr_code","utm_campaign":"boutique_printemps"}'::jsonb,
        'https://velonord.com/atelier?utm_source=flyer&utm_medium=qr_code&utm_campaign=boutique_printemps', 'velo-flyer', '{QR code}', false, null, 45),
      ('Post LinkedIn webinar financement', c_forma, 'https://formapro.fr/webinar-financement', '{"utm_source":"linkedin","utm_medium":"social","utm_campaign":"webinar_octobre","utm_content":"post_fondateur"}'::jsonb,
        'https://formapro.fr/webinar-financement?utm_source=linkedin&utm_medium=social&utm_campaign=webinar_octobre&utm_content=post_fondateur', 'forma-webinar', '{LinkedIn}', true, null, 14),
      ('Signature email FormaPro', c_forma, 'https://formapro.fr/formations', '{"utm_source":"signature","utm_medium":"email","utm_campaign":"signature_equipe"}'::jsonb,
        'https://formapro.fr/formations?utm_source=signature&utm_medium=email&utm_campaign=signature_equipe', 'forma-sig', '{Email}', true, null, 45)
    ) as v(name, company, dest, utm, final, code, tags, active, expires, age)
    returning id, code
  )
  select array_agg(id order by code), array_agg(code order by code) into ids, refs from ins;

  -- Paramètres de génération par lien (dans l'ordre alphabétique des codes)
  declare codes text[] := refs;
  begin
    for k in 1 .. array_length(codes, 1) loop
      case split_part(codes[k], '-' || sfx, 1)
        when 'forma-sig' then weights := weights || 3.0; ages := ages || 45; modes := modes || 0; mobiles := mobiles || 0.3; refs[k] := 'mail';
        when 'forma-webinar' then weights := weights || 8.0; ages := ages || 14; modes := modes || 1; mobiles := mobiles || 0.4; refs[k] := 'linkedin';
        when 'kalia-bf' then weights := weights || 9.0; ages := ages || 9; modes := modes || 2; mobiles := mobiles || 0.9; refs[k] := 'instagram';
        when 'kalia-bio' then weights := weights || 22.0; ages := ages || 44; modes := modes || 0; mobiles := mobiles || 0.88; refs[k] := 'instagram';
        when 'lea-skin' then weights := weights || 12.0; ages := ages || 16; modes := modes || 1; mobiles := mobiles || 0.9; refs[k] := 'influence';
        when 'lumen-nl-oct' then weights := weights || 11.0; ages := ages || 6; modes := modes || 1; mobiles := mobiles || 0.55; refs[k] := 'mail';
        when 'lumen-nl-sept' then weights := weights || 7.0; ages := ages || 36; modes := modes || 1; mobiles := mobiles || 0.55; refs[k] := 'mail';
        when 'nara-pin' then weights := weights || 6.0; ages := ages || 40; modes := modes || 0; mobiles := mobiles || 0.7; refs[k] := 'pinterest';
        when 'serum-vitc' then weights := weights || 9.0; ages := ages || 21; modes := modes || 1; mobiles := mobiles || 0.92; refs[k] := 'instagram';
        when 'velo-flyer' then weights := weights || 3.0; ages := ages || 45; modes := modes || 3; mobiles := mobiles || 0.97; refs[k] := 'qr';
        else weights := weights || 10.0; ages := ages || 30; modes := modes || 1; mobiles := mobiles || 0.97; refs[k] := 'qr';
      end case;
    end loop;
  end;

  select sum(w) into total from unnest(weights) w;
  for i in 1 .. n loop
    r := random() * total; acc := 0; k := 1;
    while k < array_length(weights, 1) and acc + weights[k] < r loop acc := acc + weights[k]; k := k + 1; end loop;
    lid := ids[k]; age := ages[k]; mode := modes[k]; fam := refs[k];
    off := case mode
      when 1 then least(age, floor(-ln(greatest(random(), 1e-6)) * 2.2))::numeric           -- pic à l'envoi puis décroissance
      when 2 then floor(age * (1 - sqrt(random())))::numeric                                   -- montée progressive
      when 3 then 12 + floor(random() * (age - 11))                                            -- désactivé il y a 12 jours
      else floor(random() * (age + 1))::numeric end;
    if mode = 1 then off := age - off; end if;
    hr := hours[1 + floor(random() * array_length(hours, 1))::int];
    ts_ := date_trunc('day', now() - make_interval(days => off::int)) + make_interval(hours => hr, mins => floor(random() * 60)::int, secs => floor(random() * 60)::int);
    if ts_ > now() then ts_ := now() - make_interval(mins => floor(random() * 90)::int); end if;

    bot := random() < 0.035;
    if bot then
      x := random();
      br := case when x < 0.35 then 'Aperçu Facebook' when x < 0.55 then 'Aperçu WhatsApp' when x < 0.7 then 'Aperçu Slack' when x < 0.85 then 'Googlebot' else 'Aperçu LinkedIn' end;
      insert into link_clicks (link_id, workspace_id, ts, referrer, device, browser, os, country, is_bot)
      values (lid, ws, ts_, '', 'bot', br, null, case when random() < 0.7 then 'US' else 'IE' end, true);
      continue;
    end if;

    x := random();
    dev := case when x < mobiles[k] then 'mobile' when x < mobiles[k] + 0.04 then 'tablet' else 'desktop' end;
    x := random();
    if dev = 'desktop' then
      os_ := case when x < 0.55 then 'Windows' when x < 0.94 then 'macOS' else 'Linux' end;
      x := random();
      br := case when x < 0.58 then 'Chrome' when x < 0.78 then 'Safari' when x < 0.91 then 'Edge' else 'Firefox' end;
      if os_ <> 'macOS' and br = 'Safari' then br := 'Chrome'; end if;
    else
      os_ := case when x < 0.6 then 'iOS' else 'Android' end;
      x := random();
      if fam in ('instagram', 'influence') and x < 0.55 then br := 'Instagram';
      elsif fam = 'linkedin' and x < 0.45 then br := 'LinkedIn';
      elsif os_ = 'iOS' then br := case when random() < 0.82 then 'Safari' else 'Chrome' end;
      else br := case when random() < 0.8 then 'Chrome' else 'Samsung Internet' end;
      end if;
    end if;
    x := random();
    ctry := case when x < 0.82 then 'FR' when x < 0.89 then 'BE' when x < 0.94 then 'CH' when x < 0.97 then 'CA' when x < 0.985 then 'LU' else 'MA' end;
    x := random();
    ref := case fam
      when 'instagram' then case when x < 0.72 then 'https://l.instagram.com/' else '' end
      when 'influence' then case when x < 0.6 then 'https://l.instagram.com/' when x < 0.78 then 'https://www.tiktok.com/' else '' end
      when 'mail' then case when x < 0.16 then 'https://mail.google.com/' when x < 0.22 then 'https://outlook.live.com/' else '' end
      when 'linkedin' then case when x < 0.7 then 'https://www.linkedin.com/' when x < 0.85 then 'https://lnkd.in/' else '' end
      when 'pinterest' then case when x < 0.85 then 'https://www.pinterest.fr/' else '' end
      else '' end;
    insert into link_clicks (link_id, workspace_id, ts, referrer, device, browser, os, country, is_bot)
    values (lid, ws, ts_, ref, dev, br, os_, ctry, false);
  end loop;

  update links l set clicks = s.n, last_click_at = s.last
  from (select link_id, count(*) filter (where not is_bot) as n, max(ts) filter (where not is_bot) as last from link_clicks where workspace_id = ws group by 1) s
  where l.id = s.link_id and l.workspace_id = ws and l.is_demo;

  -- Liens UTM seuls (paramètres dynamiques, à coller dans la plateforme)
  insert into links (workspace_id, company_id, name, destination, utm, final_url, code, tags, created_by, created_at, is_demo) values
    (ws, c_kalia, 'Meta Ads Kalia : paramètres dynamiques', 'https://kalia-cosmetics.com/',
      '{"utm_source":"facebook","utm_medium":"paid_social","utm_campaign":"{{campaign.name}}","utm_content":"{{ad.name}}","utm_term":"{{adset.name}}","utm_id":"{{campaign.id}}","extra":[{"k":"aos_ad","v":"{{ad.id}}"},{"k":"aos_adset","v":"{{adset.id}}"}]}'::jsonb,
      'https://kalia-cosmetics.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{campaign.id}}&aos_ad={{ad.id}}&aos_adset={{adset.id}}',
      null, '{Meta Ads}', me, now() - interval '20 days', true),
    (ws, c_velo, 'Google Ads Vélo Nord : ValueTrack', 'https://velonord.com/',
      '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"{campaignid}","utm_content":"{creative}","utm_term":"{keyword}","utm_id":"{campaignid}","extra":[{"k":"aos_adset","v":"{adgroupid}"},{"k":"aos_ad","v":"{creative}"}]}'::jsonb,
      'https://velonord.com/?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}&utm_id={campaignid}&aos_adset={adgroupid}&aos_ad={creative}',
      null, '{Google Ads}', me, now() - interval '25 days', true);
end $$;
revoke execute on function public._demo_links(uuid) from anon, authenticated, public;

create or replace function public.load_demo_links(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _demo_links(ws);
end $$;
revoke execute on function public.load_demo_links(uuid) from anon, public;

create or replace function public.clear_demo_links(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_links(ws);
end $$;
revoke execute on function public.clear_demo_links(uuid) from anon, public;
