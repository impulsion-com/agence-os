-- =====================================================================
-- Prise de rendez-vous intégrée (alternative native à Cal.com)
-- + connecteur webhook Cal.com.
--
-- - booking_profiles : page publique d'un membre (/b/<slug>), fuseau,
--   plages hebdomadaires et agendas Google utilisés.
-- - booking_overrides : exceptions (congés, jours fériés, horaires spéciaux).
-- - booking_types : types de rendez-vous (durée, lieu, questions, règles).
-- - bookings : les rendez-vous (natifs ou reçus de Cal.com). Une contrainte
--   d'exclusion interdit deux rendez-vous confirmés qui se chevauchent.
-- - booking_google : jetons OAuth Google Agenda, sans aucune policy
--   (service role uniquement), vue booking_google_public sans secret.
-- - booking_settings : secret du webhook Cal.com (admins).
--
-- Migration additive. La contrainte de notifications.kind est élargie à
-- « booking » sans perdre les valeurs ajoutées par d'autres migrations.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.booking_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- /b/<slug> : unique sur toute l'instance (l'URL publique ne contient pas l'espace)
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  display_name text not null default '',
  headline text not null default '',
  welcome text not null default '',
  timezone text not null default 'Europe/Paris',
  -- Plages hebdomadaires, jours ISO (1 = lundi … 7 = dimanche) : {"1": [["09:00","12:00"],["14:00","18:00"]], …}
  weekly jsonb not null default '{"1":[["09:00","12:00"],["14:00","18:00"]],"2":[["09:00","12:00"],["14:00","18:00"]],"3":[["09:00","12:00"],["14:00","18:00"]],"4":[["09:00","12:00"],["14:00","18:00"]],"5":[["09:00","12:00"],["14:00","17:00"]],"6":[],"7":[]}'::jsonb,
  -- Google Agenda : agendas qui bloquent les créneaux, agenda où créer les évènements
  busy_calendars text[] not null default '{primary}',
  event_calendar text not null default 'primary',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.booking_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.booking_profiles(id) on delete cascade,
  day_start date not null,
  day_end date not null,
  label text not null default '',
  -- Horaires de remplacement ; vide = indisponible toute la journée
  ranges jsonb not null default '[]'::jsonb,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  check (day_end >= day_start)
);
create index on public.booking_overrides (profile_id, day_start);

