-- =====================================================================
-- Portail client : fonctions de lecture et d'action (portal_*)
--
-- Suite de 0090_client_portal.sql. Rappel du modèle : un client n'est pas
-- membre de l'espace et ne lit aucune table en direct. Chaque fonction :
--   1. commence par `perform portal_require(p_company, '<fonctionnalité>')`,
--      puis vérifie que le module correspondant de l'espace est activé ;
--   2. ne reçoit que des identifiants et vérifie que chaque objet
--      appartient bien à p_company (jamais de confiance dans un id reçu) ;
--   3. ne renvoie que des colonnes choisies (ni notes internes, ni retainer,
--      ni données CRM, ni emails de l'équipe, ni commentaires internes) ;
--   4. est exécutable par `authenticated` seulement.
-- Les actions d'écriture sont refusées à un membre de l'espace en aperçu.
-- En fin de fichier : durcissement de fonctions et policies existantes
-- relevées par l'audit (un compte client est désormais « authenticated »
-- sans être membre).
-- Migration additive : aucune table modifiée (un index sur activity).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aides internes (non exécutables par les clients)
-- ---------------------------------------------------------------------
-- Module de l'espace dont dépend une fonctionnalité du portail
create or replace function public.portal_feature_module(p_feature text)
returns text language sql immutable as $$
  select case p_feature
    when 'reporting' then 'reporting'
    when 'tasks' then 'projects'
    when 'files' then 'projects'
    when 'creatives' then 'creatives'
    when 'documents' then 'proposals'
    when 'onboarding' then 'onboarding'
    when 'booking' then 'booking'
  end;
$$;

-- Fonctionnalités effectives : celles de portal_features(), moins celles dont le module
-- est désactivé dans l'espace (workspaces.modules : null, vide ou sans id connu = tous).
create or replace function public.portal_effective_features(p_company uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(
    select f from unnest(public.portal_features(p_company)) as f
    where exists (
      select 1 from companies c join workspaces w on w.id = c.workspace_id
      where c.id = p_company
        and (w.modules is null
             or not (w.modules && array['projects','crm','proposals','onboarding','booking','reporting','tracking','links','creatives'])
             or public.portal_feature_module(f) = any(w.modules))
    )
    order by array_position(public.portal_all_features(), f)
  ), '{}'::text[]);
$$;

-- À appeler juste après portal_require : refuse si le module de l'espace est désactivé
create or replace function public.portal_module_require(p_company uuid, p_feature text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (p_feature = any(public.portal_effective_features(p_company))) then
    raise exception 'fonctionnalité indisponible' using errcode = '42501';
  end if;
end $$;

-- Les actions (valider, commenter, déposer) sont réservées au client : refus en aperçu
create or replace function public.portal_require_write(p_company uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.portal_is_preview(p_company) then
    raise exception 'Aperçu du portail : cette action est réservée au client.' using errcode = '42501';
  end if;
end $$;

-- Accès au portail d'une entreprise, quelle que soit la fonctionnalité (page d'accueil)
create or replace function public.portal_has_access(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.portal_is_preview(p_company)
    or exists (
      select 1 from client_users cu join client_portals cp on cp.company_id = cu.company_id and cp.enabled
      where cu.company_id = p_company and cu.user_id = auth.uid()
    )
  );
$$;

-- Auteur tel qu'on le montre au client : prénom pour l'équipe de l'agence, nom complet pour un client. Jamais d'email.
create or replace function public.portal_person(p_user uuid, p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', case
      when p_user is null or pr.id is null then 'L''agence'
      when cu.id is not null then coalesce(nullif(trim(pr.full_name), ''), 'Client')
      else coalesce(nullif(split_part(trim(pr.full_name), ' ', 1), ''), 'L''agence') end,
    'client', cu.id is not null,
    'mine', p_user is not null and p_user = auth.uid(),
    'color', coalesce(pr.color, '#8A867E'))
  from (select 1) one
  left join profiles pr on pr.id = p_user
  left join client_users cu on cu.user_id = p_user and cu.company_id = p_company;
$$;

-- Tâches visibles par le client d'une entreprise (même règle que portal_task_visible)
create or replace function public.portal_company_tasks(p_company uuid)
returns setof public.tasks language sql stable security definer set search_path = public as $$
  select t.* from tasks t join projects p on p.id = t.project_id
  where p.company_id = p_company and p.archived_at is null and t.archived_at is null
    and (p.portal_mode = 'all' or (p.portal_mode = 'selected' and t.client_visible));
$$;

-- Fichiers partagés avec le client : pièces cochées « visible », d'un projet de l'entreprise non masqué
create or replace function public.portal_company_files(p_company uuid)
returns setof public.attachments language sql stable security definer set search_path = public as $$
  select a.* from attachments a
  left join tasks t on t.id = a.task_id
  join projects p on p.id = coalesce(a.project_id, t.project_id)
  where a.client_visible and p.company_id = p_company and p.archived_at is null and p.portal_mode <> 'none'
    and (t.id is null or t.archived_at is null);
$$;

revoke execute on function public.portal_feature_module(text), public.portal_module_require(uuid, text),
  public.portal_require_write(uuid), public.portal_has_access(uuid), public.portal_person(uuid, uuid),
  public.portal_company_tasks(uuid), public.portal_company_files(uuid) from anon, authenticated, public;
revoke execute on function public.portal_effective_features(uuid) from anon, public;
grant execute on function public.portal_effective_features(uuid) to authenticated;

-- Historique des décisions du client sur une créa (journal d'activité, meta.concept_id)
create index if not exists activity_concept on public.activity ((meta->>'concept_id')) where verb like 'creative.%';

-- ---------------------------------------------------------------------
-- Contexte du portail d'un espace (layout de /c/<slug>)
--  - client : ses entreprises dont le portail est activé ;
--  - membre de l'espace : toutes les entreprises (aperçu « voir comme le client ») ;
--  - sinon : null (un inconnu n'apprend rien, pas même le nom de l'agence).
-- Les fonctionnalités renvoyées sont croisées avec les modules de l'espace.
-- ---------------------------------------------------------------------
create or replace function public.portal_context(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  w workspaces; uid uuid := auth.uid(); is_m boolean; plist jsonb;
begin
  if uid is null then return null; end if;
  select * into w from workspaces where slug = p_slug;
  if w.id is null then return null; end if;
  is_m := exists (select 1 from workspace_members m where m.workspace_id = w.id and m.user_id = uid);

  if is_m then
    select coalesce(jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'company', c.name, 'color', c.color, 'welcome', coalesce(cp.welcome, ''),
        'enabled', coalesce(cp.enabled, false), 'features', to_jsonb(public.portal_effective_features(c.id)))
      order by coalesce(cp.enabled, false) desc, (cp.company_id is not null) desc, c.name), '[]'::jsonb) into plist
    from companies c left join client_portals cp on cp.company_id = c.id
    where c.workspace_id = w.id;
  else
    if not exists (select 1 from client_users cu where cu.workspace_id = w.id and cu.user_id = uid) then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'company', c.name, 'color', c.color, 'welcome', cp.welcome,
        'enabled', true, 'features', to_jsonb(public.portal_effective_features(c.id)))
      order by c.name), '[]'::jsonb) into plist
    from client_users cu
    join client_portals cp on cp.company_id = cu.company_id and cp.enabled
    join companies c on c.id = cu.company_id
    where cu.workspace_id = w.id and cu.user_id = uid;
  end if;

  return jsonb_build_object(
    'workspace', jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug, 'accent', w.accent, 'currency', w.currency),
    'preview', is_m,
    'user', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'color', p.color) from profiles p where p.id = uid),
    'unread', (select count(*) from notifications n
               where n.user_id = uid and n.workspace_id = w.id and n.read_at is null and n.archived_at is null
                 and (not is_m or n.kind = 'portal')),
    'portals', plist);
