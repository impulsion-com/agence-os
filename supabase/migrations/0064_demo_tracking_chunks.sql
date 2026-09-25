-- Seed de démo du tracking par morceaux (un client, une plage de jours) : chaque appel
-- reste sous le délai de 8 s de l'API Supabase. Appelée par POST /api/demo.
create or replace function public.demo_tracking_seed_part(ws uuid, p_company text, p_from int, p_to int)
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
  perform setseed(0.4242 * (p_from + 1) / 61.0);
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
    where x.company = p_company
  loop
    select c.id into comp from companies c where c.workspace_id = ws and c.name = cfg.company limit 1;
    if comp is null then continue; end if;
    -- premier morceau (jour 60) : on recrée le site ; morceaux suivants : on le reprend
    if p_from < 60 then
      select s.id into site from tracking_sites s where s.workspace_id = ws and s.company_id = comp and s.settings->>'demo' = 'true' limit 1;
    else
      site := null;
    end if;
    if site is null then
    delete from tracking_sites s where s.workspace_id = ws and s.company_id = comp and s.settings->>'demo' = 'true';
    insert into tracking_sites (workspace_id, company_id, name, domains, settings, last_event_at)
    values (ws, comp, cfg.company, array[cfg.domain, 'checkout.' || cfg.domain],
            jsonb_build_object('window_days', 30, 'model', 'last_click', 'auto_contacts', false, 'consent', 'required', 'capture_forms', true, 'demo', true),
            now() - interval '4 minutes')
    returning id into site;
    created := created + 1;
    end if;

    for d in reverse p_from..p_to loop
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
revoke execute on function public.demo_tracking_seed_part(uuid, text, int, int) from anon, authenticated, public;
grant execute on function public.demo_tracking_seed_part(uuid, text, int, int) to service_role;