create table public.booking_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.booking_profiles(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  name text not null,
  description text not null default '',
  duration_min int not null default 30 check (duration_min between 5 and 480),
  -- google_meet : lien Meet créé avec l'évènement ; phone : on appelle le prospect ;
  -- video : lien de visio fixe (location_value) ; address : adresse (location_value)
  location_kind text not null default 'google_meet' check (location_kind in ('google_meet', 'phone', 'video', 'address')),
  location_value text not null default '',
  -- Questions en plus du nom et de l'email : [{ key, label, type, required, options? }]
  questions jsonb not null default '[{"key":"phone","label":"Téléphone","type":"phone","required":false},{"key":"company","label":"Entreprise","type":"text","required":false},{"key":"website","label":"Site web","type":"url","required":false},{"key":"budget","label":"Budget publicitaire mensuel","type":"select","required":false,"options":["Moins de 1 000 €","1 000 à 3 000 €","3 000 à 10 000 €","Plus de 10 000 €"]},{"key":"message","label":"Qu''aimeriez-vous aborder ?","type":"textarea","required":false}]'::jsonb,
  min_notice_min int not null default 240 check (min_notice_min between 0 and 43200),
  horizon_days int not null default 30 check (horizon_days between 1 and 180),
  buffer_before_min int not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min int not null default 0 check (buffer_after_min between 0 and 240),
  -- Pas entre deux créneaux proposés ; null = la durée du rendez-vous
  slot_interval_min int check (slot_interval_min is null or slot_interval_min between 5 and 240),
  daily_limit int check (daily_limit is null or daily_limit between 1 and 50),
  color text not null default 'indigo',
  -- Crée (ou retrouve) un deal au CRM à chaque réservation
  create_deal boolean not null default true,
  active boolean not null default true,
  position int not null default 0,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, slug)
);
create index on public.booking_types (workspace_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid references public.booking_profiles(id) on delete set null,
  type_id uuid references public.booking_types(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  source text not null default 'native' check (source in ('native', 'calcom')),
  -- uid Cal.com (ou identifiant de démo)
  external_id text,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- Tampons figés à la réservation (le type peut changer ensuite)
  buffer_before_min int not null default 0,
  buffer_after_min int not null default 0,
  -- Fuseau du prospect (affichage dans ses emails)
  timezone text not null default 'Europe/Paris',
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  company_name text not null default '',
  answers jsonb not null default '{}'::jsonb,
  location_kind text not null default 'google_meet',
  location text not null default '',
  meet_url text not null default '',
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  activity_id uuid references public.crm_activities(id) on delete set null,
  google_event_id text,
  google_calendar_id text,
  -- Jeton des liens d'annulation et de report envoyés au prospect
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  utm jsonb not null default '{}'::jsonb,
  page_url text not null default '',
  cancel_reason text not null default '',
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('guest', 'host', 'calcom')),
  reschedule_count int not null default 0,
  reminded_24h_at timestamptz,
  reminded_1h_at timestamptz,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  -- Anti double réservation : deux rendez-vous natifs confirmés d'un même membre ne se chevauchent jamais
  constraint bookings_no_overlap exclude using gist (profile_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status = 'confirmed' and profile_id is not null and source = 'native')
);
create unique index bookings_external_uniq on public.bookings (workspace_id, source, external_id) where external_id is not null;
create index on public.bookings (workspace_id, start_at desc);
create index on public.bookings (profile_id, start_at);
create index bookings_reminders on public.bookings (start_at) where status = 'confirmed';