end $$;

-- ---------------------------------------------------------------------
-- Accueil : à valider, nouveautés, résumé de performance, dernier rapport,
-- rendez-vous, onboarding. Chaque bloc n'existe que si sa fonctionnalité est ouverte.
-- ---------------------------------------------------------------------
create or replace function public.portal_home(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); feats text[]; c companies; res jsonb; mail text;
  d_end date := current_date - 1; d_start date := current_date - 30; d_prev date := current_date - 60;
begin
  if not public.portal_has_access(p_company) then
    raise exception 'accès refusé' using errcode = '42501';
  end if;
  feats := public.portal_effective_features(p_company);
  select * into c from companies where id = p_company;

  res := jsonb_build_object(
    'company', jsonb_build_object('name', c.name, 'color', c.color),
    'welcome', coalesce((select cp.welcome from client_portals cp where cp.company_id = p_company), ''),
    'features', to_jsonb(feats));

  if 'tasks' = any(feats) then
    res := res || jsonb_build_object('review_tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_date', t.due_date,
               'project', (select p.name from projects p where p.id = t.project_id)) order by t.due_date nulls last, t.updated_at desc)
      from public.portal_company_tasks(p_company) t where t.status = 'review'), '[]'::jsonb));
  end if;

  if 'creatives' = any(feats) then
    res := res || jsonb_build_object('review_creatives', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'format', k.format,
               'cover', (select jsonb_build_object('id', a.id, 'name', a.name, 'mime', a.mime) from creative_assets a
                         where a.concept_id = k.id and (a.mime like 'image/%' or a.mime like 'video/%')
                         order by (a.path = k.cover_path) desc, (a.mime like 'image/%') desc, a.created_at limit 1))
             order by k.updated_at desc)
      from creative_concepts k where k.company_id = p_company and k.client_review = 'pending'), '[]'::jsonb));
  end if;

  if 'documents' = any(feats) then
    res := res || jsonb_build_object('review_proposals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'token', p.public_token, 'valid_until', p.valid_until) order by p.sent_at desc nulls last)
      from proposals p where p.company_id = p_company and p.status in ('sent', 'viewed')
        and (p.valid_until is null or p.valid_until >= current_date)), '[]'::jsonb));
  end if;

  -- Dernières nouveautés (ce que l'agence a partagé récemment)
  res := res || jsonb_build_object('news', coalesce((
    select jsonb_agg(u.j order by u.at desc) from (
      select x.at, x.j from (
        select r.created_at as at, jsonb_build_object('kind', 'report', 'id', r.id, 'title', r.title, 'at', r.created_at) as j
        from reports r where 'reporting' = any(feats) and r.company_id = p_company and r.shared
        union all
        select t.completed_at, jsonb_build_object('kind', 'task_done', 'id', t.id, 'title', t.title, 'at', t.completed_at)
        from public.portal_company_tasks(p_company) t
        where 'tasks' = any(feats) and t.status = 'done' and t.completed_at is not null
        union all
        select cm.created_at, jsonb_build_object('kind', 'comment', 'id', t.id, 'title', t.title, 'excerpt', left(cm.body, 140),
                 'by', public.portal_person(cm.author_id, p_company)->>'name', 'at', cm.created_at)
        from comments cm join public.portal_company_tasks(p_company) t on t.id = cm.task_id
        where 'tasks' = any(feats) and cm.visibility = 'client'
          and not exists (select 1 from client_users cu where cu.user_id = cm.author_id and cu.company_id = p_company)
        union all
        select a.created_at, jsonb_build_object('kind', 'file', 'id', a.id, 'title', a.name, 'at', a.created_at)
        from public.portal_company_files(p_company) a
        where 'files' = any(feats)
          and not exists (select 1 from client_users cu where cu.user_id = a.uploaded_by and cu.company_id = p_company)
        union all
        select k.updated_at, jsonb_build_object('kind', 'creative', 'id', k.id, 'title', k.title, 'at', k.updated_at)
        from creative_concepts k where 'creatives' = any(feats) and k.company_id = p_company and k.client_review = 'pending'
      ) x
      where x.at is not null
      order by x.at desc limit 8
    ) u), '[]'::jsonb));

  if 'reporting' = any(feats) then
    res := res || jsonb_build_object(
      'performance', (
        with m as (
          select d.date, sum(d.spend) as spend, sum(d.impressions) as impressions, sum(d.clicks) as clicks,
                 sum(d.conversions) as conversions, sum(d.conversion_value) as value
          from ad_metrics_daily d join ad_accounts a on a.id = d.ad_account_id
          where a.company_id = p_company and d.date between d_prev and d_end
          group by d.date
        )
        select jsonb_build_object(
          'start', d_start, 'end', d_end,
          'accounts', (select count(*) from ad_accounts a where a.company_id = p_company),
          'cur', jsonb_build_object(
            'spend', coalesce(sum(spend) filter (where date >= d_start), 0),
            'impressions', coalesce(sum(impressions) filter (where date >= d_start), 0),
            'clicks', coalesce(sum(clicks) filter (where date >= d_start), 0),
            'conversions', coalesce(sum(conversions) filter (where date >= d_start), 0),
            'value', coalesce(sum(value) filter (where date >= d_start), 0)),
          'prev', jsonb_build_object(
            'spend', coalesce(sum(spend) filter (where date < d_start), 0),
            'impressions', coalesce(sum(impressions) filter (where date < d_start), 0),
            'clicks', coalesce(sum(clicks) filter (where date < d_start), 0),
            'conversions', coalesce(sum(conversions) filter (where date < d_start), 0),
            'value', coalesce(sum(value) filter (where date < d_start), 0)),
          'series', coalesce(jsonb_agg(jsonb_build_object('date', date, 'spend', spend) order by date) filter (where date >= d_start), '[]'::jsonb)
        ) from m),
      'last_report', (
        select jsonb_build_object('id', r.id, 'title', r.title, 'period_start', r.period_start, 'period_end', r.period_end, 'created_at', r.created_at)
        from reports r where r.company_id = p_company and r.shared order by r.created_at desc limit 1));
  end if;

  if 'booking' = any(feats) then
    select u.email into mail from auth.users u where u.id = uid;
    res := res || jsonb_build_object('booking', jsonb_build_object(
      'slug', (select bp.slug from booking_profiles bp where bp.workspace_id = c.workspace_id and bp.user_id = c.owner_id and bp.active),
      'host', (select nullif(split_part(trim(coalesce(nullif(bp.display_name, ''), pr.full_name)), ' ', 1), '')
               from booking_profiles bp join profiles pr on pr.id = bp.user_id
               where bp.workspace_id = c.workspace_id and bp.user_id = c.owner_id and bp.active),
      'next', (select jsonb_build_object('title', b.title, 'start_at', b.start_at, 'end_at', b.end_at,
                 'location_kind', b.location_kind, 'meet_url', nullif(b.meet_url, ''),
                 'manage_token', case when mail is not null and lower(b.email) = lower(mail) then b.token end)
               from bookings b where b.company_id = p_company and b.status = 'confirmed' and b.end_at > now()
               order by b.start_at limit 1)));
  end if;

  if 'onboarding' = any(feats) then
    res := res || jsonb_build_object('onboarding', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'status', f.status, 'progress', f.progress, 'token', f.token) order by f.created_at desc)
      from onboarding_forms f where f.company_id = p_company and f.status <> 'completed'), '[]'::jsonb));
  end if;

  return res;
