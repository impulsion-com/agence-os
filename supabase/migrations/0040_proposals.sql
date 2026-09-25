-- =====================================================================
-- Propositions commerciales
-- 1. updated_at tenu à jour automatiquement
-- 2. public_proposal : renvoie aussi le contact, le responsable et
--    l'état « expirée », sans exposer les identifiants internes
-- 3. respond_proposal : à l'acceptation, le deal lié passe en « gagné »
--    (closed_at), journal proposal.accepted + deal.won ; au refus,
--    journal proposal.declined. Notification du responsable conservée.
-- 4. Accès anonyme : seules les deux RPC publiques restent appelables.
-- Migration additive : aucune table modifiée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_proposal()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists proposals_touch on public.proposals;
create trigger proposals_touch before update on public.proposals
  for each row execute function public.touch_proposal();

-- ---------------------------------------------------------------------
-- 2. Lecture publique par lien
-- ---------------------------------------------------------------------
create or replace function public.public_proposal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p proposals; res jsonb;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into p from proposals where public_token = p_token and status <> 'draft';
  if p.id is null then return null; end if;
  if p.viewed_at is null then
    update proposals set viewed_at = now(), status = case when status = 'sent' then 'viewed' else status end
    where id = p.id returning * into p;
  end if;
  select jsonb_build_object(
    'proposal', to_jsonb(p) - 'public_token' - 'owner_id' - 'deal_id' - 'workspace_id' - 'company_id' - 'contact_id',
    'expired', p.status in ('sent','viewed') and p.valid_until is not null and p.valid_until < current_date,
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'service_id' - 'proposal_id' order by i.position)
      from proposal_items i where i.proposal_id = p.id), '[]'::jsonb),
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent) from workspaces w where w.id = p.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = p.company_id),
    'contact', (select jsonb_build_object('first_name', k.first_name, 'last_name', k.last_name) from contacts k where k.id = p.contact_id),
    'owner', (select jsonb_build_object('full_name', pr.full_name, 'email', pr.email, 'title', pr.title) from profiles pr where pr.id = p.owner_id)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- 3. Réponse du client
-- ---------------------------------------------------------------------
create or replace function public.respond_proposal(p_token text, p_accept boolean, p_name text, p_reason text, p_selected uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  p proposals;
  won uuid;
  d deals;
begin
  select * into p from proposals where public_token = p_token and status in ('sent','viewed') for update;
  if p.id is null then raise exception 'Cette proposition n''est plus disponible.'; end if;
  if p.valid_until is not null and p.valid_until < current_date then
    raise exception 'Cette proposition a expiré.';
  end if;
  if p_accept and length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Merci d''indiquer votre nom complet.';
  end if;

  if p_accept then
    update proposal_items set selected = (not optional) or id = any(coalesce(p_selected, '{}'))
    where proposal_id = p.id;
  end if;

  update proposals set
    status = case when p_accept then 'accepted' else 'declined' end,
    accepted_at = case when p_accept then now() end,
    accepted_name = case when p_accept then left(trim(p_name), 120) end,
    declined_reason = case when p_accept then null else nullif(left(trim(coalesce(p_reason, '')), 500), '') end
  where id = p.id;

  insert into activity (workspace_id, deal_id, actor_id, verb, meta)
  values (p.workspace_id, p.deal_id, null,
    case when p_accept then 'proposal.accepted' else 'proposal.declined' end,
    jsonb_build_object('proposal_id', p.id, 'number', p.number, 'title', p.title,
      'name', case when p_accept then left(trim(p_name), 120) end));

  -- Deal lié : gagné à l'acceptation
  if p_accept and p.deal_id is not null then
    select * into d from deals where id = p.deal_id;
    select id into won from pipeline_stages
      where workspace_id = p.workspace_id and kind = 'won' order by position limit 1;
    if d.id is not null and won is not null and d.stage_id is distinct from won then
      update deals set stage_id = won, closed_at = now() where id = d.id;
      insert into activity (workspace_id, deal_id, actor_id, verb, meta)
      values (p.workspace_id, d.id, null, 'deal.won',
        jsonb_build_object('title', d.title, 'from', d.stage_id, 'to', won, 'via', 'proposal', 'proposal_id', p.id));
    end if;
  end if;

  if p.owner_id is not null then
    insert into notifications (workspace_id, user_id, kind, proposal_id, deal_id, body)
    values (p.workspace_id, p.owner_id, 'proposal', p.id, p.deal_id,
      case when p_accept then 'Proposition acceptée : ' else 'Proposition refusée : ' end || p.title);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Accès anonyme
-- Les tables sont protégées par RLS (aucune policy ne vise anon). Les
-- fonctions sont exécutables par PUBLIC par défaut : on retire l'accès
-- anonyme aux fonctions utilitaires des propositions.
-- ---------------------------------------------------------------------
revoke execute on function public.proposal_ws(uuid) from anon, public;
grant execute on function public.proposal_ws(uuid) to authenticated, service_role;

revoke execute on function public.public_proposal(text) from public;
revoke execute on function public.respond_proposal(text, boolean, text, text, uuid[]) from public;
grant execute on function public.public_proposal(text) to anon, authenticated;
grant execute on function public.respond_proposal(text, boolean, text, text, uuid[]) to anon, authenticated;