-- Jetons Google Agenda : aucune policy, service role uniquement
create table public.booking_google (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create view public.booking_google_public with (security_invoker = false) as
  select workspace_id, user_id, email, last_error, created_at
  from public.booking_google
  where public.is_member(workspace_id);

-- Réglages de l'espace : secret du webhook Cal.com et membre qui reçoit ces rendez-vous
create table public.booking_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  calcom_secret text not null default encode(gen_random_bytes(24), 'hex'),
  calcom_user_id uuid references auth.users(id) on delete set null,
  calcom_last_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.booking_profiles enable row level security;
alter table public.booking_overrides enable row level security;
alter table public.booking_types enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_google enable row level security;
alter table public.booking_settings enable row level security;

-- Le membre modifie sa page ; un admin modifie toutes celles de l'espace
create or replace function public.booking_profile_editable(p uuid, ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from booking_profiles bp
    where bp.id = p and bp.workspace_id = ws
      and ((bp.user_id = auth.uid() and public.can_write(bp.workspace_id)) or public.is_admin(bp.workspace_id))
  );
$$;
revoke execute on function public.booking_profile_editable(uuid, uuid) from anon, public;

create policy "lecture membres" on public.booking_profiles for select using (public.is_member(workspace_id));
create policy "modif propre" on public.booking_profiles for update
  using ((user_id = auth.uid() and public.can_write(workspace_id)) or public.is_admin(workspace_id))
  with check ((user_id = auth.uid() and public.can_write(workspace_id)) or public.is_admin(workspace_id));

do $$
declare t text;
begin
  foreach t in array array['booking_types', 'booking_overrides'] loop
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "ajout propre" on public.%I for insert with check (public.booking_profile_editable(profile_id, workspace_id))', t);
    execute format('create policy "modif propre" on public.%I for update using (public.booking_profile_editable(profile_id, workspace_id)) with check (public.booking_profile_editable(profile_id, workspace_id))', t);
    execute format('create policy "suppression propre" on public.%I for delete using (public.booking_profile_editable(profile_id, workspace_id))', t);
  end loop;
end $$;

-- Rendez-vous : données personnelles des prospects, invisibles des invités (clients)
create policy "lecture équipe" on public.bookings for select using (public.can_write(workspace_id));
create policy "modif équipe" on public.bookings for update using (public.can_write(workspace_id));
create policy "suppression équipe" on public.bookings for delete using (public.can_write(workspace_id));

create policy "réglages admin" on public.booking_settings for select using (public.is_admin(workspace_id));
create policy "réglages admin ajout" on public.booking_settings for insert with check (public.is_admin(workspace_id));
create policy "réglages admin modif" on public.booking_settings for update using (public.is_admin(workspace_id));

-- ---------------------------------------------------------------------
-- Notifications : nouveau type « booking » (sans écraser les autres ajouts)
-- ---------------------------------------------------------------------
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
  where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if def is not null and position('''booking''' in def) = 0 then
    execute 'alter table public.notifications drop constraint notifications_kind_check';
    execute 'alter table public.notifications add constraint notifications_kind_check '
      || replace(def, 'ARRAY[', 'ARRAY[''booking''::text, ');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Page de réservation de chaque membre (créée à l'arrivée dans l'espace)
-- ---------------------------------------------------------------------
create or replace function public.booking_slugify(t text)
returns text language sql immutable set search_path = public as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(t, ''), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy')),
    '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.booking_ensure_profile(ws uuid, uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pid uuid; base text; s text; n int := 1; nm text; em text;
begin
  select id into pid from booking_profiles where workspace_id = ws and user_id = uid;
  if pid is not null then return pid; end if;
  select full_name, email into nm, em from profiles where id = uid;
  base := left(booking_slugify(coalesce(nullif(nm, ''), split_part(coalesce(em, ''), '@', 1))), 32);
  base := trim(both '-' from base);
  if length(base) < 2 then base := 'rdv-' || substr(replace(uid::text, '-', ''), 1, 6); end if;
  s := base;
  while exists (select 1 from booking_profiles where slug = s) loop
    n := n + 1;
    s := base || '-' || n;
  end loop;
  insert into booking_profiles (workspace_id, user_id, slug, display_name)
  values (ws, uid, s, coalesce(nm, '')) returning id into pid;
  insert into booking_types (workspace_id, profile_id, slug, name, description, duration_min, position)
  values (ws, pid, 'appel-decouverte', 'Appel découverte',
    '30 minutes pour faire connaissance, comprendre vos objectifs publicitaires et voir si nous pouvons vous aider.', 30, 0);
  return pid;
end $$;
revoke execute on function public.booking_ensure_profile(uuid, uuid) from anon, authenticated, public;

-- Page de l'utilisateur courant (créée au besoin, sauf pour un invité)
create or replace function public.booking_my_profile(ws uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write(ws) then return null; end if;
  return booking_ensure_profile(ws, auth.uid());
end $$;
grant execute on function public.booking_my_profile(uuid) to authenticated;
revoke execute on function public.booking_my_profile(uuid) from anon, public;

create or replace function public.booking_member_joined()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'guest' then perform booking_ensure_profile(new.workspace_id, new.user_id); end if;
  return new;
end $$;
drop trigger if exists members_booking_profile on public.workspace_members;
create trigger members_booking_profile after insert on public.workspace_members
  for each row execute function public.booking_member_joined();

select public.booking_ensure_profile(workspace_id, user_id) from public.workspace_members where role <> 'guest';

-- =====================================================================
-- Données de démo : 2 types, disponibilités, une exception et 7 rendez-vous
-- (passés et à venir) reliés aux contacts de démo de 0003_demo_data.sql.
-- =====================================================================

-- n-ième jour ouvré (lundi-vendredi) à partir d'aujourd'hui (n < 0 : dans le passé)
create or replace function public._demo_bk_day(n int)
returns date language plpgsql stable set search_path = public as $$
declare d date := current_date; k int := 0; step int := case when n < 0 then -1 else 1 end;
begin
  while k < abs(n) loop
    d := d + step;
    if extract(isodow from d) < 6 then k := k + 1; end if;
  end loop;
  return d;
end $$;
revoke execute on function public._demo_bk_day(int) from anon, authenticated, public;

-- Générateur interne (service role ou autres fonctions) : ws + membre propriétaire des rendez-vous
create or replace function public._demo_booking(ws uuid, uid uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  pid uuid; t1 uuid; t2 uuid; tz text := 'Europe/Paris'; n int := 0;
  r record; ct record; aid uuid; st timestamptz; dur int; ty uuid; dl uuid; off date;
begin
  if uid is null then raise exception 'membre requis'; end if;
  pid := booking_ensure_profile(ws, uid);
  select timezone into tz from booking_profiles where id = pid;
  update booking_profiles set
    headline = case when headline = '' then 'Media buyer freelance · Meta Ads et Google Ads' else headline end,
    welcome = case when welcome = '' then 'Choisissez le créneau qui vous arrange. Vous recevez aussitôt la confirmation et le lien de la visio.' else welcome end
  where id = pid;

  select id into t1 from booking_types where profile_id = pid and slug = 'appel-decouverte';
  if t1 is null then
    insert into booking_types (workspace_id, profile_id, slug, name, duration_min, position)
    values (ws, pid, 'appel-decouverte', 'Appel découverte', 30, 0) returning id into t1;
  end if;
  update booking_types set buffer_after_min = 10, daily_limit = 4, min_notice_min = 720, horizon_days = 30 where id = t1;

  select id into t2 from booking_types where profile_id = pid and slug = 'point-client';
  if t2 is null then
    insert into booking_types (workspace_id, profile_id, slug, name, description, duration_min, location_kind, color,
      create_deal, questions, buffer_before_min, buffer_after_min, min_notice_min, horizon_days, position, demo)
    values (ws, pid, 'point-client', 'Point client mensuel',
      'Revue des résultats du mois, des tests créa en cours et du plan pour le mois suivant.', 45, 'google_meet', 'teal',
      false, '[{"key":"message","label":"Points à ajouter à l''ordre du jour","type":"textarea","required":false}]'::jsonb,
      5, 10, 1440, 45, 1, true)
    returning id into t2;
  end if;

  -- Exception : un vendredi de congé dans trois semaines
  if not exists (select 1 from booking_overrides where profile_id = pid and demo) then
    off := current_date + 14;
    off := off + ((5 - extract(isodow from off)::int + 7) % 7);
    insert into booking_overrides (workspace_id, profile_id, day_start, day_end, label, demo)
    values (ws, pid, off, off, 'Congés', true);
  end if;

  if exists (select 1 from bookings where workspace_id = ws and demo) then return 0; end if;

  for r in
    select * from (values
      ('sarah@novasaas.io', 'appel', -8, '14:30', 'completed', 'Acquisition SaaS B2B', '{"utm_source":"linkedin","utm_medium":"paid_social","utm_campaign":"audit-offert"}', '3 000 à 10 000 €', 'On lance une offre B2B et on veut un canal payant prévisible.'),
      ('lucas@kalia-cosmetics.com', 'point', -4, '11:00', 'no_show', null, '{}', null, null),
      ('marc.petit@formapro.fr', 'point', -2, '10:00', 'completed', null, '{}', null, 'Point sur le coût par lead CPF.'),
      ('claire@maisonlumen.fr', 'point', 1, '10:00', 'confirmed', null, '{}', null, 'Préparer le Black Friday.'),
      ('julien@atelier-brun.fr', 'appel', 2, '09:30', 'confirmed', 'Google Ads local', '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"search-media-buyer"}', '1 000 à 3 000 €', 'Je veux tester Google Ads sur Lille, on a 2 poseurs.'),
      ('thomas@velonord.com', 'point', 3, '15:00', 'confirmed', null, '{}', null, null),
      ('nadia@oasis-immo.fr', 'appel', 4, '16:00', 'cancelled', null, '{}', 'Moins de 1 000 €', null)
    ) as x(email, kind, day_off, hhmm, status, deal_title, utm, budget, message)
  loop
    select c.id, c.first_name, c.last_name, c.phone, c.company_id, co.name as company
      into ct from contacts c left join companies co on co.id = c.company_id
      where c.workspace_id = ws and lower(c.email) = r.email limit 1;
    ty := case when r.kind = 'appel' then t1 else t2 end;
    dur := case when r.kind = 'appel' then 30 else 45 end;
    st := ((_demo_bk_day(r.day_off)::timestamp + r.hhmm::time) at time zone tz);
    dl := null;
    if r.deal_title is not null then
      select id into dl from deals where workspace_id = ws and title = r.deal_title limit 1;
    end if;
    aid := null;
    if ct.id is not null then
      insert into crm_activities (workspace_id, deal_id, company_id, contact_id, kind, body, due_at, done, author_id, created_at)
      values (ws, dl, ct.company_id, ct.id, 'meeting',
        case when r.kind = 'appel' then 'Appel découverte' else 'Point client mensuel' end
          || case r.status when 'cancelled' then ' (annulé)' when 'no_show' then ' : absent' else '' end,
        st, r.status in ('completed', 'no_show'), uid, least(now(), st - interval '6 days'))
      returning id into aid;
    end if;
    insert into bookings (workspace_id, profile_id, type_id, owner_id, source, external_id, title, start_at, end_at,
      buffer_before_min, buffer_after_min, timezone, status, name, email, phone, company_name, answers,
      location_kind, meet_url, contact_id, company_id, deal_id, activity_id, utm, cancel_reason, cancelled_at, cancelled_by,
      demo, created_at)
    values (ws, pid, ty, uid, 'native', 'demo-' || n, case when r.kind = 'appel' then 'Appel découverte' else 'Point client mensuel' end,
      st, st + make_interval(mins => dur), case when r.kind = 'appel' then 0 else 5 end, 10, 'Europe/Paris', r.status,
      coalesce(trim(ct.first_name || ' ' || ct.last_name), split_part(r.email, '@', 1)), r.email, coalesce(ct.phone, ''), coalesce(ct.company, ''),
      jsonb_strip_nulls(jsonb_build_object('budget', r.budget, 'message', r.message, 'company', ct.company)),
      'google_meet', 'https://meet.google.com/demo-' || substr(md5(r.email), 1, 3) || '-' || substr(md5(r.email), 4, 4),
      ct.id, ct.company_id, dl, aid, r.utm::jsonb,
      case when r.status = 'cancelled' then 'Budget gelé jusqu''au printemps, je reviens vers vous.' else '' end,
      case when r.status = 'cancelled' then now() - interval '1 day' end,
      case when r.status = 'cancelled' then 'guest' end,
      true, least(now() - interval '1 hour', st - interval '6 days'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._demo_booking(uuid, uuid) from anon, authenticated, public;

create or replace function public._clear_demo_booking(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from crm_activities where id in (select activity_id from bookings where workspace_id = ws and demo and activity_id is not null);
  delete from bookings where workspace_id = ws and demo;
  delete from booking_types where workspace_id = ws and demo;
  delete from booking_overrides where workspace_id = ws and demo;
end $$;
revoke execute on function public._clear_demo_booking(uuid) from anon, authenticated, public;

create or replace function public.load_demo_booking(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_booking(ws, auth.uid());
end $$;
grant execute on function public.load_demo_booking(uuid) to authenticated;
revoke execute on function public.load_demo_booking(uuid) from anon, public;

create or replace function public.clear_demo_booking(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_booking(ws);
end $$;
grant execute on function public.clear_demo_booking(uuid) to authenticated;
revoke execute on function public.clear_demo_booking(uuid) from anon, public;