end $$;

-- ---------------------------------------------------------------------
-- Performance : même forme que public_report (réutilise ReportView et ses graphiques),
-- pour les comptes publicitaires de cette entreprise uniquement.
-- p_prev_start : début de la période de comparaison (par défaut, même durée juste avant).
-- ---------------------------------------------------------------------
create or replace function public.portal_reporting(p_company uuid, p_start date, p_end date, p_prev_start date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date; c companies;
begin
  perform public.portal_require(p_company, 'reporting');
  perform public.portal_module_require(p_company, 'reporting');
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'période invalide' using errcode = '22023';
  end if;
  v_from := coalesce(p_prev_start, p_start - (p_end - p_start) - 1);
  if v_from > p_start or p_start - v_from > 800 then v_from := p_start - (p_end - p_start) - 1; end if;
  select * into c from companies where id = p_company;
  return jsonb_build_object(
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = c.workspace_id),
    'company', jsonb_build_object('name', c.name),
    'targets', coalesce((select jsonb_object_agg(k.metric, k.target) from kpi_targets k where k.company_id = p_company), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency) order by a.name)
        from ad_accounts a where a.company_id = p_company), '[]'::jsonb),
    'synced_at', (select max(a.last_synced_at) from ad_accounts a where a.company_id = p_company),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id, 'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks,
        'conversions', m.conversions, 'value', m.conversion_value) order by m.date)
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = p_company and m.date between v_from and p_end), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'period_start', r.period_start,
        'period_end', r.period_end, 'created_at', r.created_at) order by r.period_end desc, r.created_at desc)
      from reports r where r.company_id = p_company and r.shared), '[]'::jsonb)
  );
