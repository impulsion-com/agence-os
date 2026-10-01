-- =====================================================================
-- Portail client, côté agence
--
-- 1. Notifications : type « portal » (destinées à un client), lien relatif
--    au portail (portal_link) et concept lié (concept_id).
-- 2. Triggers vers le client : tâche visible à valider, commentaire partagé
--    écrit par l'agence, créa envoyée en validation, rapport publié,
--    fichier partagé.
-- 3. Retour vers l'agence : créa approuvée ou à modifier, fichier déposé par
--    un client (type « file »), statut changé par un client, commentaire d'un
--    client ; les notifications internes ne partent plus jamais vers un
--    compte client.
-- 4. Données de démo du portail.
--
-- Migration additive. Aucune policy RLS « client » : un client lit seulement
-- ses propres notifications (policy « notifs perso » existante).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. notifications : type « portal », lien portail, concept
-- ---------------------------------------------------------------------
-- La contrainte est réécrite avec toutes les valeurs déjà présentes en base
-- (relues dans sa définition) et la liste connue, plus « portal » (vers un client)
-- et « file » (fichier déposé par un client, vers l'agence).
do $$
declare def text; kinds text[];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if def is not null then
    select array_agg(m[1]) into kinds from regexp_matches(def, '''([a-z_]+)''', 'g') as m;
  end if;
  kinds := coalesce(kinds, '{}') || array[
    'assigned', 'mentioned', 'commented', 'status', 'due', 'invited', 'deal', 'proposal', 'onboarding', 'booking', 'creative', 'portal', 'file'
  ];
  select array_agg(distinct k) into kinds from unnest(kinds) k;
  if def is not null then
    alter table public.notifications drop constraint notifications_kind_check;
  end if;
  execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
    || (select string_agg(quote_literal(k), ', ' order by k) from unnest(kinds) k) || ']))';
end $$;

-- Chemin relatif au portail : tasks?task=<id>, creatives?c=<id>, performance?report=<id>, files, documents
alter table public.notifications add column if not exists portal_link text;
alter table public.notifications add column if not exists concept_id uuid references public.creative_concepts(id) on delete cascade;

-- ---------------------------------------------------------------------
-- 2. Vers le client
-- ---------------------------------------------------------------------
-- Une notification par personne du client ayant la fonctionnalité (portail activé).
-- p_dedupe : pas de nouvelle ligne si une notification non lue du même lien existe depuis moins longtemps.
create or replace function public.notify_portal_clients(
  p_company uuid, p_feature text, p_body text, p_link text,
  p_task uuid default null, p_project uuid default null, p_concept uuid default null, p_dedupe interval default null
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_company is null then return 0; end if;
  insert into notifications (workspace_id, user_id, actor_id, kind, task_id, project_id, concept_id, body, portal_link)
  select cu.workspace_id, cu.user_id, auth.uid(), 'portal', p_task, p_project, p_concept, left(p_body, 300), p_link
  from client_users cu
  join client_portals cp on cp.company_id = cu.company_id and cp.enabled
  where cu.company_id = p_company
    and p_feature = any(cp.features)
    and (cu.features is null or p_feature = any(cu.features))
    and cu.user_id is distinct from auth.uid()
    and (p_dedupe is null or not exists (
      select 1 from notifications x
      where x.user_id = cu.user_id and x.kind = 'portal' and x.portal_link = p_link
        and x.read_at is null and x.created_at > now() - p_dedupe));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.notify_portal_clients(uuid, text, text, text, uuid, uuid, uuid, interval) from anon, authenticated, public;

-- Tâche visible qui passe en « Validation client » (ou tâche en validation rendue visible)
create or replace function public.notify_portal_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare p projects;
begin
  if new.status <> 'review' or new.archived_at is not null then return new; end if;
  select * into p from projects where id = new.project_id;
  if p.company_id is null or p.archived_at is not null then return new; end if;
  if not (p.portal_mode = 'all' or (p.portal_mode = 'selected' and new.client_visible)) then return new; end if;
  if tg_op = 'UPDATE' then
    -- déjà à valider et déjà visible : rien de nouveau pour le client
    if old.status = 'review' and (p.portal_mode = 'all' or old.client_visible) then return new; end if;
  end if;
  perform notify_portal_clients(p.company_id, 'tasks', 'Une tâche attend votre validation : ' || new.title,
    'tasks?task=' || new.id, new.id, new.project_id);
  return new;
end $$;
drop trigger if exists tasks_notify_portal on public.tasks;
create trigger tasks_notify_portal after insert or update of status, client_visible on public.tasks
  for each row execute function public.notify_portal_task();

-- Commentaire partagé écrit par l'agence sur une tâche visible
create or replace function public.notify_portal_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare t tasks; p projects;
begin
  if new.visibility <> 'client' then return new; end if;
  select * into t from tasks where id = new.task_id;
  select * into p from projects where id = t.project_id;
  -- même règle que portal_task_visible, sans dépendre de l'identité de l'appelant
  if p.company_id is null or p.archived_at is not null or t.archived_at is not null
     or not (p.portal_mode = 'all' or (p.portal_mode = 'selected' and t.client_visible)) then
    return new;
  end if;
  -- écrit par une personne du client : c'est l'agence qui est prévenue (notify_comment)
  if exists (select 1 from client_users cu where cu.company_id = p.company_id and cu.user_id = new.author_id) then return new; end if;
  perform notify_portal_clients(p.company_id, 'tasks', 'Nouveau commentaire sur « ' || t.title || ' » : ' || left(new.body, 160),
    'tasks?task=' || t.id, t.id, t.project_id);
  return new;
end $$;
drop trigger if exists comments_notify_portal on public.comments;
create trigger comments_notify_portal after insert on public.comments
  for each row execute function public.notify_portal_comment();

-- Créa envoyée en validation (vers le client) ; réponse du client (vers l'agence)
create or replace function public.notify_portal_concept()
returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if tg_op = 'UPDATE' then
    if new.client_review is not distinct from old.client_review then return new; end if;
  end if;
  if new.client_review = 'pending' then
    perform notify_portal_clients(new.company_id, 'creatives', 'Une créa attend votre validation : ' || new.title,
      'creatives?c=' || new.id, null, null, new.id);
  elsif new.client_review in ('approved', 'changes') then
    -- responsable du concept, sinon du client, sinon les propriétaires de l'espace
    who := coalesce(new.owner_id, (select owner_id from companies where id = new.company_id));
    insert into notifications (workspace_id, user_id, actor_id, kind, concept_id, project_id, body)
    select new.workspace_id, m.user_id, auth.uid(), 'creative', new.id, new.project_id,
      (case new.client_review when 'approved' then 'Créa approuvée par le client : ' else 'Modifications demandées par le client : ' end) || new.title
    from workspace_members m
    where m.workspace_id = new.workspace_id
      and m.user_id is distinct from auth.uid()
      and (m.user_id = who or (who is null and m.role = 'owner')
           or (who is not null and m.role = 'owner'
               and not exists (select 1 from workspace_members x where x.workspace_id = new.workspace_id and x.user_id = who)));
  end if;
  return new;
end $$;
drop trigger if exists creative_concepts_notify_portal on public.creative_concepts;
create trigger creative_concepts_notify_portal after insert or update of client_review on public.creative_concepts
  for each row execute function public.notify_portal_concept();

-- Rapport publié
create or replace function public.notify_portal_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.shared then return new; end if;
  if tg_op = 'UPDATE' then
    if old.shared then return new; end if;
  end if;
  perform notify_portal_clients(new.company_id, 'reporting', 'Nouveau rapport disponible : ' || new.title,
    'performance?report=' || new.id);
  return new;
end $$;
drop trigger if exists reports_notify_portal on public.reports;
create trigger reports_notify_portal after insert or update of shared on public.reports
  for each row execute function public.notify_portal_report();

-- Fichier partagé par l'agence (une seule notification non lue par quart d'heure).
-- Fichier déposé par une personne du client : c'est l'agence qui est prévenue (responsable du projet,
-- sinon du client, sinon les propriétaires de l'espace).
create or replace function public.notify_portal_attachment()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; p projects; who uuid;
begin
  if not new.client_visible then return new; end if;
  if tg_op = 'UPDATE' then
    if old.client_visible then return new; end if;
  end if;
  pid := coalesce(new.project_id, (select project_id from tasks where id = new.task_id));
  -- un projet en mode « aucune tâche » ne montre rien au client, fichiers compris
  select * into p from projects where id = pid and archived_at is null and portal_mode <> 'none';
  if p.company_id is null then return new; end if;
  if exists (select 1 from client_users cu where cu.company_id = p.company_id and cu.user_id = new.uploaded_by) then
    if tg_op = 'INSERT' then
      who := coalesce(p.lead_id, (select owner_id from companies where id = p.company_id));
      insert into notifications (workspace_id, user_id, actor_id, kind, project_id, body)
      select p.workspace_id, m.user_id, new.uploaded_by, 'file', p.id, 'Fichier déposé par le client : ' || new.name
      from workspace_members m
      where m.workspace_id = p.workspace_id
        and m.user_id is distinct from new.uploaded_by
        and (m.user_id = who or (who is null and m.role = 'owner')
             or (who is not null and m.role = 'owner'
                 and not exists (select 1 from workspace_members x where x.workspace_id = p.workspace_id and x.user_id = who)));
    end if;
    return new;
  end if;
  perform notify_portal_clients(p.company_id, 'files', 'Nouveau fichier partagé : ' || new.name, 'files', null, pid, null, interval '15 minutes');
  return new;
end $$;
drop trigger if exists attachments_notify_portal on public.attachments;
create trigger attachments_notify_portal after insert or update of client_visible on public.attachments
  for each row execute function public.notify_portal_attachment();

-- ---------------------------------------------------------------------
-- 3. Vers l'agence
-- ---------------------------------------------------------------------
-- Commentaire : assigné et créateur de la tâche, s'ils sont membres de l'espace
-- (un commentaire interne ne part jamais vers un compte client). Si l'auteur est
-- un client, le responsable du projet est prévenu aussi.
create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare t tasks; lead uuid; from_client boolean;
begin
  select * into t from tasks where id = new.task_id;
  from_client := exists (select 1 from client_users cu where cu.workspace_id = t.workspace_id and cu.user_id = new.author_id)
    and not exists (select 1 from workspace_members m where m.workspace_id = t.workspace_id and m.user_id = new.author_id);
  if from_client then select lead_id into lead from projects where id = t.project_id; end if;
  insert into notifications (workspace_id, user_id, actor_id, kind, task_id, project_id, body)
  select t.workspace_id, u, new.author_id, 'commented', t.id, t.project_id, left(new.body, 200)
  from (select distinct unnest(array[t.assignee_id, t.created_by, lead]) as u) x
  where u is not null and u is distinct from new.author_id
    and exists (select 1 from workspace_members m where m.workspace_id = t.workspace_id and m.user_id = u);
  return new;
end $$;

-- Statut : validation client ou terminé (comme avant), et tout changement fait par un client
-- (demande de modification : la tâche repart en cours). Destinataires membres de l'espace uniquement.
create or replace function public.notify_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare lead uuid; from_client boolean;
begin
  if new.status is not distinct from old.status then return new; end if;
  from_client := auth.uid() is not null
    and exists (select 1 from client_users cu where cu.workspace_id = new.workspace_id and cu.user_id = auth.uid())
    and not exists (select 1 from workspace_members m where m.workspace_id = new.workspace_id and m.user_id = auth.uid());
  if new.status not in ('review', 'done') and not from_client then return new; end if;
  if from_client then select lead_id into lead from projects where id = new.project_id; end if;
  insert into notifications (workspace_id, user_id, actor_id, kind, task_id, project_id, body)
  select new.workspace_id, u, auth.uid(), 'status', new.id, new.project_id,
    (case old.status
      when 'backlog' then 'Backlog' when 'todo' then 'À faire' when 'progress' then 'En cours'
      when 'review' then 'Validation client' else 'Terminé' end) || ' → ' ||
    (case new.status
      when 'backlog' then 'Backlog' when 'todo' then 'À faire' when 'progress' then 'En cours'
      when 'review' then 'Validation client' else 'Terminé' end)
  from (select distinct unnest(array[new.created_by, new.assignee_id, lead]) as u) x
  where u is not null and u is distinct from auth.uid()
    and exists (select 1 from workspace_members m where m.workspace_id = new.workspace_id and m.user_id = u);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Données de démo du portail
-- ---------------------------------------------------------------------
-- Portail activé pour Maison Lumen et Kalia Cosmetics, tâches en validation rendues
-- visibles, commentaires partagés, créas envoyées en validation, fichiers partagés.
-- Aucun compte client n'est créé : l'aperçu « Voir comme le client » suffit.
create or replace function public._demo_portal_texts()
returns text[] language sql immutable as $$
  select array[
    'Bonjour, les concepts sont prêts pour votre validation. Pouvez-vous nous confirmer l''angle retenu avant la mise en production ?',
    'Une première version sera disponible jeudi. Nous vous envoyons les variantes pour relecture dès qu''elles sont prêtes.',
    'Les scripts sont dans les fichiers partagés. Nous attendons votre feu vert pour lancer le tournage.'
  ]::text[];
$$;
revoke execute on function public._demo_portal_texts() from anon, authenticated, public;

create or replace function public._clear_demo_portal(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Notifications créées par le jeu de démo lui-même (sans acteur) : pas de doublon à chaque rechargement
  delete from notifications n using creative_concepts c
    where n.concept_id = c.id and c.workspace_id = ws and c.is_demo and n.actor_id is null;
  delete from notifications n using projects p
    where n.project_id = p.id and p.workspace_id = ws and p.key in ('LUM', 'KAL') and n.kind = 'portal' and n.actor_id is null;
  delete from comments c using tasks t, projects p
    where c.task_id = t.id and t.project_id = p.id and p.workspace_id = ws and p.key in ('LUM', 'KAL')
      and c.visibility = 'client' and c.body = any(_demo_portal_texts());
  update tasks t set client_visible = false from projects p
    where p.id = t.project_id and p.workspace_id = ws and p.key in ('LUM', 'KAL') and t.client_visible;
  update attachments a set client_visible = false from projects p
    where p.id = a.project_id and p.workspace_id = ws and p.key in ('LUM', 'KAL') and a.client_visible;
  delete from attachments where workspace_id = ws and path like '%/demo-portail-%';
  update creative_concepts set client_review = null, client_feedback = '', client_reviewed_at = null, client_reviewed_by = null
    where workspace_id = ws and is_demo and client_review is not null;
  -- Le réglage du portail est retiré seulement si personne n'y a été invité
  delete from client_portals cp
    where cp.workspace_id = ws
      and cp.company_id in (select id from companies where workspace_id = ws and name in ('Maison Lumen', 'Kalia Cosmetics'))
      and not exists (select 1 from client_users cu where cu.company_id = cp.company_id)
      and not exists (select 1 from client_invitations i where i.company_id = cp.company_id);
end $$;
revoke execute on function public._clear_demo_portal(uuid) from anon, authenticated, public;

create or replace function public._demo_portal(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_lumen uuid; c_kalia uuid; p_lum uuid; p_kal uuid; me uuid; t uuid; n int := 0; k int;
  texts text[] := _demo_portal_texts();
begin
  perform _clear_demo_portal(ws);
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' limit 1;
  select id into c_kalia from companies where workspace_id = ws and name = 'Kalia Cosmetics' limit 1;
  if c_lumen is null and c_kalia is null then return 0; end if;
  select id into p_lum from projects where workspace_id = ws and key = 'LUM' limit 1;
  select id into p_kal from projects where workspace_id = ws and key = 'KAL' limit 1;
  select user_id into me from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1;

  -- Portails
  insert into client_portals (company_id, workspace_id, enabled, features, welcome)
  select c.id, ws, true, portal_all_features(),
    'Bienvenue dans votre espace client. Vous y suivez l''avancement de vos campagnes, validez les créas et retrouvez vos rapports.'
  from companies c where c.id in (c_lumen, c_kalia)
  on conflict (company_id) do update set enabled = true, features = excluded.features, welcome = excluded.welcome, updated_at = now();

  -- Tâches visibles : celles en validation client, les jalons, la première en cours et la première terminée
  -- (le reste du projet reste interne, pour montrer la différence)
  update tasks x set client_visible = true
  from (
    select id, status, milestone, row_number() over (partition by project_id, status order by position) as rn
    from tasks where project_id in (p_lum, p_kal) and archived_at is null
  ) s
  where x.id = s.id and (s.status = 'review' or s.milestone or (s.status in ('progress', 'done') and s.rn = 1));
  get diagnostics k = row_count;
  n := n + k;

  -- Commentaires partagés (rédigés pour le client : vouvoiement)
  select id into t from tasks where project_id = p_lum and status = 'review' and archived_at is null order by position limit 1;
  if t is not null then
    insert into comments (workspace_id, task_id, author_id, body, visibility, created_at)
    values (ws, t, me, texts[1], 'client', now() - interval '2 hours');
    n := n + 1;
  end if;
  select id into t from tasks where project_id = p_lum and status = 'progress' and client_visible and archived_at is null order by position limit 1;
  if t is not null then
    insert into comments (workspace_id, task_id, author_id, body, visibility, created_at)
    values (ws, t, me, texts[2], 'client', now() - interval '1 day');
    n := n + 1;
  end if;
  select id into t from tasks where project_id = p_kal and status = 'review' and archived_at is null order by position limit 1;
  if t is not null then
    insert into comments (workspace_id, task_id, author_id, body, visibility, created_at)
    values (ws, t, me, texts[3], 'client', now() - interval '5 hours');
    n := n + 1;
  end if;

  -- Créas : trois en attente, une approuvée, une à modifier
  update creative_concepts set client_review = 'pending'
    where workspace_id = ws and is_demo
      and title in ('Avant / après : le salon sombre', 'Crème de pharmacie ou Kalia ?', 'Une dermato répond aux commentaires');
  get diagnostics k = row_count;
  n := n + k;
  update creative_concepts set client_review = 'approved', client_reviewed_at = now() - interval '3 days',
      client_feedback = 'Parfait pour nous, vous pouvez lancer la production.'
    where workspace_id = ws and is_demo and title = 'Unboxing coffret de Noël';
  update creative_concepts set client_review = 'changes', client_reviewed_at = now() - interval '1 day',
      client_feedback = 'Le visuel nous plaît. Merci d''écrire « jusqu''à -20 % » : toutes les suspensions ne sont pas concernées par l''offre.'
    where workspace_id = ws and is_demo and title = 'Black Friday : -20 % sur les suspensions';

  -- Fichiers : les trois plus récents de chaque projet de démo
  update attachments a set client_visible = true
  from (
    select id, row_number() over (partition by project_id order by created_at desc) as rn
    from attachments where project_id in (p_lum, p_kal)
  ) s
  where a.id = s.id and s.rn <= 3;
  get diagnostics k = row_count;
  return n + k;
end $$;
revoke execute on function public._demo_portal(uuid) from anon, authenticated, public;
grant execute on function public._demo_portal(uuid) to service_role;
grant execute on function public._clear_demo_portal(uuid) to service_role;

-- Points d'entrée pour l'interface (réservés aux admins de l'espace)
create or replace function public.load_demo_portal(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_portal(ws);
end $$;
revoke execute on function public.load_demo_portal(uuid) from anon, public;
grant execute on function public.load_demo_portal(uuid) to authenticated;

create or replace function public.clear_demo_portal(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_portal(ws);
end $$;
revoke execute on function public.clear_demo_portal(uuid) from anon, public;
grant execute on function public.clear_demo_portal(uuid) to authenticated;
