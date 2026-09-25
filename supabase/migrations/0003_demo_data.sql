-- =====================================================================
-- Données de démonstration : une agence fictive complète.
-- Appelée à l'onboarding (case cochée) ou depuis Réglages > Espace.
-- Les comptes publicitaires de démo n'ont pas de connexion : leurs
-- métriques sont générées ici pour que le reporting soit visible.
-- =====================================================================

-- Crée une tâche avec étiquettes et sous-tâches (dates en jours relatifs à aujourd'hui)
create or replace function public.demo_task(
  p uuid, title text, st text, prio text, who uuid, start_off int, due_off int,
  labs text[] default '{}', subs text[] default '{}', subs_done int default 0, descr text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid; ws uuid; n int := 0; s text;
begin
  select workspace_id into ws from projects where id = p;
  insert into tasks (project_id, title, status, priority, assignee_id, start_date, due_date, description, position)
  values (p, title, st, prio, who, current_date + start_off, current_date + due_off, descr,
          (select coalesce(max(position), 0) + 1000 from tasks where project_id = p))
  returning id into t;
  insert into task_labels (task_id, label_id)
    select t, l.id from labels l where l.workspace_id = ws and l.name = any(labs);
  foreach s in array subs loop
    n := n + 1;
    insert into subtasks (task_id, title, done, position) values (t, s, n <= subs_done, n);
  end loop;
  return t;
end $$;
revoke execute on function public.demo_task from anon, authenticated, public;

create or replace function public.load_demo_data(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c_lumen uuid; c_velo uuid; c_kalia uuid; c_forma uuid; c_brun uuid; c_nova uuid; c_oasis uuid;
  k_lumen uuid; k_velo uuid; k_kalia uuid; k_forma uuid; k_brun uuid; k_nova uuid;
  stages uuid[];
  p uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid;
  acc uuid; d date; i int; camp record; f numeric;
  prop uuid; deal_nova uuid;
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  select array_agg(id order by position) into stages from pipeline_stages where workspace_id = ws;

  -- ---------- Entreprises et contacts ----------
  insert into companies (workspace_id, name, website, industry, status, owner_id, monthly_retainer, color, notes) values
    (ws, 'Maison Lumen', 'maisonlumen.fr', 'E-commerce', 'client', me, 3000, 'amber', 'Luminaires design, panier moyen 180 €. Saisonnalité forte en novembre.') returning id into c_lumen;
  insert into companies (workspace_id, name, website, industry, status, owner_id, monthly_retainer, color, notes) values
    (ws, 'Vélo Nord', 'velonord.com', 'E-commerce', 'client', me, 1500, 'teal', 'Vélos électriques, 3 magasins dans le Nord. Objectif : leads magasin et ventes en ligne.') returning id into c_velo;
  insert into companies (workspace_id, name, website, industry, status, owner_id, monthly_retainer, color, notes) values
    (ws, 'Kalia Cosmetics', 'kalia-cosmetics.com', 'E-commerce', 'client', me, 3300, 'rose', 'Cosmétique naturelle DTC. Gros besoin de volume créa (UGC).') returning id into c_kalia;
  insert into companies (workspace_id, name, website, industry, status, owner_id, monthly_retainer, color, notes) values
    (ws, 'FormaPro', 'formapro.fr', 'Formation', 'client', me, 1800, 'blue', 'Organisme de formation certifié Qualiopi, leads B2C éligibles CPF.') returning id into c_forma;
  insert into companies (workspace_id, name, website, industry, status, owner_id, color, notes) values
    (ws, 'Atelier Brun', 'atelier-brun.fr', 'Local', 'lead', me, 'violet', 'Menuiserie haut de gamme, veut tester Google Ads en local.') returning id into c_brun;
  insert into companies (workspace_id, name, website, industry, status, owner_id, color) values
    (ws, 'Nova SaaS', 'novasaas.io', 'SaaS', 'lead', me, 'indigo') returning id into c_nova;
  insert into companies (workspace_id, name, website, industry, status, owner_id, color) values
    (ws, 'Oasis Immobilier', 'oasis-immo.fr', 'Immobilier', 'former', me, 'slate') returning id into c_oasis;

  insert into contacts (workspace_id, company_id, first_name, last_name, email, phone, job_title) values
    (ws, c_lumen, 'Claire', 'Dubois', 'claire@maisonlumen.fr', '06 12 34 56 78', 'Fondatrice') returning id into k_lumen;
  insert into contacts (workspace_id, company_id, first_name, last_name, email, phone, job_title) values
    (ws, c_velo, 'Thomas', 'Leclercq', 'thomas@velonord.com', '06 98 76 54 32', 'Responsable marketing') returning id into k_velo;
  insert into contacts (workspace_id, company_id, first_name, last_name, email, phone, job_title) values
    (ws, c_kalia, 'Inès', 'Benali', 'ines@kalia-cosmetics.com', '07 11 22 33 44', 'Head of Growth') returning id into k_kalia;
  insert into contacts (workspace_id, company_id, first_name, last_name, email, job_title) values
    (ws, c_forma, 'Marc', 'Petit', 'marc.petit@formapro.fr', 'Directeur') returning id into k_forma;
  insert into contacts (workspace_id, company_id, first_name, last_name, email, phone, job_title) values
    (ws, c_brun, 'Julien', 'Brun', 'julien@atelier-brun.fr', '06 55 44 33 22', 'Gérant') returning id into k_brun;
  insert into contacts (workspace_id, company_id, first_name, last_name, email, job_title) values
    (ws, c_nova, 'Sarah', 'Cohen', 'sarah@novasaas.io', 'CMO') returning id into k_nova;
  insert into contacts (workspace_id, company_id, first_name, last_name, email, job_title) values
    (ws, c_kalia, 'Lucas', 'Moreau', 'lucas@kalia-cosmetics.com', 'Chef de produit'),
    (ws, c_oasis, 'Nadia', 'Roux', 'nadia@oasis-immo.fr', 'Directrice commerciale');

  -- ---------- Deals ----------
  insert into deals (workspace_id, title, company_id, contact_id, stage_id, owner_id, value, billing, source, services, expected_close, position) values
    (ws, 'Google Ads local', c_brun, k_brun, stages[2], me, 1200, 'monthly', 'Site web', '{Gestion Google Ads,Setup tracking}', current_date + 12, 1000),
    (ws, 'Audit comptes pub', c_nova, k_nova, stages[1], me, 900, 'one_off', 'LinkedIn', '{Audit publicitaire}', current_date + 7, 1000),
    (ws, 'Extension TikTok Ads', c_kalia, k_kalia, stages[4], me, 1500, 'monthly', 'Recommandation', '{Creative strategy}', current_date + 5, 1000),
    (ws, 'Refonte tracking CPF', c_forma, k_forma, stages[5], me, 1200, 'one_off', 'Recommandation', '{Setup tracking}', current_date + 3, 1000);
  insert into deals (workspace_id, title, company_id, contact_id, stage_id, owner_id, value, billing, source, services, expected_close, position)
    values (ws, 'Acquisition SaaS B2B', c_nova, k_nova, stages[3], me, 4500, 'monthly', 'LinkedIn', '{Gestion Meta Ads,Gestion Google Ads,Creative strategy}', current_date + 20, 1000)
    returning id into deal_nova;
  insert into deals (workspace_id, title, company_id, contact_id, stage_id, owner_id, value, billing, source, services, expected_close, position, closed_at) values
    (ws, 'Gestion Meta + créas', c_lumen, k_lumen, stages[6], me, 3000, 'monthly', 'Recommandation', '{Gestion Meta Ads,Production de créas}', current_date - 40, 1000, now() - interval '40 days'),
    (ws, 'Creative strategy + Meta', c_kalia, k_kalia, stages[6], me, 3300, 'monthly', 'Malt', '{Creative strategy,Gestion Meta Ads}', current_date - 70, 2000, now() - interval '70 days');
  insert into deals (workspace_id, title, company_id, stage_id, owner_id, value, billing, source, services, expected_close, position, closed_at, lost_reason) values
    (ws, 'Relance saison printemps', c_oasis, stages[7], me, 2000, 'monthly', 'Prospection', '{Gestion Meta Ads}', current_date - 15, 1000, now() - interval '15 days', 'Budget gelé jusqu''au printemps');

  insert into crm_activities (workspace_id, company_id, contact_id, kind, body, author_id, created_at) values
    (ws, c_brun, k_brun, 'call', 'Appel découverte : 2 poseurs, zone Lille + 40 km, budget pub 800 €/mois. Envoyer une proposition avant vendredi.', me, now() - interval '2 days'),
    (ws, c_nova, k_nova, 'meeting', 'Présentation de la méthode. Ils veulent un audit avant de signer la gestion.', me, now() - interval '5 days'),
    (ws, c_kalia, k_kalia, 'email', 'Envoi des benchmarks TikTok beauté et de 3 exemples de Spark Ads.', me, now() - interval '1 day');
  insert into crm_activities (workspace_id, company_id, kind, body, due_at, author_id) values
    (ws, c_brun, 'task', 'Relancer Julien pour la proposition', now() + interval '2 days', me),
    (ws, c_nova, 'task', 'Préparer l''audit des comptes Nova', now() + interval '4 days', me);

  -- ---------- Projets et tâches ----------
  insert into projects (workspace_id, company_id, key, name, description, status, color, icon, lead_id, platforms, monthly_budget, start_date, due_date)
  values (ws, c_lumen, 'LUM', 'Maison Lumen · Q4 Meta Ads', 'Scaling Meta Ads avant le Black Friday. Objectif ROAS 3,5 sur 12 k€ par mois.', 'active', 'amber', 'megaphone', me, '{meta}', 12000, current_date - 20, current_date + 45)
  returning id into p;
  insert into project_favorites (project_id, user_id) values (p, me);
  perform demo_task(p, 'Vérifier Pixel + API de conversions', 'done', 'high', me, -20, -16, '{Tracking}', '{Déduplication event_id,Score de qualité des événements,Test des achats}', 3);
  perform demo_task(p, 'Définir 3 angles pour la collection hiver', 'done', 'medium', me, -15, -12, '{Créa}');
  t1 := demo_task(p, 'Brief créa : 6 concepts statiques + 3 UGC', 'review', 'high', me, -10, -1, '{Créa,Client}', '{Angle cadeau de Noël,Angle cocooning,Angle design signé,Brief créateurs UGC}', 3, 'Validation attendue de Claire avant production.');
  t2 := demo_task(p, 'Textes publicitaires Black Friday (3 variantes)', 'progress', 'medium', me, -4, 2, '{Copy}', '{Primary text,Titres,Descriptions}', 1);
  t3 := demo_task(p, 'Structure Advantage+ Shopping', 'todo', 'high', me, 1, 5, '{Média}');
  t4 := demo_task(p, 'Mise en ligne campagnes Black Friday', 'todo', 'urgent', me, 6, 8, '{Média}');
  update tasks set milestone = true where id = t4;
  perform demo_task(p, 'Rapport de mi-parcours client', 'backlog', 'low', null, 14, 16, '{Reporting}');
  perform demo_task(p, 'Landing page dédiée Black Friday', 'backlog', 'medium', null, 2, 9, '{Landing}');
  insert into task_dependencies (task_id, depends_on_id) values (t3, t1), (t4, t3), (t4, t2);
  insert into comments (workspace_id, task_id, author_id, body, created_at) values
    (ws, t1, me, 'Concepts 1 à 4 validés en interne, j''envoie la sélection à Claire ce soir.', now() - interval '3 hours');

  insert into projects (workspace_id, company_id, key, name, description, status, color, icon, lead_id, platforms, monthly_budget, start_date, due_date)
  values (ws, c_kalia, 'KAL', 'Kalia · Sprint créa octobre', 'Nouveau lot de concepts UGC pour relancer le compte, fatigue créa détectée.', 'risk', 'rose', 'palette', me, '{meta,tiktok}', 9000, current_date - 8, current_date + 12)
  returning id into p;
  insert into project_favorites (project_id, user_id) values (p, me);
  perform demo_task(p, 'Analyse des créas gagnantes de septembre', 'done', 'medium', me, -8, -6, '{Reporting,Créa}');
  perform demo_task(p, 'Veille Ad Library concurrents beauté', 'done', 'low', me, -7, -5, '{Créa}');
  t1 := demo_task(p, '8 nouveaux concepts (hooks + angles)', 'progress', 'high', me, -4, -1, '{Créa}', '{4 hooks problème/solution,2 hooks témoignage,2 hooks routine}', 5);
  t2 := demo_task(p, 'Scripts UGC et briefs créateurs', 'todo', 'high', me, 0, 3, '{Copy,Créa}');
  t3 := demo_task(p, 'Production et montage', 'todo', 'medium', null, 3, 9, '{Créa}');
  t4 := demo_task(p, 'Lancement du test créa', 'backlog', 'urgent', me, 10, 12, '{Média}');
  update tasks set milestone = true where id = t4;
  insert into task_dependencies (task_id, depends_on_id) values (t2, t1), (t3, t2), (t4, t3);

  insert into projects (workspace_id, company_id, key, name, description, status, color, icon, lead_id, platforms, monthly_budget, start_date, due_date)
  values (ws, c_velo, 'VEL', 'Vélo Nord · Google Ads', 'Search + Performance Max, optimisation des leads magasin.', 'active', 'teal', 'target', me, '{google}', 4500, current_date - 30, current_date + 60)
  returning id into p;
  perform demo_task(p, 'Nettoyage des termes de recherche', 'done', 'medium', me, -9, -7, '{Média}');
  perform demo_task(p, 'Conversions offline depuis le CRM magasin', 'progress', 'high', me, -5, 4, '{Tracking}', '{Export CRM,Import GCLID,Vérification}', 1);
  perform demo_task(p, 'Nouvelles annonces RSA saison hiver', 'todo', 'medium', me, 2, 6, '{Copy}');
  perform demo_task(p, 'Test enchères tROAS sur PMax', 'backlog', 'low', null, 8, 20, '{Média}');
  perform demo_task(p, 'Point mensuel avec Thomas', 'todo', 'medium', me, 9, 9, '{Client}');

  insert into projects (workspace_id, company_id, key, name, description, status, color, icon, lead_id, platforms, monthly_budget, start_date, due_date)
  values (ws, c_forma, 'FOR', 'FormaPro · Suivi mensuel', 'Leads CPF sur Meta et Google, reporting mensuel au directeur.', 'active', 'blue', 'chart-column', me, '{meta,google}', 6000, current_date - 25, current_date + 5)
  returning id into p;
  perform demo_task(p, 'Optimisation semaine 1', 'done', 'medium', me, -25, -18, '{Média}');
  perform demo_task(p, 'Optimisation semaine 2', 'done', 'medium', me, -18, -11, '{Média}');
  perform demo_task(p, 'Optimisation semaine 3', 'done', 'medium', me, -11, -4, '{Média}');
  perform demo_task(p, 'Rapport mensuel et recommandations', 'progress', 'high', me, -3, 1, '{Reporting}');
  perform demo_task(p, 'Point mensuel avec Marc', 'todo', 'medium', me, 4, 5, '{Client}');
  perform demo_task(p, 'Corriger le formulaire qui ne remonte plus les leads', 'todo', 'urgent', me, -2, -1, '{Bug,Tracking}');

  insert into projects (workspace_id, company_id, key, name, description, status, color, icon, lead_id, platforms, start_date, due_date)
  values (ws, c_brun, 'ATB', 'Atelier Brun · Onboarding', 'Préparation en attendant la signature.', 'planning', 'violet', 'briefcase', me, '{google}', current_date + 5, current_date + 20)
  returning id into p;
  perform demo_task(p, 'Récupérer les accès Google Ads et GA4', 'backlog', 'medium', null, 5, 7, '{Client}');
  perform demo_task(p, 'Audit du tracking', 'backlog', 'medium', null, 7, 10, '{Tracking}');
  perform demo_task(p, 'Plan média local', 'backlog', 'medium', null, 10, 14, '{Média}');

  insert into activity (workspace_id, project_id, actor_id, verb, meta, created_at)
    select ws, pr.id, me, 'project.created', jsonb_build_object('name', pr.name), pr.created_at from projects pr where pr.workspace_id = ws;

  -- ---------- Propositions ----------
  insert into proposals (workspace_id, title, company_id, contact_id, deal_id, status, valid_until, sent_at, viewed_at, blocks)
  values (ws, 'Acquisition payante Nova SaaS', c_nova, k_nova, deal_nova, 'viewed', current_date + 14, now() - interval '2 days', now() - interval '1 day',
    jsonb_build_array(
      jsonb_build_object('id', 'b1', 'type', 'heading', 'text', 'Votre contexte'),
      jsonb_build_object('id', 'b2', 'type', 'text', 'text', 'Nova SaaS génère aujourd''hui ses démos via le bouche-à-oreille et LinkedIn organique. L''objectif est de construire un canal payant prévisible : 60 démos qualifiées par mois à moins de 150 € la démo.'),
      jsonb_build_object('id', 'b3', 'type', 'heading', 'text', 'Notre approche'),
      jsonb_build_object('id', 'b4', 'type', 'text', 'text', 'Un mois de fondations (tracking, audit, angles), puis des cycles de test créa de deux semaines sur Meta et Google Search.'),
      jsonb_build_object('id', 'b5', 'type', 'timeline', 'steps', jsonb_build_array(
        jsonb_build_object('title', 'Fondations', 'detail', 'Audit, tracking serveur, recherche d''angles', 'duration', 'Semaines 1-2'),
        jsonb_build_object('title', 'Lancement', 'detail', 'Campagnes Search + Meta, 8 premières créas', 'duration', 'Semaines 3-4'),
        jsonb_build_object('title', 'Optimisation', 'detail', 'Tests créa bimensuels, reporting hebdo', 'duration', 'Mois 2 et suivants'))),
      jsonb_build_object('id', 'b6', 'type', 'kpis', 'items', jsonb_build_array(
        jsonb_build_object('label', 'Démos qualifiées / mois', 'value', '60'),
        jsonb_build_object('label', 'Coût par démo cible', 'value', '< 150 €'),
        jsonb_build_object('label', 'Délai premiers résultats', 'value', '30 jours'))),
      jsonb_build_object('id', 'b7', 'type', 'heading', 'text', 'Investissement'),
      jsonb_build_object('id', 'b8', 'type', 'pricing')))
  returning id into prop;
  insert into proposal_items (proposal_id, service_id, name, description, quantity, unit_price, billing, optional, position)
    select prop, s.id, s.name, s.description, 1, s.unit_price, s.billing, s.name = 'Production de créas', s.position
    from services s where s.workspace_id = ws and s.name in ('Setup tracking', 'Gestion Meta Ads', 'Gestion Google Ads', 'Creative strategy', 'Production de créas');

  insert into proposals (workspace_id, title, company_id, contact_id, status, valid_until, blocks)
  values (ws, 'Google Ads local Atelier Brun', c_brun, k_brun, 'draft', current_date + 21,
    jsonb_build_array(
      jsonb_build_object('id', 'b1', 'type', 'heading', 'text', 'Objectif'),
      jsonb_build_object('id', 'b2', 'type', 'text', 'text', 'Générer 15 demandes de devis qualifiées par mois dans un rayon de 40 km autour de Lille.'),
      jsonb_build_object('id', 'b3', 'type', 'pricing')))
  returning id into prop;
  insert into proposal_items (proposal_id, service_id, name, description, quantity, unit_price, billing, position)
    select prop, s.id, s.name, s.description, 1, s.unit_price, s.billing, s.position
    from services s where s.workspace_id = ws and s.name in ('Setup tracking', 'Gestion Google Ads');

  insert into proposals (workspace_id, title, company_id, contact_id, status, sent_at, viewed_at, accepted_at, accepted_name, blocks)
  values (ws, 'Gestion Meta Ads et créas', c_lumen, k_lumen, 'accepted', now() - interval '45 days', now() - interval '44 days', now() - interval '40 days', 'Claire Dubois',
    jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'pricing')))
  returning id into prop;
  insert into proposal_items (proposal_id, service_id, name, description, quantity, unit_price, billing, position)
    select prop, s.id, s.name, s.description, 1, s.unit_price, s.billing, s.position
    from services s where s.workspace_id = ws and s.name in ('Gestion Meta Ads', 'Production de créas');

  -- ---------- Reporting : comptes de démo et 90 jours de métriques ----------
  for camp in
    select * from (values
      (c_lumen, 'meta', 'Maison Lumen · Meta', 'demo-lumen-meta', 'Advantage+ Shopping', 260.0, 3.6),
      (c_lumen, 'meta', 'Maison Lumen · Meta', 'demo-lumen-meta', 'Retargeting 30 j', 70.0, 5.2),
      (c_kalia, 'meta', 'Kalia · Meta', 'demo-kalia-meta', 'Prospection UGC', 220.0, 2.4),
      (c_kalia, 'meta', 'Kalia · Meta', 'demo-kalia-meta', 'Catalogue DPA', 80.0, 3.9),
      (c_velo, 'google', 'Vélo Nord · Google Ads', 'demo-velo-google', 'Search marque', 25.0, 9.0),
      (c_velo, 'google', 'Vélo Nord · Google Ads', 'demo-velo-google', 'Performance Max', 120.0, 3.1),
      (c_forma, 'meta', 'FormaPro · Meta', 'demo-forma-meta', 'Leads CPF', 120.0, 0.0),
      (c_forma, 'google', 'FormaPro · Google Ads', 'demo-forma-google', 'Search formation', 80.0, 0.0)
    ) as x(company, platform, acc_name, ext, campaign, daily, roas)
  loop
    insert into ad_accounts (workspace_id, company_id, platform, external_id, name, currency, last_synced_at)
      values (ws, camp.company, camp.platform, camp.ext, camp.acc_name, 'EUR', now())
      on conflict (workspace_id, platform, external_id) do update set name = excluded.name
      returning id into acc;
    for i in 0..89 loop
      d := current_date - 1 - i;
      -- variation pseudo-aléatoire stable + légère tendance à la hausse
      f := 0.75 + 0.5 * ((hashtext(camp.campaign || d::text) & 1023) / 1023.0) + (90 - i) * 0.003;
      insert into ad_metrics_daily (ad_account_id, workspace_id, date, campaign_id, campaign_name, spend, impressions, clicks, conversions, conversion_value)
      values (acc, ws, d, md5(camp.campaign), camp.campaign,
        round((camp.daily * f)::numeric, 2),
        round(camp.daily * f * (case when camp.platform = 'meta' then 95 else 40 end)),
        round(camp.daily * f * (case when camp.platform = 'meta' then 1.3 else 2.6 end)),
        round((camp.daily * f / (case when camp.roas = 0 then 22 else 55 end) * (0.8 + 0.4 * ((hashtext(d::text || camp.ext) & 255) / 255.0)))::numeric, 1),
        round((camp.daily * f * camp.roas * (0.85 + 0.3 * ((hashtext(camp.ext || d::text) & 255) / 255.0)))::numeric, 2));
    end loop;
  end loop;

  insert into kpi_targets (workspace_id, company_id, metric, target) values
    (ws, c_lumen, 'roas', 3.5), (ws, c_lumen, 'spend', 10000),
    (ws, c_kalia, 'roas', 3.0), (ws, c_kalia, 'cpa', 25),
    (ws, c_velo, 'roas', 4.0),
    (ws, c_forma, 'cpa', 25), (ws, c_forma, 'conversions', 250);

  insert into reports (workspace_id, company_id, title, period_start, period_end, commentary, next_steps, shared)
  values (ws, c_lumen, 'Rapport mensuel · Maison Lumen', date_trunc('month', current_date - interval '1 month')::date,
    (date_trunc('month', current_date) - interval '1 day')::date,
    'Mois solide : le ROAS progresse grâce aux nouvelles créas « cocooning » qui portent 42 % des ventes. Le retargeting reste très rentable mais plafonne en volume.',
    'Préparer le Black Friday : doubler le budget Advantage+ à partir du 15 novembre, lancer les 6 nouveaux concepts, tester une offre bundle.',
    true);
end $$;
revoke execute on function public.load_demo_data(uuid) from anon, public;

-- Suppression des données de démo (tout ce qui est rattaché aux entreprises de démo)
create or replace function public.clear_demo_data(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  delete from projects where workspace_id = ws and key in ('LUM', 'KAL', 'VEL', 'FOR', 'ATB')
    and company_id in (select id from companies where workspace_id = ws and name in ('Maison Lumen','Vélo Nord','Kalia Cosmetics','FormaPro','Atelier Brun'));
  delete from ad_accounts where workspace_id = ws and external_id like 'demo-%';
  delete from proposals where workspace_id = ws and company_id in (select id from companies where workspace_id = ws and name in ('Maison Lumen','Kalia Cosmetics','Nova SaaS','Atelier Brun'));
  delete from deals where workspace_id = ws and company_id in (select id from companies where workspace_id = ws and name in ('Maison Lumen','Vélo Nord','Kalia Cosmetics','FormaPro','Atelier Brun','Nova SaaS','Oasis Immobilier'));
  delete from companies where workspace_id = ws and name in ('Maison Lumen','Vélo Nord','Kalia Cosmetics','FormaPro','Atelier Brun','Nova SaaS','Oasis Immobilier');
end $$;
revoke execute on function public.clear_demo_data(uuid) from anon, public;