end $$;

-- Rapport publié (reports.shared) de cette entreprise ; null s'il n'existe pas, n'est pas publié ou appartient à une autre entreprise
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
      'period_end', r.period_end, 'commentary', r.commentary, 'next_steps', r.next_steps, 'shared', r.shared, 'created_at', r.created_at),
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(k.metric, k.target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id, 'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks,
        'conversions', m.conversions, 'value', m.conversion_value) order by m.date)
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Projet : tâches visibles, fiche, commentaires partagés, validation
-- ---------------------------------------------------------------------
create or replace function public.portal_tasks(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'tasks');
  perform public.portal_module_require(p_company, 'tasks');
  return jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'icon', p.icon, 'status', p.status,
               'start_date', p.start_date, 'due_date', p.due_date) order by p.created_at)
      from projects p where p.company_id = p_company and p.archived_at is null and p.portal_mode <> 'none'), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'project_id', t.project_id, 'ref', p.key || '-' || t.number, 'title', t.title, 'status', t.status,
        'due_date', t.due_date, 'milestone', t.milestone, 'completed_at', t.completed_at, 'updated_at', t.updated_at,
        'assignee', (select nullif(split_part(trim(pr.full_name), ' ', 1), '') from profiles pr where pr.id = t.assignee_id),
        'labels', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'color', l.color) order by l.name)
                    from task_labels tl join labels l on l.id = tl.label_id where tl.task_id = t.id), '[]'::jsonb),
        'subtasks', (select count(*) from subtasks s where s.task_id = t.id),
        'subtasks_done', (select count(*) from subtasks s where s.task_id = t.id and s.done),
        'comments', (select count(*) from comments cm where cm.task_id = t.id and cm.visibility = 'client'),
        'files', (select count(*) from attachments a where a.task_id = t.id and a.client_visible)
      ) order by t.position, t.number)
      from public.portal_company_tasks(p_company) t join projects p on p.id = t.project_id), '[]'::jsonb)
  );
end $$;

create or replace function public.portal_task(p_company uuid, p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'tasks');
  perform public.portal_module_require(p_company, 'tasks');
  if p_task is null or not public.portal_task_visible(p_task, p_company) then
    raise exception 'tâche introuvable' using errcode = 'P0002';
  end if;
  return (
    select jsonb_build_object(
      'id', t.id, 'ref', p.key || '-' || t.number, 'title', t.title, 'description', t.description, 'status', t.status,
      'start_date', t.start_date, 'due_date', t.due_date, 'milestone', t.milestone,
      'completed_at', t.completed_at, 'created_at', t.created_at, 'updated_at', t.updated_at,
      'project', jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color),
      'assignee', (select nullif(split_part(trim(pr.full_name), ' ', 1), '') from profiles pr where pr.id = t.assignee_id),
      'labels', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'color', l.color) order by l.name)
                  from task_labels tl join labels l on l.id = tl.label_id where tl.task_id = t.id), '[]'::jsonb),
      'subtasks', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'done', s.done) order by s.position)
                    from subtasks s where s.task_id = t.id), '[]'::jsonb),
      -- Uniquement les commentaires partagés : un commentaire interne ne sort jamais d'ici
      'comments', coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'body', cm.body, 'created_at', cm.created_at,
                      'edited', cm.edited_at is not null, 'author', public.portal_person(cm.author_id, p_company)) order by cm.created_at)
                    from comments cm where cm.task_id = t.id and cm.visibility = 'client'), '[]'::jsonb),
      'files', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'size', a.size, 'mime', a.mime, 'created_at', a.created_at) order by a.created_at)
                 from attachments a where a.task_id = t.id and a.client_visible), '[]'::jsonb)
    )
    from tasks t join projects p on p.id = t.project_id where t.id = p_task
  );
end $$;

