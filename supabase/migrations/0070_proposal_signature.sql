-- =====================================================================
-- Signature électronique des propositions (eIDAS « simple »)
-- 1. proposals.countersign : contre-signature de l'agence demandée
-- 2. proposal_signatures : instantané figé, empreinte SHA-256, identité du
--    signataire, preuve (IP tronquée + hachée, user-agent), contre-signature
-- 3. proposal_signature_events : piste d'audit horodatée
-- 4. proposal_otps : codes de vérification d'email (hachés, 5 essais, 10 min)
-- 5. Verrou : une proposition signée n'est plus modifiable (ni ses lignes)
-- 6. Toute modification des lignes rafraîchit proposals.updated_at (sert de
--    version : le client signe exactement ce qu'il a relu)
-- 7. sign_proposal_commit : enregistrement atomique (service role seulement)
-- 8. respond_proposal : l'acceptation sans signature n'est plus possible
-- 9. Bucket Storage privé « signatures »
-- Écritures réservées au service role (routes /api/signature/*).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Réglage par proposition
-- ---------------------------------------------------------------------
alter table public.proposals add column if not exists countersign boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Signatures
-- ---------------------------------------------------------------------
create table if not exists public.proposal_signatures (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.proposals(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Contenu figé (blocs, lignes, options retenues, totaux, parties, signataire)
  snapshot jsonb not null,
  document_hash text not null,
  signed_at timestamptz not null,
  signer_first_name text not null,
  signer_last_name text not null,
  signer_role text not null default '',
  signer_company text not null default '',
  signer_email text not null,
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  mention text not null default '',
  consent_text text not null,
  signature_method text not null check (signature_method in ('drawn','typed')),
  signature_path text not null,
  signature_hash text not null,
  ip_trunc text,
  ip_hash text,
  user_agent text,
  pdf_path text,
  pdf_hash text,
  pdf_generated_at timestamptz,
  -- Contre-signature de l'agence
  countersign_required boolean not null default false,
  countersigned_at timestamptz,
  countersigner_id uuid references auth.users(id) on delete set null,
  countersigner_name text,
  countersigner_role text,
  countersign_method text check (countersign_method in ('drawn','typed')),
  countersign_path text,
  countersign_hash text,
  countersign_ip_trunc text,
  countersign_user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists proposal_signatures_ws on public.proposal_signatures (workspace_id);

-- ---------------------------------------------------------------------
-- 3. Piste d'audit
-- ---------------------------------------------------------------------
create table if not exists public.proposal_signature_events (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in (
    'sent','email_sent','reminder_sent','opened','otp_sent','otp_failed','otp_verified',
    'signed','pdf_generated','countersigned','declined','emails_sent'
  )),
  at timestamptz not null default now(),
  ip_trunc text,
  ip_hash text,
  user_agent text,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists proposal_signature_events_p on public.proposal_signature_events (proposal_id, at);

-- ---------------------------------------------------------------------
-- 4. Codes de vérification (jamais lisibles côté client)
-- ---------------------------------------------------------------------
create table if not exists public.proposal_otps (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  -- Jeton remis au navigateur une fois le code validé, exigé à la signature
  proof_hash text,
  created_at timestamptz not null default now()
);
create index if not exists proposal_otps_p on public.proposal_otps (proposal_id, created_at desc);

alter table public.proposal_signatures enable row level security;
alter table public.proposal_signature_events enable row level security;
alter table public.proposal_otps enable row level security;

drop policy if exists "lecture" on public.proposal_signatures;
create policy "lecture" on public.proposal_signatures for select using (public.is_member(workspace_id));
drop policy if exists "lecture" on public.proposal_signature_events;
create policy "lecture" on public.proposal_signature_events for select using (public.is_member(workspace_id));
-- proposal_otps : aucune policy, service role uniquement.

-- ---------------------------------------------------------------------
-- 5. Verrou des propositions signées
-- ---------------------------------------------------------------------
create or replace function public.proposal_signed_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from proposal_signatures where proposal_id = old.id)
     and (new.title, new.blocks, new.currency, new.discount_pct, new.tax_pct, new.valid_until, new.status,
          new.company_id, new.contact_id, new.public_token, new.accepted_at, new.accepted_name, new.countersign, new.workspace_id)
         is distinct from
         (old.title, old.blocks, old.currency, old.discount_pct, old.tax_pct, old.valid_until, old.status,
          old.company_id, old.contact_id, old.public_token, old.accepted_at, old.accepted_name, old.countersign, old.workspace_id)
  then
    raise exception 'Proposition signée : elle n''est plus modifiable. Duplique-la pour créer une nouvelle version.';
  end if;
  return new;
end $$;

drop trigger if exists proposals_signed_lock on public.proposals;
create trigger proposals_signed_lock before update on public.proposals
  for each row execute function public.proposal_signed_lock();

create or replace function public.proposal_items_signed_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.proposal_id, old.proposal_id);
begin
  -- La jointure sur proposals laisse passer les suppressions en cascade
  -- (la proposition n'existe déjà plus à ce moment-là).
  if exists (select 1 from proposal_signatures s join proposals p on p.id = s.proposal_id where s.proposal_id = pid)
     or (tg_op = 'UPDATE' and old.proposal_id is distinct from new.proposal_id
         and exists (select 1 from proposal_signatures where proposal_id = old.proposal_id)) then
    raise exception 'Proposition signée : ses lignes ne sont plus modifiables.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists proposal_items_signed_lock on public.proposal_items;
create trigger proposal_items_signed_lock before insert or update or delete on public.proposal_items
  for each row execute function public.proposal_items_signed_lock();

-- ---------------------------------------------------------------------
-- 6. Les lignes font partie du document : leur modification change la version
-- ---------------------------------------------------------------------
create or replace function public.proposal_items_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update proposals set updated_at = now()
  where id = coalesce(new.proposal_id, old.proposal_id)
    and not exists (select 1 from proposal_signatures s where s.proposal_id = proposals.id);
  return null;
end $$;

drop trigger if exists proposal_items_touch on public.proposal_items;
create trigger proposal_items_touch after insert or update or delete on public.proposal_items
  for each row execute function public.proposal_items_touch();

-- Envoi : journalisé dans la piste d'audit dès que sent_at est posé
create or replace function public.proposal_sent_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sent_at is not null and (tg_op = 'INSERT' or old.sent_at is distinct from new.sent_at) then
    insert into proposal_signature_events (proposal_id, workspace_id, kind, at, meta)
    values (new.id, new.workspace_id, 'sent', new.sent_at, jsonb_build_object('by', auth.uid()));
  end if;
  return null;
end $$;

drop trigger if exists proposals_sent_event on public.proposals;
create trigger proposals_sent_event after insert or update of sent_at on public.proposals
  for each row execute function public.proposal_sent_event();

-- ---------------------------------------------------------------------
-- 7. Enregistrement atomique d'une signature (appelé par la route serveur)
-- p_sig : colonnes de proposal_signatures (hors id, proposal_id, workspace_id)
-- ---------------------------------------------------------------------
create or replace function public.sign_proposal_commit(p_proposal uuid, p_version timestamptz, p_selected uuid[], p_sig jsonb, p_event jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  p proposals;
  d deals;
  won uuid;
  full_name text := left(trim(coalesce(p_sig->>'signer_first_name', '') || ' ' || coalesce(p_sig->>'signer_last_name', '')), 120);
  at timestamptz := (p_sig->>'signed_at')::timestamptz;
begin
  select * into p from proposals where id = p_proposal for update;
  if p.id is null or p.status not in ('sent','viewed') then
    raise exception 'Cette proposition n''est plus disponible à la signature.';
  end if;
  if p.valid_until is not null and p.valid_until < current_date then
    raise exception 'Cette proposition a expiré.';
  end if;
  if exists (select 1 from proposal_signatures where proposal_id = p.id) then
    raise exception 'Cette proposition est déjà signée.';
  end if;
  if date_trunc('milliseconds', p.updated_at) <> date_trunc('milliseconds', p_version) then
    raise exception 'VERSION: La proposition a été mise à jour depuis votre ouverture.';
  end if;

  update proposal_items set selected = (not optional) or id = any(coalesce(p_selected, '{}'))
  where proposal_id = p.id;

  update proposals set status = 'accepted', accepted_at = at, accepted_name = full_name, declined_reason = null
  where id = p.id;

  insert into proposal_signatures (
    proposal_id, workspace_id, snapshot, document_hash, signed_at,
    signer_first_name, signer_last_name, signer_role, signer_company, signer_email,
    email_verified, email_verified_at, mention, consent_text, signature_method, signature_path, signature_hash,
    ip_trunc, ip_hash, user_agent, countersign_required
  ) values (
    p.id, p.workspace_id, p_sig->'snapshot', p_sig->>'document_hash', at,
    p_sig->>'signer_first_name', p_sig->>'signer_last_name', coalesce(p_sig->>'signer_role', ''), coalesce(p_sig->>'signer_company', ''), p_sig->>'signer_email',
    coalesce((p_sig->>'email_verified')::boolean, false), (p_sig->>'email_verified_at')::timestamptz,
    coalesce(p_sig->>'mention', ''), p_sig->>'consent_text', p_sig->>'signature_method', p_sig->>'signature_path', p_sig->>'signature_hash',
    p_sig->>'ip_trunc', p_sig->>'ip_hash', p_sig->>'user_agent', p.countersign
  );

  insert into proposal_signature_events (proposal_id, workspace_id, kind, at, ip_trunc, ip_hash, user_agent, meta)
  values (p.id, p.workspace_id, 'signed', at, p_event->>'ip_trunc', p_event->>'ip_hash', p_event->>'user_agent',
    jsonb_build_object('name', full_name, 'email', p_sig->>'signer_email', 'hash', p_sig->>'document_hash'));

  insert into activity (workspace_id, deal_id, actor_id, verb, meta)
  values (p.workspace_id, p.deal_id, null, 'proposal.accepted',
    jsonb_build_object('proposal_id', p.id, 'number', p.number, 'title', p.title, 'name', full_name, 'signed', true));

  -- Deal lié : gagné à la signature
  if p.deal_id is not null then
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
      'Proposition signée par ' || full_name || ' : ' || p.title
      || case when p.countersign then ' (contre-signature attendue)' else '' end);
  end if;
end $$;

revoke execute on function public.sign_proposal_commit(uuid, timestamptz, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sign_proposal_commit(uuid, timestamptz, uuid[], jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 8. Réponse du client : le refus reste possible par RPC, l'acceptation
--    passe désormais par la signature électronique (/api/signature/…/sign).
-- ---------------------------------------------------------------------
create or replace function public.respond_proposal(p_token text, p_accept boolean, p_name text, p_reason text, p_selected uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare p proposals;
begin
  if p_accept then
    raise exception 'L''acceptation se fait par signature électronique depuis la page de la proposition.';
  end if;
  select * into p from proposals where public_token = p_token and status in ('sent','viewed') for update;
  if p.id is null then raise exception 'Cette proposition n''est plus disponible.'; end if;
  if p.valid_until is not null and p.valid_until < current_date then
    raise exception 'Cette proposition a expiré.';
  end if;

  update proposals set status = 'declined', accepted_at = null, accepted_name = null,
    declined_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
  where id = p.id;

  insert into activity (workspace_id, deal_id, actor_id, verb, meta)
  values (p.workspace_id, p.deal_id, null, 'proposal.declined',
    jsonb_build_object('proposal_id', p.id, 'number', p.number, 'title', p.title));

  insert into proposal_signature_events (proposal_id, workspace_id, kind, meta)
  values (p.id, p.workspace_id, 'declined', jsonb_build_object('reason', nullif(left(trim(coalesce(p_reason, '')), 500), '')));

  if p.owner_id is not null then
    insert into notifications (workspace_id, user_id, kind, proposal_id, deal_id, body)
    values (p.workspace_id, p.owner_id, 'proposal', p.id, p.deal_id, 'Proposition refusée : ' || p.title);
  end if;
end $$;

revoke execute on function public.respond_proposal(text, boolean, text, text, uuid[]) from public;
grant execute on function public.respond_proposal(text, boolean, text, text, uuid[]) to anon, authenticated;

revoke execute on function public.proposal_items_signed_lock() from public, anon;
revoke execute on function public.proposal_items_touch() from public, anon;
revoke execute on function public.proposal_sent_event() from public, anon;

-- ---------------------------------------------------------------------
-- 9. Stockage privé : <workspace_id>/<proposal_id>/{client,agency}-signature.png, signed.pdf
-- Lecture par les membres de l'espace, écriture par le service role seulement.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 10485760, array['image/png', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "signatures lecture" on storage.objects;
create policy "signatures lecture" on storage.objects for select
  using (case when bucket_id = 'signatures' then public.is_member(((storage.foldername(name))[1])::uuid) else false end);
