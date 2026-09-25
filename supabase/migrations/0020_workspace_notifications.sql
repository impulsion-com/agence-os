-- =====================================================================
-- Boîte de réception et gestion des membres
-- 1. Notifications de changement de statut (validation client, terminé)
-- 2. Notifications commerciales : deal confié, deal gagné ou perdu
-- 3. Garde-fou : un espace garde toujours au moins un propriétaire, et
--    seul un propriétaire peut donner ou retirer ce rôle.
-- Migration additive : aucune table modifiée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Statut d'une tâche : prévient le créateur et l'assigné (sauf l'auteur
--    du changement) quand la tâche passe en validation client ou terminée.
-- ---------------------------------------------------------------------
create or replace function public.notify_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if new.status is distinct from old.status and new.status in ('review', 'done') then
    label := case new.status when 'review' then 'Validation client' else 'Terminé' end;
    insert into notifications (workspace_id, user_id, actor_id, kind, task_id, project_id, body)
    select new.workspace_id, u, auth.uid(), 'status', new.id, new.project_id,
      (case old.status
        when 'backlog' then 'Backlog' when 'todo' then 'À faire' when 'progress' then 'En cours'
        when 'review' then 'Validation client' else 'Terminé' end) || ' → ' || label
    from (select distinct unnest(array[new.created_by, new.assignee_id]) as u) x
    where u is not null and u is distinct from auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists tasks_notify_status on public.tasks;
create trigger tasks_notify_status after update of status on public.tasks
  for each row execute function public.notify_task_status();

-- ---------------------------------------------------------------------
-- 2. Deals : le responsable est prévenu quand on lui confie un deal,
--    et quand un deal dont il a la charge est gagné ou perdu par un autre.
-- ---------------------------------------------------------------------
create or replace function public.notify_deal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text;
begin
  if new.owner_id is not null and new.owner_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    insert into notifications (workspace_id, user_id, actor_id, kind, deal_id, body)
    values (new.workspace_id, new.owner_id, auth.uid(), 'deal', new.id, 'Deal confié : ' || new.title);
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id
     and new.owner_id is not null and new.owner_id is distinct from auth.uid() then
    select kind into k from pipeline_stages where id = new.stage_id;
    if k in ('won', 'lost') then
      insert into notifications (workspace_id, user_id, actor_id, kind, deal_id, body)
      values (new.workspace_id, new.owner_id, auth.uid(), 'deal', new.id,
        case k when 'won' then 'Deal gagné : ' else 'Deal perdu : ' end || new.title);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists deals_notify on public.deals;
create trigger deals_notify after insert or update of owner_id, stage_id on public.deals
  for each row execute function public.notify_deal();

-- ---------------------------------------------------------------------
-- 3. Propriétaires : au moins un par espace, rôle réservé aux propriétaires
-- ---------------------------------------------------------------------
create or replace function public.guard_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Suppression de l'espace entier (cascade) : rien à protéger
  if not exists (select 1 from workspaces where id = old.workspace_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and (old.role = 'owner' or new.role = 'owner') and old.role is distinct from new.role
     and auth.uid() is not null
     and not public.has_role(old.workspace_id, array['owner']::public.member_role[]) then
    raise exception 'Seul un propriétaire peut donner ou retirer le rôle de propriétaire';
  end if;

  if tg_op = 'DELETE' and old.role = 'owner' and old.user_id is distinct from auth.uid()
     and auth.uid() is not null
     and not public.has_role(old.workspace_id, array['owner']::public.member_role[]) then
    raise exception 'Seul un propriétaire peut retirer un autre propriétaire';
  end if;

  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from workspace_members
       where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id
     ) then
    raise exception 'L''espace doit garder au moins un propriétaire';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists members_guard_owner on public.workspace_members;
create trigger members_guard_owner before update of role or delete on public.workspace_members
  for each row execute function public.guard_owner();

-- ---------------------------------------------------------------------
-- 4. Résumé de la dépense publicitaire (carte Performance de l'accueil)
--    Période courante = les `days` derniers jours complets, comparée à la
--    période précédente de même durée. RLS appliquée (security invoker).
-- ---------------------------------------------------------------------
create or replace function public.spend_summary(ws uuid, days int default 7)
returns jsonb language sql stable security invoker set search_path = public as $$
  with m as (
    select date, sum(spend) as spend, sum(conversions) as conv, sum(conversion_value) as value
    from ad_metrics_daily
    where workspace_id = ws and date >= current_date - 2 * days and date < current_date
    group by date
  )
  select jsonb_build_object(
    'spend', coalesce(sum(spend) filter (where date >= current_date - days), 0),
    'prev_spend', coalesce(sum(spend) filter (where date < current_date - days), 0),
    'conversions', coalesce(sum(conv) filter (where date >= current_date - days), 0),
    'value', coalesce(sum(value) filter (where date >= current_date - days), 0),
    'prev_value', coalesce(sum(value) filter (where date < current_date - days), 0),
    'series', coalesce(jsonb_agg(jsonb_build_object('date', date, 'spend', spend) order by date)
      filter (where date >= current_date - days), '[]'::jsonb),
    'accounts', (select count(*) from ad_accounts where workspace_id = ws)
  ) from m;
$$;
grant execute on function public.spend_summary(uuid, int) to authenticated;
revoke execute on function public.spend_summary(uuid, int) from anon;