-- Réponse du client dans le fil partagé d'une tâche
create or replace function public.portal_task_comment(p_company uuid, p_task uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t tasks; pr projects; v text := left(trim(coalesce(p_body, '')), 4000); cid uuid; who text;
begin
  perform public.portal_require(p_company, 'tasks');
  perform public.portal_module_require(p_company, 'tasks');
  perform public.portal_require_write(p_company);
  if p_task is null or not public.portal_task_visible(p_task, p_company) then
    raise exception 'tâche introuvable' using errcode = 'P0002';
  end if;
  if length(v) < 1 then raise exception 'Votre message est vide.' using errcode = '22023'; end if;
  select * into t from tasks where id = p_task;
  select * into pr from projects where id = t.project_id;
  select full_name into who from profiles where id = auth.uid();

  -- L'agence est prévenue par le trigger notify_comment (responsable, créateur, chef de projet)
  insert into comments (workspace_id, task_id, author_id, body, visibility)
  values (t.workspace_id, t.id, auth.uid(), v, 'client') returning id into cid;
  insert into activity (workspace_id, project_id, task_id, actor_id, verb, meta)
  values (t.workspace_id, t.project_id, t.id, auth.uid(), 'task.commented',
    jsonb_build_object('title', t.title, 'key', pr.key || '-' || t.number, 'excerpt', left(v, 140), 'via', 'portal', 'by', who));
  return jsonb_build_object('id', cid);
end $$;

-- Validation d'une tâche en « Validation client » : valider (terminée) ou demander des modifications (en cours, commentaire obligatoire)
create or replace function public.portal_task_review(p_company uuid, p_task uuid, p_approve boolean, p_comment text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t tasks; pr projects; v text := left(trim(coalesce(p_comment, '')), 4000); nxt text; who text; ok boolean := coalesce(p_approve, false);
begin
  perform public.portal_require(p_company, 'tasks');
  perform public.portal_module_require(p_company, 'tasks');
  perform public.portal_require_write(p_company);
  if p_task is null or not public.portal_task_visible(p_task, p_company) then
    raise exception 'tâche introuvable' using errcode = 'P0002';
  end if;
  select * into t from tasks where id = p_task for update;
  if t.status <> 'review' then
    raise exception 'Cette tâche n''est plus en attente de validation.' using errcode = '22023';
  end if;
  if not ok and length(v) < 1 then
    raise exception 'Merci de préciser les modifications souhaitées.' using errcode = '22023';
  end if;
  select * into pr from projects where id = t.project_id;
  select full_name into who from profiles where id = auth.uid();
  nxt := case when ok then 'done' else 'progress' end;

  -- L'agence est prévenue par le trigger notify_task_status
  update tasks set status = nxt where id = t.id;
  if length(v) > 0 then
    insert into comments (workspace_id, task_id, author_id, body, visibility)
    values (t.workspace_id, t.id, auth.uid(), v, 'client');
  end if;
  insert into activity (workspace_id, project_id, task_id, actor_id, verb, meta)
  values (t.workspace_id, t.project_id, t.id, auth.uid(), 'task.status',
    jsonb_build_object('title', t.title, 'key', pr.key || '-' || t.number, 'from', 'review', 'to', nxt, 'via', 'portal',
      'decision', case when ok then 'approved' else 'changes' end, 'by', who));
  return jsonb_build_object('status', nxt);
end $$;

-- ---------------------------------------------------------------------
-- Créas soumises à validation (client_review non null). Ni métriques, ni notes internes,
-- ni brief créateur : titre, hook, angle, script, fichiers et décisions.
-- ---------------------------------------------------------------------
create or replace function public.portal_creatives(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'creatives');
  perform public.portal_module_require(p_company, 'creatives');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id, 'title', k.title, 'hook', k.hook, 'angle', k.angle, 'format', k.format, 'platforms', to_jsonb(k.platforms),
      'review', k.client_review, 'feedback', k.client_feedback, 'reviewed_at', k.client_reviewed_at,
      'reviewed_by', case when k.client_reviewed_by is not null then public.portal_person(k.client_reviewed_by, p_company)->>'name' end,
      'updated_at', k.updated_at,
      'assets', (select count(*) from creative_assets a where a.concept_id = k.id),
      'cover', (select jsonb_build_object('id', a.id, 'name', a.name, 'mime', a.mime) from creative_assets a
                where a.concept_id = k.id and (a.mime like 'image/%' or a.mime like 'video/%')
                order by (a.path = k.cover_path) desc, (a.mime like 'image/%') desc, a.created_at limit 1)
    ) order by (k.client_review = 'pending') desc, coalesce(k.client_reviewed_at, k.updated_at) desc)
    from creative_concepts k where k.company_id = p_company and k.client_review is not null), '[]'::jsonb);
end $$;

create or replace function public.portal_creative(p_company uuid, p_concept uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k creative_concepts;
begin
  perform public.portal_require(p_company, 'creatives');
  perform public.portal_module_require(p_company, 'creatives');
  select * into k from creative_concepts where id = p_concept and company_id = p_company and client_review is not null;
  if k.id is null then raise exception 'créa introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', k.id, 'title', k.title, 'hook', k.hook, 'angle', k.angle, 'format', k.format, 'platforms', to_jsonb(k.platforms),
    'script', coalesce(k.brief->>'script', ''), 'cta', coalesce(k.brief->>'cta', ''),
    'review', k.client_review, 'feedback', k.client_feedback, 'reviewed_at', k.client_reviewed_at,
    'reviewed_by', case when k.client_reviewed_by is not null then public.portal_person(k.client_reviewed_by, p_company)->>'name' end,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'hook', v.hook) order by v.position)
                  from creative_variants v where v.concept_id = k.id), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'size', a.size, 'mime', a.mime,
                  'variant', (select v.name from creative_variants v where v.id = a.variant_id), 'created_at', a.created_at)
                order by (a.path = k.cover_path) desc, a.created_at)
                from creative_assets a where a.concept_id = k.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', ac.created_at, 'verb', ac.verb, 'decision', ac.meta->>'decision',
                  'feedback', coalesce(ac.meta->>'feedback', ''), 'by', public.portal_person(ac.actor_id, p_company)->>'name') order by ac.created_at desc)
                from activity ac where ac.workspace_id = k.workspace_id and ac.verb in ('creative.reviewed', 'creative.submitted')
                  and ac.meta->>'concept_id' = k.id::text), '[]'::jsonb)
  );
end $$;

-- Décision du client sur une créa en attente : approuver, ou demander des modifications (commentaire obligatoire)
create or replace function public.portal_creative_review(p_company uuid, p_concept uuid, p_approve boolean, p_feedback text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k creative_concepts; v text := left(trim(coalesce(p_feedback, '')), 4000); ok boolean := coalesce(p_approve, false); decision text; who text;
begin
  perform public.portal_require(p_company, 'creatives');
  perform public.portal_module_require(p_company, 'creatives');
  perform public.portal_require_write(p_company);
  select * into k from creative_concepts where id = p_concept and company_id = p_company and client_review is not null for update;
  if k.id is null then raise exception 'créa introuvable' using errcode = 'P0002'; end if;
  if k.client_review <> 'pending' then
    raise exception 'Cette créa n''est plus en attente de validation.' using errcode = '22023';
  end if;
  if not ok and length(v) < 1 then
    raise exception 'Merci de préciser les modifications souhaitées.' using errcode = '22023';
  end if;
  decision := case when ok then 'approved' else 'changes' end;
  select full_name into who from profiles where id = auth.uid();

  -- L'agence est prévenue par le trigger notify_portal_concept
  update creative_concepts
  set client_review = decision, client_feedback = v, client_reviewed_at = now(), client_reviewed_by = auth.uid()
  where id = k.id;
  insert into activity (workspace_id, project_id, task_id, actor_id, verb, meta)
  values (k.workspace_id, k.project_id, k.task_id, auth.uid(), 'creative.reviewed',
    jsonb_build_object('concept_id', k.id, 'title', k.title, 'decision', decision, 'feedback', v, 'via', 'portal', 'by', who));
  return jsonb_build_object('review', decision);
end $$;

-- ---------------------------------------------------------------------
-- Fichiers : liste, chemins autorisés (la route serveur signe ensuite l'URL), dépôt
-- ---------------------------------------------------------------------
create or replace function public.portal_files(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'files');
  perform public.portal_module_require(p_company, 'files');
  return jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.created_at)
      from projects p where p.company_id = p_company and p.archived_at is null and p.portal_mode <> 'none'), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'size', a.size, 'mime', a.mime, 'created_at', a.created_at,
        'project', (select p.name from projects p where p.id = coalesce(a.project_id, (select t.project_id from tasks t where t.id = a.task_id))),
        'task', (select jsonb_build_object('id', t.id, 'title', t.title) from tasks t
                 where t.id = a.task_id and public.portal_task_visible(t.id, p_company)),
        'by', public.portal_person(a.uploaded_by, p_company)
      ) order by a.created_at desc)
      from public.portal_company_files(p_company) a), '[]'::jsonb)
  );
end $$;

-- Chemin Storage d'un fichier partagé (fonctionnalité « files »)
create or replace function public.portal_file_path(p_company uuid, p_file uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a attachments;
begin
  perform public.portal_require(p_company, 'files');
  perform public.portal_module_require(p_company, 'files');
  select f.* into a from public.portal_company_files(p_company) f where f.id = p_file;
  if a.id is null then raise exception 'fichier introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', a.path, 'name', a.name, 'mime', a.mime);
end $$;

-- Chemin Storage d'un fichier visible d'une tâche visible (fonctionnalité « tasks »)
create or replace function public.portal_task_file_path(p_company uuid, p_task uuid, p_file uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a attachments;
begin
  perform public.portal_require(p_company, 'tasks');
  perform public.portal_module_require(p_company, 'tasks');
  if p_task is null or not public.portal_task_visible(p_task, p_company) then
    raise exception 'fichier introuvable' using errcode = 'P0002';
  end if;
  select * into a from attachments where id = p_file and task_id = p_task and client_visible;
  if a.id is null then raise exception 'fichier introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', a.path, 'name', a.name, 'mime', a.mime);
end $$;

-- Chemin Storage d'un fichier d'une créa soumise au client (fonctionnalité « creatives »)
create or replace function public.portal_asset_path(p_company uuid, p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a creative_assets;
begin
  perform public.portal_require(p_company, 'creatives');
  perform public.portal_module_require(p_company, 'creatives');
  select x.* into a from creative_assets x join creative_concepts k on k.id = x.concept_id
  where x.id = p_asset and k.company_id = p_company and k.client_review is not null;
  if a.id is null then raise exception 'fichier introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', a.path, 'name', a.name, 'mime', a.mime);
end $$;

-- Dépôt d'un fichier par le client, étape 1 : le projet appartient bien à l'entreprise et accepte les dépôts
create or replace function public.portal_upload_target(p_company uuid, p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr projects;
begin
  perform public.portal_require(p_company, 'files');
  perform public.portal_module_require(p_company, 'files');
  perform public.portal_require_write(p_company);
  select * into pr from projects where id = p_project and company_id = p_company and archived_at is null and portal_mode <> 'none';
  if pr.id is null then raise exception 'projet introuvable' using errcode = 'P0002'; end if;
  if (select count(*) from attachments a where a.project_id = pr.id and a.path like pr.workspace_id || '/' || pr.id || '/portal/%') >= 500 then
    raise exception 'Limite de 500 fichiers déposés atteinte pour ce projet.' using errcode = '22023';
  end if;
  return jsonb_build_object('workspace_id', pr.workspace_id, 'project_id', pr.id);
end $$;

-- Dépôt, étape 2 : enregistre le fichier envoyé. Le chemin doit être un dépôt du portail
-- (<workspace>/<projet>/portal/<uuid>-<nom>) : impossible de faire pointer la pièce vers un fichier interne.
create or replace function public.portal_file_add(p_company uuid, p_project uuid, p_path text, p_name text, p_mime text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr projects; sz bigint; aid uuid; who text;
begin
  perform public.portal_require(p_company, 'files');
  perform public.portal_module_require(p_company, 'files');
  perform public.portal_require_write(p_company);
  select * into pr from projects where id = p_project and company_id = p_company and archived_at is null and portal_mode <> 'none';
  if pr.id is null then raise exception 'projet introuvable' using errcode = 'P0002'; end if;
  if p_path is null
     or p_path !~ ('^' || pr.workspace_id || '/' || pr.id || '/portal/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,140}$') then
    raise exception 'chemin refusé' using errcode = '42501';
  end if;
  select (o.metadata->>'size')::bigint into sz from storage.objects o where o.bucket_id = 'attachments' and o.name = p_path;
  if sz is null then raise exception 'Le fichier n''a pas été reçu, réessayez.' using errcode = '22023'; end if;
  if sz > 52428800 then raise exception 'Fichier trop lourd : 50 Mo maximum.' using errcode = '22023'; end if;
  if exists (select 1 from attachments a where a.path = p_path) then
    raise exception 'Ce fichier est déjà enregistré.' using errcode = '22023';
  end if;
  select full_name into who from profiles where id = auth.uid();
  insert into attachments (workspace_id, project_id, name, path, size, mime, uploaded_by, client_visible)
  values (pr.workspace_id, pr.id, left(coalesce(nullif(trim(p_name), ''), 'fichier'), 200), p_path, sz, left(coalesce(p_mime, ''), 120), auth.uid(), true)
  returning id into aid;
  insert into activity (workspace_id, project_id, actor_id, verb, meta)
  values (pr.workspace_id, pr.id, auth.uid(), 'file.uploaded',
    jsonb_build_object('attachment_id', aid, 'name', left(coalesce(p_name, ''), 200), 'via', 'portal', 'by', who));
  return jsonb_build_object('id', aid, 'size', sz);
end $$;

-- Retrait d'un fichier que le client a lui-même déposé (renvoie le chemin à supprimer du Storage)
create or replace function public.portal_file_remove(p_company uuid, p_file uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attachments;
begin
  perform public.portal_require(p_company, 'files');
  perform public.portal_module_require(p_company, 'files');
  perform public.portal_require_write(p_company);
  select f.* into a from public.portal_company_files(p_company) f
  where f.id = p_file and f.uploaded_by = auth.uid()
    and f.path like f.workspace_id || '/' || f.project_id || '/portal/%';
  if a.id is null then raise exception 'fichier introuvable' using errcode = 'P0002'; end if;
  delete from attachments where id = a.id;
  return jsonb_build_object('path', a.path);
end $$;

-- ---------------------------------------------------------------------
-- Documents : propositions (lien de signature et PDF signé), onboarding, rendez-vous
-- ---------------------------------------------------------------------
create or replace function public.portal_documents(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'documents');
  perform public.portal_module_require(p_company, 'documents');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'number', p.number, 'title', p.title, 'status', p.status, 'sent_at', p.sent_at, 'valid_until', p.valid_until,
      'accepted_at', p.accepted_at, 'token', p.public_token,
      'expired', p.status in ('sent', 'viewed') and p.valid_until is not null and p.valid_until < current_date,
      'signed_at', s.signed_at, 'countersign_required', coalesce(s.countersign_required, false), 'countersigned_at', s.countersigned_at
    ) order by coalesce(p.sent_at, p.created_at) desc)
    from proposals p left join proposal_signatures s on s.proposal_id = p.id
    where p.company_id = p_company and p.status <> 'draft'), '[]'::jsonb);
end $$;

create or replace function public.portal_onboarding(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'onboarding');
  perform public.portal_module_require(p_company, 'onboarding');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'status', f.status, 'progress', f.progress, 'token', f.token,
      'sent_at', f.sent_at, 'completed_at', f.completed_at) order by f.created_at desc)
    from onboarding_forms f where f.company_id = p_company), '[]'::jsonb);
end $$;

-- Page de réservation du responsable du client (companies.owner_id) et rendez-vous à venir de l'entreprise
create or replace function public.portal_booking(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c companies; bp booking_profiles; mail text;
begin
  perform public.portal_require(p_company, 'booking');
  perform public.portal_module_require(p_company, 'booking');
  select * into c from companies where id = p_company;
  select * into bp from booking_profiles where workspace_id = c.workspace_id and user_id = c.owner_id and active;
  select u.email into mail from auth.users u where u.id = auth.uid();
  return jsonb_build_object(
    'host', case when bp.id is not null then jsonb_build_object('slug', bp.slug, 'headline', bp.headline,
              'name', coalesce(nullif(bp.display_name, ''), (select pr.full_name from profiles pr where pr.id = bp.user_id))) end,
    'types', coalesce((select jsonb_agg(jsonb_build_object('slug', bt.slug, 'name', bt.name, 'description', bt.description,
                 'duration_min', bt.duration_min, 'location_kind', bt.location_kind) order by bt.position, bt.name)
               from booking_types bt where bt.profile_id = bp.id and bt.active), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'start_at', b.start_at, 'end_at', b.end_at,
                 'location_kind', b.location_kind, 'meet_url', nullif(b.meet_url, ''),
                 'location', case when b.location_kind in ('video', 'address') then nullif(b.location, '') end,
                 'host', (select nullif(split_part(trim(pr.full_name), ' ', 1), '') from profiles pr where pr.id = b.owner_id),
                 -- lien d'annulation ou de report : seulement pour la personne qui a réservé
                 'manage_token', case when mail is not null and lower(b.email) = lower(mail) then b.token end) order by b.start_at)
               from bookings b where b.company_id = p_company and b.status = 'confirmed' and b.end_at > now()), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Droits : authenticated seulement
-- ---------------------------------------------------------------------
revoke execute on function
  public.portal_context(text), public.portal_home(uuid),
  public.portal_reporting(uuid, date, date, date), public.portal_report(uuid, uuid),
  public.portal_tasks(uuid), public.portal_task(uuid, uuid), public.portal_task_comment(uuid, uuid, text),
  public.portal_task_review(uuid, uuid, boolean, text),
  public.portal_creatives(uuid), public.portal_creative(uuid, uuid), public.portal_creative_review(uuid, uuid, boolean, text),
  public.portal_files(uuid), public.portal_file_path(uuid, uuid), public.portal_task_file_path(uuid, uuid, uuid),
  public.portal_asset_path(uuid, uuid), public.portal_upload_target(uuid, uuid),
  public.portal_file_add(uuid, uuid, text, text, text), public.portal_file_remove(uuid, uuid),
  public.portal_documents(uuid), public.portal_onboarding(uuid), public.portal_booking(uuid)
  from anon, public;
grant execute on function
  public.portal_context(text), public.portal_home(uuid),
  public.portal_reporting(uuid, date, date, date), public.portal_report(uuid, uuid),
  public.portal_tasks(uuid), public.portal_task(uuid, uuid), public.portal_task_comment(uuid, uuid, text),
  public.portal_task_review(uuid, uuid, boolean, text),
  public.portal_creatives(uuid), public.portal_creative(uuid, uuid), public.portal_creative_review(uuid, uuid, boolean, text),
  public.portal_files(uuid), public.portal_file_path(uuid, uuid), public.portal_task_file_path(uuid, uuid, uuid),
  public.portal_asset_path(uuid, uuid), public.portal_upload_target(uuid, uuid),
  public.portal_file_add(uuid, uuid, text, text, text), public.portal_file_remove(uuid, uuid),
  public.portal_documents(uuid), public.portal_onboarding(uuid), public.portal_booking(uuid)
  to authenticated;

-- =====================================================================
-- Durcissements relevés par l'audit des fonctions security definer
-- exécutables par `authenticated` (un client l'est, sans être membre)
-- =====================================================================

-- 1. task_ws / project_ws / proposal_ws renvoyaient l'espace de n'importe quel identifiant :
--    un non-membre pouvait tester l'existence d'une tâche, d'un projet ou d'une proposition
--    et connaître son espace. Elles ne répondent plus qu'aux membres ; les policies qui les
--    utilisent (is_member(task_ws(...)), can_write(...)) donnent le même résultat qu'avant.
create or replace function public.task_ws(t uuid) returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from tasks where id = t and public.is_member(workspace_id) $$;
create or replace function public.project_ws(p uuid) returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from projects where id = p and public.is_member(workspace_id) $$;
create or replace function public.proposal_ws(p uuid) returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from proposals where id = p and public.is_member(workspace_id) $$;

-- 2. portal_task_visible répondait à tout compte connecté (oracle « cette tâche est-elle partagée
--    avec cette entreprise ? »). Elle ne répond plus qu'à un membre de l'espace, à un client ayant
--    la fonctionnalité « tasks », ou au service role (auth.uid() null, anon n'a pas le droit d'exécution).
create or replace function public.portal_task_visible(p_task uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.portal_is_preview(p_company) or public.portal_can(p_company, 'tasks'))
    and exists (
      select 1 from tasks t join projects p on p.id = t.project_id
      where t.id = p_task and p.company_id = p_company and p.archived_at is null and t.archived_at is null
        and (p.portal_mode = 'all' or (p.portal_mode = 'selected' and t.client_visible))
    );
$$;

-- 3. Commentaires : la policy « modif auteur » ne vérifiait que l'auteur. Un client est désormais
--    auteur de commentaires (portal_task_comment) : sans cette restriction, il pourrait modifier
--    sa ligne en direct (la déplacer sur une autre tâche, changer sa visibilité).
drop policy if exists "modif auteur" on public.comments;
create policy "modif auteur" on public.comments for update
  using (author_id = auth.uid() and public.is_member(workspace_id))
  with check (author_id = auth.uid() and public.is_member(workspace_id));
