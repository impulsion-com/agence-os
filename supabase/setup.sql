-- Agence OS : installation complète (généré par scripts/build-setup-sql.mjs, ne pas modifier à la main)
-- Migrations incluses : 0001_schema.sql, 0002_member_profile_fk.sql, 0003_demo_data.sql, 0005_revoke_anon_helpers.sql, 0020_workspace_notifications.sql, 0040_proposals.sql, 0050_reporting.sql, 0060_tracking_links.sql, 0061_tracking_attribution.sql, 0062_links.sql, 0063_tracking_secret.sql, 0064_demo_tracking_chunks.sql, 0070_proposal_signature.sql, 0071_onboarding.sql, 0072_creatives.sql, 0073_booking.sql, 0074_api_tokens.sql, 0080_workspace_modules.sql, 0082_creative_intel.sql, 0090_client_portal.sql, 0091_portal_rpc.sql, 0092_portal_agency.sql, 0095_analytics.sql, 0100_tracking_funnel_keys.sql, 0101_tracking_identity_signals.sql

-- =====================================================================
-- 0001_schema.sql
-- =====================================================================
-- =====================================================================
-- Agence OS : schéma initial
-- Un espace de travail (workspace) = une agence. Toutes les tables
-- métier portent workspace_id et sont protégées par RLS : on ne voit
-- que les lignes des espaces dont on est membre.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profils et espaces de travail
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  title text not null default '',
  color text not null default '#5A67D8',
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  accent text not null default 'indigo',
  currency text not null default 'EUR',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  icon text not null default 'users',
  color text not null default '#5A67D8',
  description text not null default '',
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'admin', 'member', 'guest');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  team_id uuid references public.teams(id) on delete set null,
  title text not null default '',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'member',
  team_id uuid references public.teams(id) on delete set null,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Fonctions d'appartenance (security definer pour éviter la récursion RLS)
create or replace function public.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.has_role(ws uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role = any(roles));
$$;

-- Un invité (guest) lit mais n'écrit pas sur les données métier
create or replace function public.can_write(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(ws, array['owner','admin','member']::public.member_role[]);
$$;

create or replace function public.is_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(ws, array['owner','admin']::public.member_role[]);
$$;

-- Deux utilisateurs partagent-ils un espace ? (lecture des profils)
create or replace function public.shares_workspace(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members a join workspace_members b using (workspace_id)
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Création automatique du profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Création d'un espace : le créateur devient propriétaire, avec les
-- valeurs par défaut d'une agence (équipes, étiquettes, pipeline).
create or replace function public.create_workspace(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into workspaces (name, slug, created_by) values (p_name, p_slug, auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  perform seed_workspace_defaults(ws);
  return ws;
end $$;

-- Acceptation d'une invitation par son jeton
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
  select * into inv from invitations where token = p_token and accepted_at is null;
  if inv.id is null then raise exception 'invitation invalide ou déjà utilisée'; end if;
  insert into workspace_members (workspace_id, user_id, role, team_id)
  values (inv.workspace_id, auth.uid(), inv.role, inv.team_id)
  on conflict (workspace_id, user_id) do nothing;
  update invitations set accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end $$;

-- ---------------------------------------------------------------------
-- CRM : entreprises, contacts, pipeline, deals, activités
-- ---------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  website text not null default '',
  industry text not null default '',
  -- lead : prospect ; client : client actif ; former : ancien client
  status text not null default 'lead' check (status in ('lead','client','former')),
  owner_id uuid references auth.users(id) on delete set null,
  monthly_retainer numeric(12,2),
  color text not null default '#5A67D8',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.companies (workspace_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  job_title text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.contacts (workspace_id);
create index on public.contacts (company_id);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position int not null default 0,
  probability int not null default 0 check (probability between 0 and 100),
  kind text not null default 'open' check (kind in ('open','won','lost')),
  color text not null default '#8A867E'
);
create index on public.pipeline_stages (workspace_id);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  value numeric(12,2) not null default 0,
  -- one_off : prestation ponctuelle ; monthly : retainer mensuel
  billing text not null default 'monthly' check (billing in ('one_off','monthly')),
  source text not null default '',
  services text[] not null default '{}',
  expected_close date,
  position double precision not null default 0,
  lost_reason text not null default '',
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.deals (workspace_id);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','call','email','meeting','task')),
  body text not null default '',
  due_at timestamptz,
  done boolean not null default false,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.crm_activities (workspace_id);

-- ---------------------------------------------------------------------
-- Gestion de projet
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  key text not null check (key ~ '^[A-Z0-9]{2,6}$'),
  seq int not null default 0,
  name text not null,
  description text not null default '',
  status text not null default 'planning' check (status in ('planning','active','risk','hold','complete')),
  color text not null default 'indigo',
  icon text not null default 'folder',
  lead_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  platforms text[] not null default '{}',
  monthly_budget numeric(12,2),
  start_date date,
  due_date date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);
create index on public.projects (workspace_id);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (project_id, user_id)
);

create table public.project_favorites (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  position int not null default 0,
  primary key (project_id, user_id)
);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null default 'gray'
);
create index on public.labels (workspace_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null,
  title text not null,
  description text not null default '',
  status text not null default 'todo' check (status in ('backlog','todo','progress','review','done')),
  priority text not null default 'none' check (priority in ('urgent','high','medium','low','none')),
  assignee_id uuid references auth.users(id) on delete set null,
  start_date date,
  due_date date,
  milestone boolean not null default false,
  recurrence text check (recurrence in ('daily','weekly','biweekly','monthly')),
  position double precision not null default 0,
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create index on public.tasks (workspace_id);
create index on public.tasks (project_id);
create index on public.tasks (assignee_id);

create table public.task_labels (
  task_id uuid not null references public.tasks(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (task_id, label_id)
);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  assignee_id uuid references auth.users(id) on delete set null,
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index on public.subtasks (task_id);

create table public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_id uuid not null references public.tasks(id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  body text not null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.comments (task_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  name text not null,
  path text not null,
  size bigint not null default 0,
  mime text not null default '',
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.attachments (project_id);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  icon text not null default 'filter',
  -- { layout, filters, sort, group }
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  verb text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity (workspace_id, created_at desc);
create index on public.activity (project_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('assigned','mentioned','commented','status','due','invited','deal','proposal')),
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  proposal_id uuid,
  body text not null default '',
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Propositions commerciales
-- ---------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  unit_price numeric(12,2) not null default 0,
  billing text not null default 'monthly' check (billing in ('one_off','monthly')),
  position int not null default 0,
  archived boolean not null default false
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number int not null,
  title text not null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','declined','expired')),
  -- blocs de contenu : [{ id, type: 'text'|'heading'|'pricing'|'timeline'|'kpis', ... }]
  blocks jsonb not null default '[]'::jsonb,
  currency text not null default 'EUR',
  discount_pct numeric(5,2) not null default 0,
  tax_pct numeric(5,2) not null default 20,
  valid_until date,
  public_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  accepted_name text,
  declined_reason text,
  owner_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);

create table public.proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  name text not null,
  description text not null default '',
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  billing text not null default 'monthly' check (billing in ('one_off','monthly')),
  optional boolean not null default false,
  selected boolean not null default true,
  position int not null default 0
);
create index on public.proposal_items (proposal_id);

-- ---------------------------------------------------------------------
-- Reporting publicitaire
-- ---------------------------------------------------------------------
-- Les jetons OAuth ne sont jamais lisibles côté client : aucune policy
-- sur cette table, seul le service role (routes serveur) y accède.
create table public.ad_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (platform in ('meta','google')),
  label text not null default '',
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Vue sans secrets, lisible par les membres
create view public.ad_connections_public with (security_invoker = false) as
  select id, workspace_id, platform, label, expires_at, created_at
  from public.ad_connections
  where public.is_member(workspace_id);

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.ad_connections(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  platform text not null check (platform in ('meta','google')),
  external_id text not null,
  name text not null,
  currency text not null default 'EUR',
  -- pour Google : compte MCC par lequel on accède (login-customer-id)
  login_customer_id text,
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);

create table public.ad_metrics_daily (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(14,2) not null default 0,
  conversion_value numeric(14,2) not null default 0,
  primary key (ad_account_id, date, campaign_id)
);
create index on public.ad_metrics_daily (workspace_id, date);

create table public.kpi_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  metric text not null check (metric in ('spend','cpa','roas','ctr','cpc','conversions')),
  target numeric(14,4) not null,
  unique (company_id, metric)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  period_start date not null,
  period_end date not null,
  commentary text not null default '',
  next_steps text not null default '',
  public_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  shared boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Numérotation et horodatage
-- ---------------------------------------------------------------------
create or replace function public.next_task_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null then
    update projects set seq = seq + 1 where id = new.project_id returning seq into new.number;
  end if;
  new.workspace_id := (select workspace_id from projects where id = new.project_id);
  return new;
end $$;
create trigger tasks_number before insert on public.tasks
  for each row execute function public.next_task_number();

create or replace function public.touch_task()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status <> 'done' then new.completed_at := now(); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_task();

create or replace function public.next_proposal_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from proposals where workspace_id = new.workspace_id;
  end if;
  return new;
end $$;
create trigger proposals_number before insert on public.proposals
  for each row execute function public.next_proposal_number();

-- Notifier l'assigné quand on lui confie une tâche
create or replace function public.notify_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into notifications (workspace_id, user_id, actor_id, kind, task_id, project_id)
    values (new.workspace_id, new.assignee_id, auth.uid(), 'assigned', new.id, new.project_id);
  end if;
  return new;
end $$;
create trigger tasks_notify_assign after insert or update of assignee_id on public.tasks
  for each row execute function public.notify_assignment();

-- Notifier l'assigné et le créateur d'un nouveau commentaire
create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = new.task_id;
  insert into notifications (workspace_id, user_id, actor_id, kind, task_id, project_id, body)
  select t.workspace_id, u, new.author_id, 'commented', t.id, t.project_id, left(new.body, 200)
  from (select distinct unnest(array[t.assignee_id, t.created_by]) as u) x
  where u is not null and u is distinct from new.author_id;
  return new;
end $$;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

-- ---------------------------------------------------------------------
-- Valeurs par défaut d'une agence
-- ---------------------------------------------------------------------
create or replace function public.seed_workspace_defaults(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into teams (workspace_id, name, icon, color, description) values
    (ws, 'Media buying', 'target', '#3B82C4', 'Meta, Google, TikTok : structure, budgets, optimisation'),
    (ws, 'Creative strategy', 'palette', '#8662C9', 'Angles, concepts, scripts et production des créas'),
    (ws, 'Account management', 'briefcase', '#C48A1E', 'Relation client, reporting et renouvellements'),
    (ws, 'Tracking & data', 'activity', '#23918A', 'Pixels, CAPI, GTM, attribution');

  insert into labels (workspace_id, name, color) values
    (ws, 'Créa', 'violet'), (ws, 'Copy', 'rose'), (ws, 'Média', 'blue'), (ws, 'Tracking', 'teal'),
    (ws, 'Landing', 'orange'), (ws, 'Reporting', 'amber'), (ws, 'Client', 'green'), (ws, 'Bug', 'red');

  insert into pipeline_stages (workspace_id, name, position, probability, kind, color) values
    (ws, 'Nouveau lead', 0, 10, 'open', '#8A867E'),
    (ws, 'Appel découverte', 1, 25, 'open', '#3B82C4'),
    (ws, 'Audit / diagnostic', 2, 40, 'open', '#8662C9'),
    (ws, 'Proposition envoyée', 3, 60, 'open', '#C48A1E'),
    (ws, 'Négociation', 4, 80, 'open', '#C0612B'),
    (ws, 'Gagné', 5, 100, 'won', '#3D8E5F'),
    (ws, 'Perdu', 6, 0, 'lost', '#B23C30');

  insert into services (workspace_id, name, description, unit_price, billing, position) values
    (ws, 'Audit publicitaire', 'Audit complet des comptes Meta et Google Ads, tracking inclus, restitué en visio', 900, 'one_off', 0),
    (ws, 'Setup tracking', 'Pixel, API de conversions, GTM et conversions offline', 1200, 'one_off', 1),
    (ws, 'Gestion Meta Ads', 'Structure, lancement, optimisation hebdomadaire et reporting mensuel', 1500, 'monthly', 2),
    (ws, 'Gestion Google Ads', 'Search, Performance Max et YouTube, optimisation et reporting', 1500, 'monthly', 3),
    (ws, 'Creative strategy', 'Recherche d''angles, 8 concepts par mois, scripts UGC et briefs', 1800, 'monthly', 4),
    (ws, 'Production de créas', 'Pack de 10 visuels et 4 vidéos courtes', 1400, 'monthly', 5);
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.teams enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.deals enable row level security;
alter table public.crm_activities enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_favorites enable row level security;
alter table public.labels enable row level security;
alter table public.tasks enable row level security;
alter table public.task_labels enable row level security;
alter table public.subtasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.saved_views enable row level security;
alter table public.activity enable row level security;
alter table public.notifications enable row level security;
alter table public.services enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;
alter table public.ad_connections enable row level security;
alter table public.ad_accounts enable row level security;
alter table public.ad_metrics_daily enable row level security;
alter table public.kpi_targets enable row level security;
alter table public.reports enable row level security;

-- profils
create policy "profil lisible" on public.profiles for select
  using (id = auth.uid() or public.shares_workspace(id));
create policy "profil modifiable" on public.profiles for update using (id = auth.uid());

-- espaces
create policy "espace lisible" on public.workspaces for select using (public.is_member(id));
create policy "espace modifiable" on public.workspaces for update using (public.is_admin(id));
create policy "espace supprimable" on public.workspaces for delete
  using (public.has_role(id, array['owner']::public.member_role[]));

-- membres
create policy "membres lisibles" on public.workspace_members for select using (public.is_member(workspace_id));
create policy "membres gérés" on public.workspace_members for update using (public.is_admin(workspace_id));
create policy "membres retirés" on public.workspace_members for delete
  using (public.is_admin(workspace_id) or user_id = auth.uid());

create policy "invitations admin" on public.invitations for all
  using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));

-- Tables métier : lecture pour tout membre, écriture pour les non-invités
do $$
declare t text;
begin
  foreach t in array array['teams','companies','contacts','pipeline_stages','deals','crm_activities',
    'projects','labels','tasks','comments','attachments','saved_views','activity','services',
    'proposals','ad_accounts','ad_metrics_daily','kpi_targets','reports']
  loop
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "ajout membres" on public.%I for insert with check (public.can_write(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
end $$;

-- Les commentaires ne sont modifiables que par leur auteur
drop policy "modif membres" on public.comments;
create policy "modif auteur" on public.comments for update using (author_id = auth.uid());

-- Tables filles : droit hérité du parent
create or replace function public.task_ws(t uuid) returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from tasks where id = t $$;
create or replace function public.project_ws(p uuid) returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from projects where id = p $$;
create or replace function public.proposal_ws(p uuid) returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from proposals where id = p $$;

create policy "lecture" on public.task_labels for select using (public.is_member(public.task_ws(task_id)));
create policy "écriture" on public.task_labels for all using (public.can_write(public.task_ws(task_id))) with check (public.can_write(public.task_ws(task_id)));
create policy "lecture" on public.subtasks for select using (public.is_member(public.task_ws(task_id)));
create policy "écriture" on public.subtasks for all using (public.can_write(public.task_ws(task_id))) with check (public.can_write(public.task_ws(task_id)));
create policy "lecture" on public.task_dependencies for select using (public.is_member(public.task_ws(task_id)));
create policy "écriture" on public.task_dependencies for all using (public.can_write(public.task_ws(task_id))) with check (public.can_write(public.task_ws(task_id)));
create policy "lecture" on public.project_members for select using (public.is_member(public.project_ws(project_id)));
create policy "écriture" on public.project_members for all using (public.can_write(public.project_ws(project_id))) with check (public.can_write(public.project_ws(project_id)));
create policy "lecture" on public.proposal_items for select using (public.is_member(public.proposal_ws(proposal_id)));
create policy "écriture" on public.proposal_items for all using (public.can_write(public.proposal_ws(proposal_id))) with check (public.can_write(public.proposal_ws(proposal_id)));

create policy "favoris perso" on public.project_favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(public.project_ws(project_id)));

create policy "notifs perso" on public.notifications for select using (user_id = auth.uid());
create policy "notifs perso maj" on public.notifications for update using (user_id = auth.uid());
create policy "notifs perso suppr" on public.notifications for delete using (user_id = auth.uid());
create policy "notifs émises" on public.notifications for insert with check (public.can_write(workspace_id));

-- ---------------------------------------------------------------------
-- Accès public (proposition et rapport partagés par lien)
-- ---------------------------------------------------------------------
create or replace function public.public_proposal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p proposals; res jsonb;
begin
  select * into p from proposals where public_token = p_token and status <> 'draft';
  if p.id is null then return null; end if;
  if p.viewed_at is null then
    update proposals set viewed_at = now(), status = case when status = 'sent' then 'viewed' else status end where id = p.id;
  end if;
  select jsonb_build_object(
    'proposal', to_jsonb(p) - 'public_token',
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from proposal_items i where i.proposal_id = p.id), '[]'::jsonb),
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent) from workspaces w where w.id = p.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = p.company_id)
  ) into res;
  return res;
end $$;

create or replace function public.respond_proposal(p_token text, p_accept boolean, p_name text, p_reason text, p_selected uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare p proposals;
begin
  select * into p from proposals where public_token = p_token and status in ('sent','viewed');
  if p.id is null then raise exception 'proposition indisponible'; end if;
  if p.valid_until is not null and p.valid_until < current_date then raise exception 'proposition expirée'; end if;
  update proposal_items set selected = (not optional) or id = any(coalesce(p_selected, '{}')) where proposal_id = p.id;
  update proposals set
    status = case when p_accept then 'accepted' else 'declined' end,
    accepted_at = case when p_accept then now() end,
    accepted_name = case when p_accept then left(p_name, 120) end,
    declined_reason = case when p_accept then null else left(p_reason, 500) end
  where id = p.id;
  insert into notifications (workspace_id, user_id, kind, proposal_id, body)
  values (p.workspace_id, p.owner_id, 'proposal',
    p.id, case when p_accept then 'Proposition acceptée : ' else 'Proposition refusée : ' end || p.title);
end $$;

create or replace function public.public_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r reports; res jsonb;
begin
  select * into r from reports where public_token = p_token and shared;
  if r.id is null then return null; end if;
  select jsonb_build_object(
    'report', to_jsonb(r) - 'public_token',
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(metric, target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks, 'conversions', m.conversions, 'value', m.conversion_value))
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb)
  ) into res;
  return res;
end $$;

grant execute on function public.public_proposal(text) to anon, authenticated;
grant execute on function public.respond_proposal(text, boolean, text, text, uuid[]) to anon, authenticated;
grant execute on function public.public_report(text) to anon, authenticated;
revoke execute on function public.seed_workspace_defaults(uuid) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Stockage des pièces jointes
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

-- Chemin : <workspace_id>/<...>
create policy "pj lecture" on storage.objects for select
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "pj ajout" on storage.objects for insert
  with check (bucket_id = 'attachments' and public.can_write(((storage.foldername(name))[1])::uuid));
create policy "pj suppression" on storage.objects for delete
  using (bucket_id = 'attachments' and public.can_write(((storage.foldername(name))[1])::uuid));

-- Temps réel sur les tâches et notifications
alter publication supabase_realtime add table public.tasks, public.notifications, public.comments;

-- =====================================================================
-- 0002_member_profile_fk.sql
-- =====================================================================
-- Permet d'embarquer le profil dans les requêtes PostgREST (workspace_members → profiles)
alter table public.workspace_members
  add constraint workspace_members_profile_fk foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.invitations
  add constraint invitations_email_ws unique (workspace_id, email);

-- =====================================================================
-- 0003_demo_data.sql
-- =====================================================================
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

-- =====================================================================
-- 0005_revoke_anon_helpers.sql
-- =====================================================================
-- Les fonctions utilitaires RLS ne doivent pas être appelables par le rôle anonyme.
revoke execute on function public.is_member(uuid) from anon, public;
revoke execute on function public.has_role(uuid, public.member_role[]) from anon, public;
revoke execute on function public.can_write(uuid) from anon, public;
revoke execute on function public.is_admin(uuid) from anon, public;
revoke execute on function public.shares_workspace(uuid) from anon, public;
revoke execute on function public.task_ws(uuid) from anon, public;
revoke execute on function public.project_ws(uuid) from anon, public;
revoke execute on function public.proposal_ws(uuid) from anon, public;
revoke execute on function public.create_workspace(text, text) from anon, public;
revoke execute on function public.accept_invitation(text) from anon, public;
grant execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]), public.can_write(uuid),
  public.is_admin(uuid), public.shares_workspace(uuid), public.task_ws(uuid), public.project_ws(uuid),
  public.proposal_ws(uuid), public.create_workspace(text, text), public.accept_invitation(text) to authenticated;

-- =====================================================================
-- 0020_workspace_notifications.sql
-- =====================================================================
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

-- =====================================================================
-- 0040_proposals.sql
-- =====================================================================
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

-- =====================================================================
-- 0050_reporting.sql
-- =====================================================================
-- =====================================================================
-- 0050 : reporting publicitaire (connecteurs Meta / Google, import CSV)
-- Migration additive : nouvelles colonnes, contrainte de plateformes
-- élargie, fonctions d'agrégation lisibles sous RLS.
-- =====================================================================

-- ---------- Plateformes des comptes suivis ----------
-- Les connexions OAuth restent Meta / Google. Les comptes peuvent aussi
-- venir d'un import CSV (TikTok, LinkedIn, Snapchat, Pinterest, ChatGPT…).
alter table public.ad_accounts drop constraint if exists ad_accounts_platform_check;
alter table public.ad_accounts add constraint ad_accounts_platform_check
  check (platform in ('meta','google','tiktok','linkedin','snapchat','pinterest','chatgpt','other'));

-- Première synchro réussie : sert à choisir la fenêtre (90 j puis 7 j)
alter table public.ad_accounts add column if not exists first_synced_at timestamptz;
update public.ad_accounts set first_synced_at = last_synced_at where first_synced_at is null and last_synced_at is not null;

-- ---------- Connexions : informations non secrètes ----------
-- accounts : cache des comptes publicitaires accessibles avec ce jeton
--   [{ external_id, name, currency, status, login_customer_id, manager }]
alter table public.ad_connections add column if not exists external_user_id text;
alter table public.ad_connections add column if not exists accounts jsonb not null default '[]'::jsonb;
alter table public.ad_connections add column if not exists accounts_refreshed_at timestamptz;
alter table public.ad_connections add column if not exists last_error text;

-- Vue sans secrets (colonnes ajoutées en fin de liste : compatible avec create or replace)
create or replace view public.ad_connections_public with (security_invoker = false) as
  select id, workspace_id, platform, label, expires_at, created_at,
         created_by, accounts, accounts_refreshed_at, last_error
  from public.ad_connections
  where public.is_member(workspace_id);

-- ---------- Agrégats (security invoker : la RLS des tables s'applique) ----------
-- Totaux par compte et par jour
create or replace function public.ad_daily(p_ws uuid, p_start date, p_end date, p_company uuid default null)
returns table (ad_account_id uuid, date date, spend numeric, impressions bigint, clicks bigint, conversions numeric, conversion_value numeric)
language sql stable security invoker set search_path = public as $$
  select m.ad_account_id, m.date, sum(m.spend), sum(m.impressions)::bigint, sum(m.clicks)::bigint,
         sum(m.conversions), sum(m.conversion_value)
  from ad_metrics_daily m
  join ad_accounts a on a.id = m.ad_account_id
  where m.workspace_id = p_ws and m.date between p_start and p_end
    and (p_company is null or a.company_id = p_company)
  group by m.ad_account_id, m.date
  order by m.date, m.ad_account_id;
$$;

-- Totaux par campagne sur une période
create or replace function public.ad_campaigns(p_ws uuid, p_start date, p_end date, p_company uuid)
returns table (ad_account_id uuid, campaign_id text, campaign_name text, spend numeric, impressions bigint, clicks bigint, conversions numeric, conversion_value numeric)
language sql stable security invoker set search_path = public as $$
  select m.ad_account_id, m.campaign_id, max(m.campaign_name), sum(m.spend), sum(m.impressions)::bigint,
         sum(m.clicks)::bigint, sum(m.conversions), sum(m.conversion_value)
  from ad_metrics_daily m
  join ad_accounts a on a.id = m.ad_account_id
  where m.workspace_id = p_ws and a.company_id = p_company and m.date between p_start and p_end
  group by m.ad_account_id, m.campaign_id
  order by 4 desc;
$$;

grant execute on function public.ad_daily(uuid, date, date, uuid) to authenticated;
grant execute on function public.ad_campaigns(uuid, date, date, uuid) to authenticated;
revoke execute on function public.ad_daily(uuid, date, date, uuid) from anon;
revoke execute on function public.ad_campaigns(uuid, date, date, uuid) from anon;

-- ---------- Rapport public : ajoute l'identifiant de campagne ----------
-- (deux campagnes homonymes sur deux comptes ne sont plus fusionnées)
create or replace function public.public_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r reports; res jsonb;
begin
  select * into r from reports where public_token = p_token and shared;
  if r.id is null then return null; end if;
  select jsonb_build_object(
    'report', to_jsonb(r) - 'public_token' - 'created_by',
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(metric, target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id,
        'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks, 'conversions', m.conversions, 'value', m.conversion_value))
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb)
  ) into res;
  return res;
end $$;
grant execute on function public.public_report(text) to anon, authenticated;

-- =====================================================================
-- 0060_tracking_links.sql
-- =====================================================================
-- =====================================================================
-- Tracking et attribution (script first-party façon Hyros)
-- + générateur de liens trackés et raccourcisseur.
-- L'ingestion (script, clics, conversions serveur) passe par des routes
-- serveur en service role : aucune policy d'écriture pour anon.
-- =====================================================================

-- Un site suivi = un domaine client (ou plusieurs) avec sa clé publique
create table public.tracking_sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  name text not null,
  domains text[] not null default '{}',
  -- clé publique du script (visible dans le HTML du site)
  public_key text not null unique default 'pk_' || encode(gen_random_bytes(12), 'hex'),
  -- clé secrète de l'API serveur (conversions offline, webhooks)
  secret_key text not null unique default 'sk_' || encode(gen_random_bytes(24), 'hex'),
  -- { window_days, model, auto_contacts, consent: 'none' | 'required', capture_forms }
  settings jsonb not null default '{"window_days": 30, "model": "last_click", "auto_contacts": true, "consent": "none", "capture_forms": true}'::jsonb,
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.tracking_sites (workspace_id);

-- Visiteur : identifiant anonyme (cookie first-party), puis identité si connue
create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  anon_id text not null,
  email text,
  name text,
  phone text,
  contact_id uuid references public.contacts(id) on delete set null,
  device text,
  country text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  identified_at timestamptz,
  unique (site_id, anon_id)
);
create index on public.visitors (site_id, email);
create index on public.visitors (workspace_id, last_seen desc);

-- Point de contact : une arrivée sur le site avec une source (UTM, clic pub, référent, lien court)
create table public.touchpoints (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  ts timestamptz not null default now(),
  landing_url text not null default '',
  referrer text not null default '',
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  click_id_type text, -- fbclid, gclid, gbraid, wbraid, ttclid, msclkid, li_fat_id, epik, sccid
  click_id text,
  -- canal calculé : paid_meta, paid_google, paid_tiktok, paid_linkedin, paid_other, organic_search,
  -- organic_social, email, referral, direct, short_link
  channel text not null default 'direct',
  platform text,
  -- identifiants de campagne / annonce (utm_id, utm_campaign si numérique, paramètres ValueTrack…)
  campaign_key text,
  adset_key text,
  ad_key text,
  link_id uuid,
  link_click_id bigint
);
create index on public.touchpoints (visitor_id, ts);
create index on public.touchpoints (site_id, ts desc);

-- Évènements : pages vues, prospects, achats, évènements personnalisés
create table public.tracking_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  visitor_id uuid references public.visitors(id) on delete cascade,
  -- pageview, lead, purchase, booking, deal_won, ou nom libre
  type text not null,
  name text,
  value numeric(14,2),
  currency text,
  order_id text,
  url text,
  -- origine : script, api (serveur), crm (deal gagné), import
  source text not null default 'script',
  props jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);
create index on public.tracking_events (site_id, type, ts desc);
create index on public.tracking_events (visitor_id, ts);
create unique index tracking_events_order_uniq on public.tracking_events (site_id, type, order_id) where order_id is not null;

-- Modèles UTM réutilisables (conventions de nommage de l'agence)
create table public.utm_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  utm_content text not null default '',
  utm_term text not null default '',
  extra_params text not null default '',
  position int not null default 0
);

-- Liens trackés (avec ou sans lien court)
create table public.links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  site_id uuid references public.tracking_sites(id) on delete set null,
  name text not null default '',
  destination text not null,
  utm jsonb not null default '{}'::jsonb,
  final_url text not null,
  -- code du lien court (/l/<code>) ; null = lien UTM seul
  code text unique check (code is null or code ~ '^[A-Za-z0-9_-]{2,64}$'),
  tags text[] not null default '{}',
  active boolean not null default true,
  expires_at timestamptz,
  clicks int not null default 0,
  last_click_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.links (workspace_id, created_at desc);

create table public.link_clicks (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.links(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ts timestamptz not null default now(),
  -- jeton passé à la destination (aos_lid) pour relier le clic au visiteur
  token text not null default encode(gen_random_bytes(9), 'hex'),
  referrer text not null default '',
  device text, browser text, os text, country text,
  is_bot boolean not null default false
);
create index on public.link_clicks (link_id, ts desc);
create index on public.link_clicks (token);

alter table public.touchpoints add constraint touchpoints_link_fk foreign key (link_id) references public.links(id) on delete set null;

-- RLS : lecture par les membres, écriture de configuration par les non-invités.
alter table public.tracking_sites enable row level security;
alter table public.visitors enable row level security;
alter table public.touchpoints enable row level security;
alter table public.tracking_events enable row level security;
alter table public.utm_presets enable row level security;
alter table public.links enable row level security;
alter table public.link_clicks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tracking_sites','visitors','touchpoints','tracking_events','link_clicks'] loop
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
  end loop;
  foreach t in array array['tracking_sites','utm_presets','links'] loop
    if t <> 'tracking_sites' then
      execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    end if;
    execute format('create policy "ajout membres" on public.%I for insert with check (public.can_write(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
  -- nettoyage manuel (RGPD : supprimer un visiteur, un évènement de test)
  foreach t in array array['visitors','tracking_events'] loop
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
  -- rattacher un visiteur à un contact CRM depuis l'interface
  execute 'create policy "modif membres" on public.visitors for update using (public.can_write(workspace_id))';
end $$;

-- Presets UTM par défaut pour les espaces existants et futurs
create or replace function public.seed_utm_presets(ws uuid)
returns void language sql security definer set search_path = public as $$
  insert into utm_presets (workspace_id, name, utm_source, utm_medium, utm_campaign, utm_content, utm_term, extra_params, position) values
    (ws, 'Meta Ads (paramètres dynamiques)', 'facebook', 'paid_social', '{{campaign.name}}', '{{ad.name}}', '{{adset.name}}', 'utm_id={{campaign.id}}&aos_ad={{ad.id}}&aos_adset={{adset.id}}', 0),
    (ws, 'Google Ads (ValueTrack)', 'google', 'cpc', '{campaignid}', '{creative}', '{keyword}', 'utm_id={campaignid}&aos_adset={adgroupid}&aos_ad={creative}', 1),
    (ws, 'TikTok Ads', 'tiktok', 'paid_social', '__CAMPAIGN_NAME__', '__CID_NAME__', '__AID_NAME__', 'utm_id=__CAMPAIGN_ID__&aos_ad=__CID__', 2),
    (ws, 'LinkedIn Ads', 'linkedin', 'paid_social', '', '', '', '', 3),
    (ws, 'Newsletter / email', 'newsletter', 'email', '', '', '', '', 4),
    (ws, 'Réseaux sociaux (organique)', 'instagram', 'social', '', '', '', '', 5),
    (ws, 'Bio / lien en profil', 'instagram', 'bio', 'profil', '', '', '', 6);
$$;
revoke execute on function public.seed_utm_presets(uuid) from anon, authenticated, public;

select public.seed_utm_presets(id) from public.workspaces;

create or replace function public.seed_workspace_defaults_tracking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform seed_utm_presets(new.id);
  return new;
end $$;
create trigger workspaces_seed_utm after insert on public.workspaces
  for each row execute function public.seed_workspace_defaults_tracking();

-- Incrément atomique du compteur de clics (appelé par la route de redirection)
create or replace function public.bump_link(p_link uuid)
returns void language sql security definer set search_path = public as $$
  update links set clicks = clicks + 1, last_click_at = now() where id = p_link;
$$;
revoke execute on function public.bump_link(uuid) from anon, authenticated, public;

-- =====================================================================
-- 0061_tracking_attribution.sql
-- =====================================================================
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

-- =====================================================================
-- 0062_links.sql
-- =====================================================================
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

-- =====================================================================
-- 0063_tracking_secret.sql
-- =====================================================================
-- La clé secrète d'un site suivi ne doit pas être lisible par un invité :
-- privilège par colonne (tout sauf secret_key), et lecture via une fonction réservée aux non-invités.
revoke select on public.tracking_sites from anon, authenticated;
grant select (id, workspace_id, company_id, name, domains, public_key, settings, last_event_at, created_at)
  on public.tracking_sites to authenticated;

create or replace function public.tracking_site_secret(p_site uuid)
returns text language sql stable security definer set search_path = public as $$
  select secret_key from tracking_sites where id = p_site and public.can_write(workspace_id);
$$;
revoke execute on function public.tracking_site_secret(uuid) from anon, public;
grant execute on function public.tracking_site_secret(uuid) to authenticated;

-- =====================================================================
-- 0064_demo_tracking_chunks.sql
-- =====================================================================
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

-- =====================================================================
-- 0070_proposal_signature.sql
-- =====================================================================
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

-- =====================================================================
-- 0071_onboarding.sql
-- =====================================================================
-- =====================================================================
-- Onboarding client par formulaire
-- 1. Réglages d'onboarding par espace (identifiants de l'agence affichés
--    au client : Business Manager Meta, compte administrateur Google Ads,
--    email à inviter ; automatisations par défaut)
-- 2. Modèles de formulaire (sections et questions en jsonb), trois modèles
--    fournis par défaut pour les espaces existants et futurs
-- 3. Formulaires envoyés : copie figée du modèle, réponses, progression,
--    lien public /f/<token>, vérification des accès par l'agence
-- 4. Fichiers déposés par le client (bucket privé « attachments »,
--    chemin <workspace_id>/onboarding/<form_id>/...)
-- 5. Nouveau type de notification « onboarding » (ajouté à la liste
--    existante, quelle qu'elle soit)
-- 6. Données de démo : load_demo_onboarding / clear_demo_onboarding
--    (admins) et _demo_onboarding / _clear_demo_onboarding (service role)
-- La page publique passe exclusivement par les routes /api/onboarding/*
-- en service role : aucune policy ne vise le rôle anon.
-- Migration additive : aucune table existante modifiée (hors contrainte
-- de type des notifications, élargie).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Réglages
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  meta_business_id text not null default '',
  google_mcc_id text not null default '',
  access_email text not null default '',
  intro text not null default '',
  auto_project boolean not null default true,
  auto_kpis boolean not null default true,
  auto_company boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Modèles
-- sections : [{ id, title, description, questions: [{ id, type, label, help,
--   required, placeholder, options, unit, map, accept, items }] }]
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text,
  name text not null,
  description text not null default '',
  icon text not null default 'list-checks',
  sections jsonb not null default '[]'::jsonb,
  position int not null default 0,
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_templates_ws on public.onboarding_templates (workspace_id);
create unique index if not exists onboarding_templates_key on public.onboarding_templates (workspace_id, key) where key is not null;

-- ---------------------------------------------------------------------
-- 3. Formulaires envoyés
-- answers  : { <question_id>: texte | [choix] | { <item_id>: { done, value } } }
-- verified : { "<question_id>:<item_id>": { at, by } } (accès vérifiés par l'agence)
-- options  : { project, kpis, company } automatisations à la fin
-- automation : compte rendu des automatisations exécutées
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid references public.onboarding_templates(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  intro text not null default '',
  sections jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  verified jsonb not null default '{}'::jsonb,
  status text not null default 'sent' check (status in ('sent','in_progress','completed')),
  progress int not null default 0 check (progress between 0 and 100),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  options jsonb not null default '{"project": true, "kpis": true, "company": true}'::jsonb,
  automation jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  email_sent_at timestamptz,
  opened_at timestamptz,
  last_activity_at timestamptz,
  completed_at timestamptz,
  reminded_at timestamptz,
  remind_count int not null default 0,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_forms_ws on public.onboarding_forms (workspace_id, created_at desc);
create index if not exists onboarding_forms_company on public.onboarding_forms (company_id);

-- ---------------------------------------------------------------------
-- 4. Fichiers
-- ---------------------------------------------------------------------
create table if not exists public.onboarding_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.onboarding_forms(id) on delete cascade,
  question_id text not null,
  name text not null,
  path text not null unique,
  size bigint not null default 0,
  mime text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists onboarding_files_form on public.onboarding_files (form_id);

-- updated_at
create or replace function public.touch_onboarding()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists onboarding_templates_touch on public.onboarding_templates;
create trigger onboarding_templates_touch before update on public.onboarding_templates
  for each row execute function public.touch_onboarding();
drop trigger if exists onboarding_forms_touch on public.onboarding_forms;
create trigger onboarding_forms_touch before update on public.onboarding_forms
  for each row execute function public.touch_onboarding();
drop trigger if exists onboarding_settings_touch on public.onboarding_settings;
create trigger onboarding_settings_touch before update on public.onboarding_settings
  for each row execute function public.touch_onboarding();

-- RLS : lecture pour tout membre, écriture pour les non-invités
alter table public.onboarding_settings enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.onboarding_forms enable row level security;
alter table public.onboarding_files enable row level security;

do $$
declare t text;
begin
  foreach t in array array['onboarding_settings','onboarding_templates','onboarding_forms','onboarding_files'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "ajout membres" on public.%I', t);
    execute format('drop policy if exists "modif membres" on public.%I', t);
    execute format('drop policy if exists "suppression membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "ajout membres" on public.%I for insert with check (public.can_write(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Type de notification « onboarding » : on relit la contrainte
--    actuelle et on y ajoute la valeur, pour ne pas écraser les types
--    ajoutés par d'autres migrations.
-- ---------------------------------------------------------------------
do $$
declare def text; kinds text[];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if def is not null and def !~ '\monboarding\M' then
    select array_agg(m[1]) into kinds from regexp_matches(def, '''([a-z_]+)''', 'g') as m;
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || (select string_agg(quote_literal(k), ', ') from unnest(kinds || 'onboarding'::text) k) || ']))';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2 bis. Modèles par défaut
-- ---------------------------------------------------------------------
create or replace function public.onboarding_default_templates()
returns table (key text, name text, description text, icon text, sections jsonb, "position" int)
language sql immutable set search_path = public as $$
  values
    ('ecommerce', 'Onboarding e-commerce',
      'Boutique en ligne : produits, panier moyen, ROAS cible, catalogue et accès Meta, Google, Shopify.',
      'shopping-bag', $j$[{"id":"company","title":"Votre entreprise et votre offre","description":"Quelques informations pour bien comprendre votre marque et ce que vous vendez.","questions":[{"id":"brand_name","type":"short","label":"Nom commercial de la marque","required":true},{"id":"website","type":"url","label":"Adresse de votre boutique en ligne","required":true,"placeholder":"https://","map":"company.website"},{"id":"industry","type":"single","label":"Secteur d'activité","required":true,"options":["E-commerce","SaaS","Formation","Immobilier","Santé","Restauration","Services B2B","Local","Autre"],"map":"company.industry"},{"id":"pitch","type":"long","label":"Présentez votre activité en quelques phrases","required":true,"placeholder":"Ce que vous vendez, à qui, depuis quand..."},{"id":"hero_products","type":"long","label":"Vos produits phares et leur prix","required":true,"placeholder":"Un produit par ligne"},{"id":"aov","type":"number","label":"Panier moyen","unit":"€"},{"id":"margin","type":"number","label":"Marge brute moyenne","unit":"%"},{"id":"usp","type":"long","label":"Qu'est-ce qui vous différencie de vos concurrents ?"},{"id":"promos","type":"long","label":"Offres, lancements ou promotions prévus dans les 3 prochains mois"}]},{"id":"personas","title":"Vos clients et personas","description":"Plus nous connaissons vos clients, plus vos publicités leur parleront.","questions":[{"id":"ideal_customer","type":"long","label":"Qui est votre client idéal ?","required":true,"placeholder":"Âge, situation, centres d'intérêt, ce qui le décide à acheter..."},{"id":"markets","type":"multi","label":"Pays où vous livrez","required":true,"options":["France","Belgique","Suisse","Canada","Reste de l'Europe","International"]},{"id":"pains","type":"long","label":"Quels problèmes ou envies votre produit résout-il ?"},{"id":"objections","type":"long","label":"Les freins les plus fréquents avant l'achat","placeholder":"Prix, délais de livraison, doute sur la qualité..."},{"id":"repeat","type":"number","label":"Part de clients qui rachètent","unit":"%"}]},{"id":"competitors","title":"Concurrents","description":"Nous analyserons leurs publicités actives dans les bibliothèques publicitaires.","questions":[{"id":"competitors","type":"long","label":"Vos 3 principaux concurrents","required":true,"placeholder":"Nom ou site, un par ligne"},{"id":"admired","type":"short","label":"Une marque dont vous admirez la publicité"}]},{"id":"goals","title":"Objectifs et KPI","description":"Ces chiffres servent de référence à nos rapports mensuels.","questions":[{"id":"main_goal","type":"single","label":"Votre objectif principal","required":true,"options":["Augmenter les ventes en ligne","Rentabiliser les campagnes existantes","Lancer un nouveau produit","Conquérir un nouveau pays","Développer la notoriété"]},{"id":"roas_target","type":"number","label":"ROAS cible","unit":"x","map":"kpi.roas","help":"Chiffre d'affaires généré pour 1 € de publicité. 3 signifie 3 € de ventes pour 1 € dépensé."},{"id":"cpa_target","type":"number","label":"Coût par achat maximum acceptable","unit":"€","map":"kpi.cpa"},{"id":"revenue","type":"number","label":"Chiffre d'affaires mensuel en ligne actuel","unit":"€"},{"id":"start_date","type":"date","label":"Date de lancement souhaitée"}]},{"id":"budget","title":"Budget","description":"Le budget publicitaire est payé directement aux plateformes, en dehors de nos honoraires.","questions":[{"id":"budget","type":"single","label":"Budget publicitaire mensuel prévu","required":true,"options":["Moins de 1 000 €","1 000 à 3 000 €","3 000 à 10 000 €","10 000 à 30 000 €","Plus de 30 000 €"]},{"id":"platforms","type":"multi","label":"Plateformes envisagées","options":["Meta (Facebook, Instagram)","Google Ads","TikTok","Pinterest","Je ne sais pas encore"]},{"id":"seasonality","type":"long","label":"Saisonnalité et temps forts de l'année","placeholder":"Black Friday, Noël, soldes, fête des mères..."}]},{"id":"history","title":"Historique publicitaire","description":"Pour repartir de ce qui a déjà été appris, plutôt que de zéro.","questions":[{"id":"ads_before","type":"single","label":"Avez-vous déjà fait de la publicité en ligne ?","required":true,"options":["Oui, en interne","Oui, avec une agence ou un freelance","Non, jamais"]},{"id":"learnings","type":"long","label":"Ce qui a fonctionné, ou pas, jusqu'ici"},{"id":"past_spend","type":"number","label":"Dépense publicitaire mensuelle moyenne ces 3 derniers mois","unit":"€"}]},{"id":"brand","title":"Marque et créations","description":"Tout ce qui nous aide à produire des publicités fidèles à votre marque.","questions":[{"id":"logo","type":"file","label":"Votre logo","required":true,"accept":"images","help":"Idéalement en SVG ou en PNG haute définition sur fond transparent."},{"id":"charter","type":"file","label":"Charte graphique (couleurs, typographies)","accept":"docs"},{"id":"creatives","type":"file","label":"Créations publicitaires existantes","accept":"any","help":"Visuels, vidéos, publicités qui ont bien fonctionné. Jusqu'à 50 Mo par fichier."},{"id":"assets_link","type":"url","label":"Lien vers un dossier partagé (photos, vidéos)","placeholder":"https://drive.google.com/..."},{"id":"tone","type":"multi","label":"Le ton de votre marque","options":["Premium","Chaleureux","Expert","Décalé","Engagé","Minimaliste","Pédagogue"]},{"id":"never","type":"long","label":"Ce qu'il ne faut jamais dire ou montrer","placeholder":"Mots, images, sujets, concurrents à ne pas citer..."}]},{"id":"legal","title":"Contraintes légales","description":"Pour ne jamais diffuser une publicité refusée ou non conforme.","questions":[{"id":"legal_regulated","type":"single","label":"Votre secteur est-il soumis à une réglementation publicitaire particulière ?","required":true,"options":["Non","Oui (santé, alcool, finance, compléments alimentaires...)","Je ne sais pas"]},{"id":"legal_mentions","type":"long","label":"Mentions obligatoires ou allégations interdites","placeholder":"Ex. : « Sous réserve d'acceptation du dossier », pas de promesse de résultat..."},{"id":"legal_validator","type":"short","label":"Qui valide les publicités avant leur diffusion ?","placeholder":"Prénom, nom et email"}]},{"id":"access","title":"Accès aux outils","description":"Nous travaillons dans vos comptes, qui restent votre propriété : vous pouvez retirer nos accès à tout moment.","questions":[{"id":"access","type":"access","label":"Donnez-nous accès à vos comptes","required":true,"help":"Suivez les étapes de chaque outil, puis cochez « C'est fait ». Vous n'avez aucun mot de passe à nous transmettre.","items":[{"id":"meta_bm","name":"Business Manager Meta","platform":"meta_bm","link":"https://business.facebook.com/settings","idLabel":"ID de votre Business Manager","steps":["Ouvrez business.facebook.com/settings avec le compte administrateur de votre entreprise.","Copiez l'identifiant affiché sous le nom de votre entreprise (Informations sur l'entreprise) et collez-le ci-dessous.","Allez dans Utilisateurs > Partenaires, cliquez sur Ajouter puis « Donner à un partenaire l'accès à vos ressources ».","Saisissez l'ID de partenaire de {agence} : {meta_bm_id}, puis validez."]},{"id":"meta_ads","name":"Compte publicitaire, page et pixel Meta","platform":"meta_ads","link":"https://business.facebook.com/settings/ad-accounts","idLabel":"ID du compte publicitaire (act_...)","steps":["Dans les paramètres du Business Manager, ouvrez Comptes > Comptes publicitaires.","Sélectionnez votre compte publicitaire et copiez son identifiant.","Cliquez sur Attribuer des partenaires, saisissez l'ID {meta_bm_id} et cochez « Gérer les campagnes ».","Faites de même pour votre page Facebook, votre compte Instagram et votre pixel (Sources de données > Ensembles de données)."]},{"id":"google_ads","name":"Google Ads","platform":"google_ads","link":"https://ads.google.com","idLabel":"Numéro client Google Ads (123-456-7890)","steps":["Connectez-vous à ads.google.com : votre numéro client s'affiche en haut à droite (format 123-456-7890).","Collez-le ci-dessous : {agence} vous enverra une demande d'association depuis son compte administrateur {google_mcc_id}.","Dans Google Ads, ouvrez Administration > Accès et sécurité > Gestionnaires, puis acceptez la demande de {agence}."]},{"id":"ga4","name":"Google Analytics 4","platform":"ga4","link":"https://analytics.google.com","idLabel":"ID de la propriété GA4 (facultatif)","steps":["Ouvrez analytics.google.com, puis Administration (roue crantée en bas à gauche).","Dans la colonne Propriété, cliquez sur Gestion des accès à la propriété.","Cliquez sur +, puis Ajouter des utilisateurs, et saisissez {email_acces}.","Choisissez le rôle Éditeur et cliquez sur Ajouter."]},{"id":"gtm","name":"Google Tag Manager","platform":"gtm","link":"https://tagmanager.google.com","idLabel":"ID du conteneur (GTM-XXXXXXX)","steps":["Ouvrez tagmanager.google.com et sélectionnez le conteneur de votre site.","Cliquez sur Administration, puis Gestion des utilisateurs dans la colonne Conteneur.","Ajoutez {email_acces} avec l'autorisation Publier, puis envoyez l'invitation.","Pas encore de conteneur ? Cochez simplement la case : nous le créerons avec vous."]},{"id":"shopify","name":"Shopify (ou votre CMS)","platform":"cms","link":"https://admin.shopify.com","idLabel":"Adresse de votre boutique (xxx.myshopify.com)","steps":["Dans l'administration Shopify, ouvrez Paramètres > Utilisateurs et autorisations.","Cliquez sur Ajouter du personnel et saisissez {email_acces}.","Cochez Commandes, Produits, Canaux de vente et Événements clients (pixels), puis envoyez l'invitation.","Sur WooCommerce, PrestaShop ou un autre CMS : créez un compte Gestionnaire pour {email_acces}."]},{"id":"search_console","name":"Google Search Console","platform":"search_console","link":"https://search.google.com/search-console","steps":["Ouvrez search.google.com/search-console et sélectionnez votre site.","Allez dans Paramètres > Utilisateurs et autorisations.","Cliquez sur Ajouter un utilisateur, saisissez {email_acces} avec l'autorisation Complète."]}]},{"id":"access_notes","type":"long","label":"Un accès pose problème ? Dites-le nous ici","placeholder":"Ex. : le Business Manager appartient à notre ancien prestataire..."}]}]$j$::jsonb, 0),
    ('leads', 'Onboarding génération de leads',
      'Services et B2B : définition du lead qualifié, coût par lead cible, suivi commercial, accès Meta, Google et CRM.',
      'target', $j$[{"id":"company","title":"Votre entreprise et votre offre","description":"Quelques informations pour bien comprendre votre activité.","questions":[{"id":"brand_name","type":"short","label":"Nom de l'entreprise","required":true},{"id":"website","type":"url","label":"Site web","required":true,"placeholder":"https://","map":"company.website"},{"id":"industry","type":"single","label":"Secteur d'activité","required":true,"options":["E-commerce","SaaS","Formation","Immobilier","Santé","Restauration","Services B2B","Local","Autre"],"map":"company.industry"},{"id":"pitch","type":"long","label":"Présentez votre activité en quelques phrases","required":true},{"id":"offer","type":"long","label":"L'offre à promouvoir en priorité et son prix","required":true,"placeholder":"Prestation, formation, abonnement..."},{"id":"customer_value","type":"number","label":"Valeur moyenne d'un client signé","unit":"€","help":"Sur la première vente ou sur toute la durée de la relation, précisez-le dans les notes si besoin."},{"id":"usp","type":"long","label":"Pourquoi vos clients vous choisissent plutôt qu'un concurrent ?"}]},{"id":"personas","title":"Vos cibles et personas","description":"À qui s'adressent les campagnes.","questions":[{"id":"ideal_customer","type":"long","label":"Décrivez votre client idéal","required":true,"placeholder":"Particulier ou entreprise, fonction, taille, situation..."},{"id":"area","type":"short","label":"Zone géographique ciblée","required":true,"placeholder":"France entière, Île-de-France, Lyon + 50 km..."},{"id":"pains","type":"long","label":"Quels problèmes votre offre résout-elle ?"},{"id":"objections","type":"long","label":"Les objections les plus fréquentes en rendez-vous"}]},{"id":"funnel","title":"Qualification et suivi des leads","description":"Un lead n'a de valeur que s'il est rappelé vite et bien.","questions":[{"id":"qualified","type":"long","label":"Qu'est-ce qu'un lead qualifié pour vous ?","required":true,"placeholder":"Budget, besoin, délai, zone, statut..."},{"id":"followup","type":"single","label":"Délai de rappel d'un nouveau lead","required":true,"options":["Moins d'une heure","Dans la journée","Sous 48 h","Plus de 48 h"]},{"id":"followup_who","type":"short","label":"Qui rappelle les leads ?","placeholder":"Prénom, rôle"},{"id":"close_rate","type":"number","label":"Taux de transformation lead vers client","unit":"%"},{"id":"lead_form","type":"single","label":"Où arrivent les demandes aujourd'hui ?","options":["Formulaire du site","Appels téléphoniques","Prise de rendez-vous en ligne","Messages (WhatsApp, Messenger)","Plusieurs canaux"]}]},{"id":"competitors","title":"Concurrents","description":"Nous analyserons leurs publicités et leurs pages.","questions":[{"id":"competitors","type":"long","label":"Vos 3 principaux concurrents","required":true,"placeholder":"Nom ou site, un par ligne"}]},{"id":"goals","title":"Objectifs et KPI","description":"Ces chiffres servent de référence à nos rapports mensuels.","questions":[{"id":"leads_goal","type":"number","label":"Nombre de leads souhaités par mois","required":true},{"id":"cpa_target","type":"number","label":"Coût par lead cible","unit":"€","map":"kpi.cpa"},{"id":"start_date","type":"date","label":"Date de lancement souhaitée"}]},{"id":"budget","title":"Budget et historique","description":"Le budget publicitaire est payé directement aux plateformes, en dehors de nos honoraires.","questions":[{"id":"budget","type":"single","label":"Budget publicitaire mensuel prévu","required":true,"options":["Moins de 1 000 €","1 000 à 3 000 €","3 000 à 10 000 €","Plus de 10 000 €"]},{"id":"platforms","type":"multi","label":"Plateformes envisagées","options":["Meta (Facebook, Instagram)","Google Ads","LinkedIn Ads","TikTok","Je ne sais pas encore"]},{"id":"ads_before","type":"single","label":"Avez-vous déjà fait de la publicité en ligne ?","required":true,"options":["Oui, en interne","Oui, avec une agence ou un freelance","Non, jamais"]},{"id":"learnings","type":"long","label":"Ce qui a fonctionné, ou pas, jusqu'ici"}]},{"id":"brand","title":"Marque et créations","description":"Tout ce qui nous aide à produire des publicités fidèles à votre marque.","questions":[{"id":"logo","type":"file","label":"Votre logo","required":true,"accept":"images","help":"Idéalement en SVG ou en PNG haute définition sur fond transparent."},{"id":"charter","type":"file","label":"Charte graphique (couleurs, typographies)","accept":"docs"},{"id":"creatives","type":"file","label":"Publicités, brochures ou présentations existantes","accept":"any","help":"Visuels, vidéos, publicités qui ont bien fonctionné. Jusqu'à 50 Mo par fichier."},{"id":"assets_link","type":"url","label":"Lien vers un dossier partagé (photos, vidéos)","placeholder":"https://drive.google.com/..."},{"id":"tone","type":"multi","label":"Le ton de votre marque","options":["Premium","Chaleureux","Expert","Décalé","Engagé","Minimaliste","Pédagogue"]},{"id":"never","type":"long","label":"Ce qu'il ne faut jamais dire ou montrer","placeholder":"Mots, images, sujets, concurrents à ne pas citer..."}]},{"id":"legal","title":"Contraintes légales","description":"Pour ne jamais diffuser une publicité refusée ou non conforme.","questions":[{"id":"legal_regulated","type":"single","label":"Votre secteur est-il soumis à une réglementation publicitaire particulière ?","required":true,"options":["Non","Oui (santé, alcool, finance, compléments alimentaires...)","Je ne sais pas"]},{"id":"legal_mentions","type":"long","label":"Mentions obligatoires ou allégations interdites","placeholder":"Ex. : « Sous réserve d'acceptation du dossier », pas de promesse de résultat..."},{"id":"legal_validator","type":"short","label":"Qui valide les publicités avant leur diffusion ?","placeholder":"Prénom, nom et email"}]},{"id":"access","title":"Accès aux outils","description":"Nous travaillons dans vos comptes, qui restent votre propriété : vous pouvez retirer nos accès à tout moment.","questions":[{"id":"access","type":"access","label":"Donnez-nous accès à vos comptes","required":true,"help":"Suivez les étapes de chaque outil, puis cochez « C'est fait ». Vous n'avez aucun mot de passe à nous transmettre.","items":[{"id":"meta_bm","name":"Business Manager Meta","platform":"meta_bm","link":"https://business.facebook.com/settings","idLabel":"ID de votre Business Manager","steps":["Ouvrez business.facebook.com/settings avec le compte administrateur de votre entreprise.","Copiez l'identifiant affiché sous le nom de votre entreprise (Informations sur l'entreprise) et collez-le ci-dessous.","Allez dans Utilisateurs > Partenaires, cliquez sur Ajouter puis « Donner à un partenaire l'accès à vos ressources ».","Saisissez l'ID de partenaire de {agence} : {meta_bm_id}, puis validez."]},{"id":"meta_ads","name":"Compte publicitaire, page et pixel Meta","platform":"meta_ads","link":"https://business.facebook.com/settings/ad-accounts","idLabel":"ID du compte publicitaire (act_...)","steps":["Dans les paramètres du Business Manager, ouvrez Comptes > Comptes publicitaires.","Sélectionnez votre compte publicitaire et copiez son identifiant.","Cliquez sur Attribuer des partenaires, saisissez l'ID {meta_bm_id} et cochez « Gérer les campagnes ».","Faites de même pour votre page Facebook, votre compte Instagram et votre pixel (Sources de données > Ensembles de données)."]},{"id":"google_ads","name":"Google Ads","platform":"google_ads","link":"https://ads.google.com","idLabel":"Numéro client Google Ads (123-456-7890)","steps":["Connectez-vous à ads.google.com : votre numéro client s'affiche en haut à droite (format 123-456-7890).","Collez-le ci-dessous : {agence} vous enverra une demande d'association depuis son compte administrateur {google_mcc_id}.","Dans Google Ads, ouvrez Administration > Accès et sécurité > Gestionnaires, puis acceptez la demande de {agence}."]},{"id":"ga4","name":"Google Analytics 4","platform":"ga4","link":"https://analytics.google.com","idLabel":"ID de la propriété GA4 (facultatif)","steps":["Ouvrez analytics.google.com, puis Administration (roue crantée en bas à gauche).","Dans la colonne Propriété, cliquez sur Gestion des accès à la propriété.","Cliquez sur +, puis Ajouter des utilisateurs, et saisissez {email_acces}.","Choisissez le rôle Éditeur et cliquez sur Ajouter."]},{"id":"gtm","name":"Google Tag Manager","platform":"gtm","link":"https://tagmanager.google.com","idLabel":"ID du conteneur (GTM-XXXXXXX)","steps":["Ouvrez tagmanager.google.com et sélectionnez le conteneur de votre site.","Cliquez sur Administration, puis Gestion des utilisateurs dans la colonne Conteneur.","Ajoutez {email_acces} avec l'autorisation Publier, puis envoyez l'invitation.","Pas encore de conteneur ? Cochez simplement la case : nous le créerons avec vous."]},{"id":"cms","name":"Site web (WordPress, Webflow...)","platform":"cms","idLabel":"Outil utilisé pour votre site","steps":["Connectez-vous à l'administration de votre site.","Créez un compte utilisateur pour {email_acces} avec le rôle Éditeur (ou Administrateur si nous devons installer le suivi).","Si votre site est géré par un prestataire, transmettez-lui simplement cette demande et cochez la case une fois l'accès créé."]},{"id":"crm","name":"Votre CRM (HubSpot, Pipedrive, Axonaut...)","platform":"other","idLabel":"Nom de votre CRM","steps":["Invitez {email_acces} comme utilisateur de votre CRM, en lecture seule si possible.","Nous en avons besoin pour relier les leads aux campagnes et mesurer le coût par client signé.","Pas de CRM ? Cochez la case et précisez où arrivent vos demandes (email, tableur...)."]}]},{"id":"access_notes","type":"long","label":"Un accès pose problème ? Dites-le nous ici","placeholder":"Ex. : le Business Manager appartient à notre ancien prestataire..."}]}]$j$::jsonb, 1),
    ('local', 'Onboarding local / prise de RDV',
      'Commerces et prestataires locaux : zone de chalandise, prestations, prise de rendez-vous, fiche Google.',
      'calendar', $j$[{"id":"company","title":"Votre établissement","description":"Pour cibler les bonnes personnes, au bon endroit.","questions":[{"id":"brand_name","type":"short","label":"Nom de l'établissement","required":true},{"id":"website","type":"url","label":"Site web","placeholder":"https://","map":"company.website"},{"id":"industry","type":"single","label":"Secteur d'activité","required":true,"options":["E-commerce","SaaS","Formation","Immobilier","Santé","Restauration","Services B2B","Local","Autre"],"map":"company.industry"},{"id":"address","type":"long","label":"Adresse(s) de l'établissement","required":true,"placeholder":"Une adresse par ligne"},{"id":"radius","type":"number","label":"Rayon de votre zone de chalandise","required":true,"unit":"km"},{"id":"hours","type":"long","label":"Horaires d'ouverture"},{"id":"phone","type":"phone","label":"Téléphone affiché dans les publicités"}]},{"id":"offer","title":"Vos prestations","description":"Ce que vous voulez remplir en priorité.","questions":[{"id":"services","type":"long","label":"Prestations proposées et leurs prix","required":true,"placeholder":"Une prestation par ligne"},{"id":"priority_service","type":"short","label":"La prestation à mettre en avant en priorité","required":true},{"id":"customer_value","type":"number","label":"Valeur moyenne d'un client","unit":"€"},{"id":"usp","type":"long","label":"Pourquoi vos clients vous choisissent ?"}]},{"id":"personas","title":"Votre clientèle","description":"Qui sont les clients que vous aimeriez voir plus souvent ?","questions":[{"id":"ideal_customer","type":"long","label":"Décrivez votre client idéal","required":true},{"id":"competitors","type":"long","label":"Vos principaux concurrents dans le secteur","placeholder":"Nom ou site, un par ligne"}]},{"id":"booking","title":"Prise de rendez-vous","description":"Pour mesurer chaque rendez-vous obtenu grâce aux publicités.","questions":[{"id":"booking_tool","type":"single","label":"Comment vos clients prennent-ils rendez-vous ?","required":true,"options":["Calendly","Planity","Doctolib","Formulaire du site","Téléphone uniquement","Autre outil"]},{"id":"booking_link","type":"url","label":"Lien de prise de rendez-vous","placeholder":"https://"},{"id":"capacity","type":"number","label":"Nombre de rendez-vous supplémentaires que vous pouvez absorber par semaine"}]},{"id":"goals","title":"Objectifs et budget","description":"Le budget publicitaire est payé directement aux plateformes, en dehors de nos honoraires.","questions":[{"id":"appointments_goal","type":"number","label":"Nombre de rendez-vous souhaités par mois","required":true},{"id":"cpa_target","type":"number","label":"Coût par rendez-vous cible","unit":"€","map":"kpi.cpa"},{"id":"budget","type":"single","label":"Budget publicitaire mensuel prévu","required":true,"options":["Moins de 500 €","500 à 1 000 €","1 000 à 3 000 €","Plus de 3 000 €"]},{"id":"ads_before","type":"single","label":"Avez-vous déjà fait de la publicité en ligne ?","required":true,"options":["Oui","Non, jamais"]},{"id":"start_date","type":"date","label":"Date de lancement souhaitée"}]},{"id":"brand","title":"Marque et créations","description":"Tout ce qui nous aide à produire des publicités fidèles à votre marque.","questions":[{"id":"logo","type":"file","label":"Votre logo","required":true,"accept":"images","help":"Idéalement en SVG ou en PNG haute définition sur fond transparent."},{"id":"charter","type":"file","label":"Charte graphique (couleurs, typographies)","accept":"docs"},{"id":"creatives","type":"file","label":"Photos de l'établissement, de l'équipe ou de vos réalisations","accept":"any","help":"Visuels, vidéos, publicités qui ont bien fonctionné. Jusqu'à 50 Mo par fichier."},{"id":"assets_link","type":"url","label":"Lien vers un dossier partagé (photos, vidéos)","placeholder":"https://drive.google.com/..."},{"id":"tone","type":"multi","label":"Le ton de votre marque","options":["Premium","Chaleureux","Expert","Décalé","Engagé","Minimaliste","Pédagogue"]},{"id":"never","type":"long","label":"Ce qu'il ne faut jamais dire ou montrer","placeholder":"Mots, images, sujets, concurrents à ne pas citer..."}]},{"id":"legal","title":"Contraintes légales","description":"Pour ne jamais diffuser une publicité refusée ou non conforme.","questions":[{"id":"legal_regulated","type":"single","label":"Votre secteur est-il soumis à une réglementation publicitaire particulière ?","required":true,"options":["Non","Oui (santé, alcool, finance, compléments alimentaires...)","Je ne sais pas"]},{"id":"legal_mentions","type":"long","label":"Mentions obligatoires ou allégations interdites","placeholder":"Ex. : « Sous réserve d'acceptation du dossier », pas de promesse de résultat..."},{"id":"legal_validator","type":"short","label":"Qui valide les publicités avant leur diffusion ?","placeholder":"Prénom, nom et email"}]},{"id":"access","title":"Accès aux outils","description":"Vos comptes restent votre propriété : vous pouvez retirer nos accès à tout moment.","questions":[{"id":"access","type":"access","label":"Donnez-nous accès à vos comptes","required":true,"help":"Suivez les étapes de chaque outil, puis cochez « C'est fait ». Vous n'avez aucun mot de passe à nous transmettre.","items":[{"id":"gbp","name":"Fiche d'établissement Google","platform":"gbp","link":"https://business.google.com","idLabel":"Nom exact de la fiche","steps":["Recherchez le nom de votre établissement sur Google en étant connecté au compte propriétaire de la fiche.","Cliquez sur les trois points du panneau de gestion, puis Paramètres de la fiche > Personnes et accès.","Cliquez sur Ajouter, saisissez {email_acces} et choisissez le rôle Gestionnaire."]},{"id":"meta_bm","name":"Business Manager Meta","platform":"meta_bm","link":"https://business.facebook.com/settings","idLabel":"ID de votre Business Manager","steps":["Ouvrez business.facebook.com/settings avec le compte administrateur de votre entreprise.","Copiez l'identifiant affiché sous le nom de votre entreprise (Informations sur l'entreprise) et collez-le ci-dessous.","Allez dans Utilisateurs > Partenaires, cliquez sur Ajouter puis « Donner à un partenaire l'accès à vos ressources ».","Saisissez l'ID de partenaire de {agence} : {meta_bm_id}, puis validez."]},{"id":"meta_ads","name":"Compte publicitaire, page et pixel Meta","platform":"meta_ads","link":"https://business.facebook.com/settings/ad-accounts","idLabel":"ID du compte publicitaire (act_...)","steps":["Dans les paramètres du Business Manager, ouvrez Comptes > Comptes publicitaires.","Sélectionnez votre compte publicitaire et copiez son identifiant.","Cliquez sur Attribuer des partenaires, saisissez l'ID {meta_bm_id} et cochez « Gérer les campagnes ».","Faites de même pour votre page Facebook, votre compte Instagram et votre pixel (Sources de données > Ensembles de données)."]},{"id":"google_ads","name":"Google Ads","platform":"google_ads","link":"https://ads.google.com","idLabel":"Numéro client Google Ads (123-456-7890)","steps":["Connectez-vous à ads.google.com : votre numéro client s'affiche en haut à droite (format 123-456-7890).","Collez-le ci-dessous : {agence} vous enverra une demande d'association depuis son compte administrateur {google_mcc_id}.","Dans Google Ads, ouvrez Administration > Accès et sécurité > Gestionnaires, puis acceptez la demande de {agence}."]},{"id":"ga4","name":"Google Analytics 4","platform":"ga4","link":"https://analytics.google.com","idLabel":"ID de la propriété GA4 (facultatif)","steps":["Ouvrez analytics.google.com, puis Administration (roue crantée en bas à gauche).","Dans la colonne Propriété, cliquez sur Gestion des accès à la propriété.","Cliquez sur +, puis Ajouter des utilisateurs, et saisissez {email_acces}.","Choisissez le rôle Éditeur et cliquez sur Ajouter."]},{"id":"gtm","name":"Google Tag Manager","platform":"gtm","link":"https://tagmanager.google.com","idLabel":"ID du conteneur (GTM-XXXXXXX)","steps":["Ouvrez tagmanager.google.com et sélectionnez le conteneur de votre site.","Cliquez sur Administration, puis Gestion des utilisateurs dans la colonne Conteneur.","Ajoutez {email_acces} avec l'autorisation Publier, puis envoyez l'invitation.","Pas encore de conteneur ? Cochez simplement la case : nous le créerons avec vous."]},{"id":"cms","name":"Site web (WordPress, Webflow...)","platform":"cms","idLabel":"Outil utilisé pour votre site","steps":["Connectez-vous à l'administration de votre site.","Créez un compte utilisateur pour {email_acces} avec le rôle Éditeur (ou Administrateur si nous devons installer le suivi).","Si votre site est géré par un prestataire, transmettez-lui simplement cette demande et cochez la case une fois l'accès créé."]}]},{"id":"access_notes","type":"long","label":"Un accès pose problème ? Dites-le nous ici","placeholder":"Ex. : le Business Manager appartient à notre ancien prestataire..."}]}]$j$::jsonb, 2)
$$;

-- Crée les réglages et les modèles par défaut manquants (idempotent)
create or replace function public.seed_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into onboarding_settings (workspace_id) values (ws) on conflict (workspace_id) do nothing;
  insert into onboarding_templates (workspace_id, key, name, description, icon, sections, position, created_by)
  select ws, d.key, d.name, d.description, d.icon, d.sections, d.position, null
  from onboarding_default_templates() d
  on conflict (workspace_id, key) where key is not null do nothing;
end $$;
revoke execute on function public.seed_onboarding(uuid) from anon, authenticated, public;
grant execute on function public.seed_onboarding(uuid) to service_role;

-- Bouton « Restaurer les modèles par défaut » : désarchive et recrée les manquants
create or replace function public.restore_onboarding_templates(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write(ws) then raise exception 'réservé aux membres de l''espace'; end if;
  update onboarding_templates set archived = false where workspace_id = ws and key in (select key from onboarding_default_templates());
  perform seed_onboarding(ws);
end $$;
revoke execute on function public.restore_onboarding_templates(uuid) from anon, public;
grant execute on function public.restore_onboarding_templates(uuid) to authenticated;

create or replace function public.seed_workspace_defaults_onboarding()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform seed_onboarding(new.id);
  return new;
end $$;
drop trigger if exists workspaces_seed_onboarding on public.workspaces;
create trigger workspaces_seed_onboarding after insert on public.workspaces
  for each row execute function public.seed_workspace_defaults_onboarding();

select public.seed_onboarding(id) from public.workspaces;

-- ---------------------------------------------------------------------
-- 6. Données de démo : un onboarding terminé (Maison Lumen) et un en
--    cours (Atelier Brun). À appeler après load_demo_data.
-- ---------------------------------------------------------------------
create or replace function public._clear_demo_onboarding(ws uuid)
returns void language sql security definer set search_path = public as $$
  delete from onboarding_forms where workspace_id = ws and is_demo;
$$;
revoke execute on function public._clear_demo_onboarding(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_onboarding(uuid) to service_role;

create or replace function public._demo_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := coalesce(auth.uid(), (select user_id from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1));
  c_lumen uuid; k_lumen uuid; c_brun uuid; k_brun uuid; p_lumen uuid;
  t_ecom onboarding_templates; t_local onboarding_templates;
begin
  perform _clear_demo_onboarding(ws);
  perform seed_onboarding(ws);
  select * into t_ecom from onboarding_templates where workspace_id = ws and key = 'ecommerce';
  select * into t_local from onboarding_templates where workspace_id = ws and key = 'local';
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' order by created_at limit 1;
  select id into c_brun from companies where workspace_id = ws and name = 'Atelier Brun' order by created_at limit 1;
  select id into k_lumen from contacts where workspace_id = ws and company_id = c_lumen order by created_at limit 1;
  select id into k_brun from contacts where workspace_id = ws and company_id = c_brun order by created_at limit 1;
  select id into p_lumen from projects where workspace_id = ws and company_id = c_lumen and archived_at is null order by created_at limit 1;

  if c_lumen is not null then
    insert into onboarding_forms (workspace_id, template_id, company_id, contact_id, project_id, title, sections, answers, verified,
      status, progress, options, automation, sent_at, email_sent_at, opened_at, last_activity_at, completed_at, is_demo, created_by)
    values (ws, t_ecom.id, c_lumen, k_lumen, p_lumen, 'Onboarding e-commerce · Maison Lumen', t_ecom.sections,
      jsonb_build_object(
        'brand_name', 'Maison Lumen',
        'website', 'https://maisonlumen.fr',
        'industry', 'E-commerce',
        'pitch', 'Nous dessinons et éditons des luminaires en petites séries, fabriqués dans des ateliers en France. Vente en ligne uniquement depuis 2021, avec un showroom sur rendez-vous à Lyon.',
        'hero_products', E'Suspension Halo : 240 €\nLampe à poser Dune : 165 €\nApplique Arc : 129 €\nCoffret ampoules vintage : 39 €',
        'aov', '180',
        'margin', '62',
        'usp', 'Design signé, fabrication française, garantie 5 ans et livraison offerte dès 100 €.',
        'promos', 'Collection hiver le 15 octobre, Black Friday (-20 % sur tout le site), coffrets cadeaux de Noël.',
        'ideal_customer', 'Femmes et hommes de 30 à 55 ans, propriétaires, qui refont leur intérieur et suivent des comptes déco sur Instagram et Pinterest. Sensibles au made in France.',
        'markets', jsonb_build_array('France', 'Belgique', 'Suisse'),
        'pains', 'Trouver un luminaire qui sort de l''ordinaire sans payer le prix d''une galerie.',
        'objections', E'Peur que le rendu ne corresponde pas aux photos\nDélais de fabrication (10 jours)',
        'repeat', '18',
        'competitors', E'Market Set\nHay\nSammode',
        'admired', 'Caravane',
        'main_goal', 'Augmenter les ventes en ligne',
        'roas_target', '3,5',
        'cpa_target', '45',
        'revenue', '38000',
        'start_date', to_char(current_date + 7, 'YYYY-MM-DD'),
        'budget', '10 000 à 30 000 €',
        'platforms', jsonb_build_array('Meta (Facebook, Instagram)', 'Google Ads', 'Pinterest'),
        'seasonality', 'Novembre et décembre représentent 35 % du chiffre d''affaires annuel. Creux en juillet et août.',
        'ads_before', 'Oui, en interne',
        'learnings', 'Les vidéos d''ambiance en intérieur marchent mieux que les photos produit sur fond blanc. Le retargeting catalogue est très rentable.',
        'past_spend', '9000',
        'assets_link', 'https://drive.google.com/drive/folders/maison-lumen-medias',
        'tone', jsonb_build_array('Premium', 'Chaleureux', 'Minimaliste'),
        'never', 'Ne jamais parler de « pas cher » ni de « promo » hors Black Friday.',
        'legal_regulated', 'Non',
        'legal_validator', 'Claire Dubois, claire@maisonlumen.fr',
        'access', jsonb_build_object(
          'meta_bm', jsonb_build_object('done', true, 'value', '1029384756102938'),
          'meta_ads', jsonb_build_object('done', true, 'value', 'act_556677889900'),
          'google_ads', jsonb_build_object('done', true, 'value', '482-193-7765'),
          'ga4', jsonb_build_object('done', true, 'value', '391827364'),
          'gtm', jsonb_build_object('done', true, 'value', 'GTM-K7LMN2P'),
          'shopify', jsonb_build_object('done', true, 'value', 'maison-lumen.myshopify.com'),
          'search_console', jsonb_build_object('skip', true)),
        'access_notes', 'La Search Console est gérée par notre développeur : il vous ajoute cette semaine.'),
      jsonb_build_object(
        'access:meta_bm', jsonb_build_object('at', now() - interval '8 days', 'by', me),
        'access:meta_ads', jsonb_build_object('at', now() - interval '8 days', 'by', me),
        'access:ga4', jsonb_build_object('at', now() - interval '7 days', 'by', me),
        'access:shopify', jsonb_build_object('at', now() - interval '7 days', 'by', me)),
      'completed', 100, '{"project": true, "kpis": true, "company": true}'::jsonb,
      jsonb_build_object('at', now() - interval '9 days', 'project_id', p_lumen, 'project_created', false, 'tasks', 0,
        'kpis', jsonb_build_object('roas', 3.5, 'cpa', 45), 'company', '[]'::jsonb),
      now() - interval '12 days', now() - interval '12 days', now() - interval '12 days', now() - interval '9 days', now() - interval '9 days', true, me);
  end if;

  if c_brun is not null then
    insert into onboarding_forms (workspace_id, template_id, company_id, contact_id, title, sections, answers,
      status, progress, sent_at, email_sent_at, opened_at, last_activity_at, reminded_at, remind_count, is_demo, created_by)
    values (ws, t_local.id, c_brun, k_brun, 'Onboarding local / prise de RDV · Atelier Brun', t_local.sections,
      jsonb_build_object(
        'brand_name', 'Atelier Brun',
        'website', 'https://atelier-brun.fr',
        'industry', 'Local',
        'address', '12 rue des Tanneurs, 59000 Lille',
        'radius', '40',
        'hours', 'Du lundi au vendredi, 8 h - 18 h. Showroom le samedi matin sur rendez-vous.',
        'phone', '06 55 44 33 22',
        'services', E'Cuisine sur mesure : à partir de 12 000 €\nDressing : à partir de 3 500 €\nBibliothèque et agencement : sur devis',
        'priority_service', 'Cuisine sur mesure',
        'ideal_customer', 'Propriétaires de maisons anciennes dans la métropole lilloise, 35-60 ans, projet de rénovation dans les 6 mois.',
        'booking_tool', 'Téléphone uniquement',
        'access', jsonb_build_object('gbp', jsonb_build_object('done', true, 'value', 'Atelier Brun Menuiserie'))),
      'in_progress', 32, now() - interval '4 days', now() - interval '4 days', now() - interval '3 days', now() - interval '1 day', now() - interval '1 day', 1, true, me);
  end if;
end $$;
revoke execute on function public._demo_onboarding(uuid) from anon, authenticated, public;
grant execute on function public._demo_onboarding(uuid) to service_role;

create or replace function public.load_demo_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _demo_onboarding(ws);
end $$;
revoke execute on function public.load_demo_onboarding(uuid) from anon, public;
grant execute on function public.load_demo_onboarding(uuid) to authenticated;

create or replace function public.clear_demo_onboarding(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_onboarding(ws);
end $$;
revoke execute on function public.clear_demo_onboarding(uuid) from anon, public;
grant execute on function public.clear_demo_onboarding(uuid) to authenticated;

revoke execute on function public.onboarding_default_templates() from anon, public;
grant execute on function public.onboarding_default_templates() to authenticated, service_role;

-- =====================================================================
-- 0072_creatives.sql
-- =====================================================================
-- =====================================================================
-- 0072 : bibliothèque créative (creative strategy) + métriques par annonce
-- Additive : nouvelles tables, RPC de lecture, données de démo.
--  - ad_ads : catalogue des annonces synchronisées (nom, vignette, fréquence 7 j)
--  - ad_metrics_ad_daily : métriques quotidiennes par annonce (dont vidéo)
--  - creative_concepts / creative_variants / creative_assets / creative_ads :
--    concepts créatifs par client, variantes, fichiers et annonces liées
-- =====================================================================

-- ---------------------------------------------------------------------
-- Annonces (catalogue) : alimenté par la synchro (service role)
-- ---------------------------------------------------------------------
create table if not exists public.ad_ads (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_id text not null,
  name text not null default '',
  campaign_id text,
  campaign_name text not null default '',
  adset_id text,
  adset_name text not null default '',
  status text,
  -- image, video, carousel, dpa, search, other
  format text,
  thumbnail_url text,
  -- fréquence et couverture sur les 7 derniers jours (Meta)
  frequency_7d numeric(8,2),
  reach_7d bigint,
  synced_at timestamptz not null default now(),
  primary key (ad_account_id, ad_id)
);
create index if not exists ad_ads_ws on public.ad_ads (workspace_id);

-- ---------------------------------------------------------------------
-- Métriques quotidiennes par annonce
--  video_3s : vues de 3 secondes (Meta : action « video_view »)
--  thruplay : Meta ThruPlay (15 s ou fin) ; Google : vues TrueView
--  video_p25…p100 : lectures jusqu'à 25/50/75/100 % (Google : taux × impressions)
-- ---------------------------------------------------------------------
create table if not exists public.ad_metrics_ad_daily (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  campaign_id text not null default '',
  adset_id text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint,
  clicks bigint not null default 0,
  conversions numeric(14,2) not null default 0,
  conversion_value numeric(14,2) not null default 0,
  video_3s bigint,
  video_p25 bigint,
  video_p50 bigint,
  video_p75 bigint,
  video_p100 bigint,
  thruplay bigint,
  primary key (ad_account_id, date, ad_id)
);
create index if not exists ad_metrics_ad_daily_ws on public.ad_metrics_ad_daily (workspace_id, date);
create index if not exists ad_metrics_ad_daily_ad on public.ad_metrics_ad_daily (workspace_id, ad_id, date);

alter table public.ad_ads enable row level security;
alter table public.ad_metrics_ad_daily enable row level security;
drop policy if exists "lecture membres" on public.ad_ads;
drop policy if exists "lecture membres" on public.ad_metrics_ad_daily;
create policy "lecture membres" on public.ad_ads for select using (public.is_member(workspace_id));
create policy "lecture membres" on public.ad_metrics_ad_daily for select using (public.is_member(workspace_id));

-- ---------------------------------------------------------------------
-- Concepts créatifs
-- ---------------------------------------------------------------------
create table if not exists public.creative_concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  angle text not null default '',
  hook text not null default '',
  persona text not null default '',
  -- niveaux de conscience de Schwartz
  awareness text check (awareness in ('unaware','problem','solution','product','most')),
  format text not null default 'static' check (format in ('static','carousel','short_video','ugc','motion','dpa','other')),
  platforms text[] not null default '{}',
  status text not null default 'idea' check (status in ('idea','brief','production','ready','testing','winner','loser','fatigued')),
  -- { context, script, shots, instructions, dos, donts, cta, duration, references }
  brief jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  verdict text not null default '',
  launched_at date,
  owner_id uuid references auth.users(id) on delete set null,
  cover_path text,
  position double precision not null default 0,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creative_concepts_ws on public.creative_concepts (workspace_id, status);
create index if not exists creative_concepts_task on public.creative_concepts (task_id) where task_id is not null;

-- Variantes : plusieurs hooks / visuels / textes d'un même concept
create table if not exists public.creative_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null references public.creative_concepts(id) on delete cascade,
  name text not null,
  hook text not null default '',
  notes text not null default '',
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists creative_variants_concept on public.creative_variants (concept_id);

-- Fichiers (bucket attachments, chemin <workspace>/creatives/<concept>/…)
create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null references public.creative_concepts(id) on delete cascade,
  variant_id uuid references public.creative_variants(id) on delete set null,
  name text not null,
  path text not null,
  size bigint not null default 0,
  mime text not null default '',
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists creative_assets_concept on public.creative_assets (concept_id);

-- Annonces liées (identifiant d'annonce de la plateforme)
create table if not exists public.creative_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null references public.creative_concepts(id) on delete cascade,
  variant_id uuid references public.creative_variants(id) on delete set null,
  platform text not null default 'meta',
  ad_id text not null,
  created_at timestamptz not null default now(),
  unique (concept_id, platform, ad_id)
);
create index if not exists creative_ads_ws_ad on public.creative_ads (workspace_id, ad_id);

do $$
declare t text;
begin
  foreach t in array array['creative_concepts','creative_variants','creative_assets','creative_ads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "ajout membres" on public.%I', t);
    execute format('drop policy if exists "modif membres" on public.%I', t);
    execute format('drop policy if exists "suppression membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "ajout membres" on public.%I for insert with check (public.can_write(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
end $$;

create or replace function public.touch_creative_concept()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists creative_concepts_touch on public.creative_concepts;
create trigger creative_concepts_touch before update on public.creative_concepts
  for each row execute function public.touch_creative_concept();

-- ---------------------------------------------------------------------
-- Lecture : métriques par annonce d'une période (RLS de l'appelant)
-- ---------------------------------------------------------------------
create or replace function public.creative_ad_daily(p_ws uuid, p_start date, p_end date, p_company uuid default null)
returns table (
  ad_account_id uuid, platform text, company_id uuid, date date, campaign_id text, adset_id text, ad_id text, ad_name text,
  spend numeric, impressions bigint, clicks bigint, conversions numeric, conversion_value numeric,
  video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint, thruplay bigint
)
language sql stable security invoker set search_path = public as $$
  select m.ad_account_id, a.platform, a.company_id, m.date, m.campaign_id, m.adset_id, m.ad_id, m.ad_name,
         m.spend, m.impressions, m.clicks, m.conversions, m.conversion_value,
         m.video_3s, m.video_p25, m.video_p50, m.video_p75, m.video_p100, m.thruplay
  from ad_metrics_ad_daily m
  join ad_accounts a on a.id = m.ad_account_id
  where m.workspace_id = p_ws and m.date between p_start and p_end
    and (p_company is null or a.company_id = p_company)
  order by m.date, m.ad_id;
$$;
grant execute on function public.creative_ad_daily(uuid, date, date, uuid) to authenticated;
revoke execute on function public.creative_ad_daily(uuid, date, date, uuid) from anon, public;

-- ---------------------------------------------------------------------
-- Ventes réelles attribuées aux annonces (tracking first-party).
-- Modèle : dernier point de contact portant un identifiant d'annonce
-- (touchpoints.ad_key, paramètre aos_ad) dans la fenêtre du site,
-- visiteurs fusionnés par email. Achats et deals gagnés.
-- ---------------------------------------------------------------------
create or replace function public.creative_ad_attribution(p_ws uuid, p_start date, p_end date, p_ad_keys text[] default null)
returns table (ad_key text, sales int, revenue numeric)
language sql stable security definer set search_path = public as $$
  with conv as (
    select e.id, e.ts, coalesce(e.value, 0) as value, e.site_id, e.visitor_id, v.email,
           greatest(1, least(coalesce((s.settings->>'window_days')::int, 30), 365)) as win
    from tracking_events e
    join tracking_sites s on s.id = e.site_id
    left join visitors v on v.id = e.visitor_id
    where e.workspace_id = p_ws and public.is_member(p_ws)
      and e.type in ('purchase', 'deal_won')
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz
  ),
  att as (
    select c.value,
      (select t.ad_key from touchpoints t
        where t.site_id = c.site_id
          and t.visitor_id = any(case when c.email is null then array[c.visitor_id]
                                 else coalesce((select array_agg(vv.id) from visitors vv where vv.site_id = c.site_id and vv.email = c.email), array[c.visitor_id]) end)
          and t.ad_key is not null
          and t.ts <= c.ts and t.ts > c.ts - make_interval(days => c.win)
        order by t.ts desc limit 1) as ad_key
    from conv c
  )
  select a.ad_key, count(*)::int, sum(a.value)
  from att a
  where a.ad_key is not null and (p_ad_keys is null or a.ad_key = any(p_ad_keys))
  group by a.ad_key;
$$;
grant execute on function public.creative_ad_attribution(uuid, date, date, text[]) to authenticated;
revoke execute on function public.creative_ad_attribution(uuid, date, date, text[]) from anon, public;

-- =====================================================================
-- Données de démo : annonces Meta de Maison Lumen et Kalia (métriques par
-- annonce obtenues en répartissant ad_metrics_daily, donc cohérentes avec
-- le reporting), ~23 concepts reliés aux annonces et aux tâches créa.
-- Les identifiants d'annonce suivent la formule du seed de tracking
-- ('2386' || hashtext(campagne || annonce)) : l'attribution réelle s'affiche.
-- =====================================================================
create or replace function public._clear_demo_creatives(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from creative_concepts where workspace_id = ws and is_demo;
  delete from ad_metrics_ad_daily m using ad_accounts a
    where a.id = m.ad_account_id and a.workspace_id = ws and a.external_id like 'demo-%';
  delete from ad_ads d using ad_accounts a
    where a.id = d.ad_account_id and a.workspace_id = ws and a.external_id like 'demo-%';
end $$;
revoke execute on function public._clear_demo_creatives(uuid) from anon, authenticated, public;

create or replace function public._demo_creatives(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_lumen uuid; c_kalia uuid; p_lum uuid; p_kal uuid; t_lum uuid; t_kal uuid; t_kal2 uuid;
  me uuid;
  r record; cid uuid; vid uuid; n int := 0; k text; v_ad text;
  concept_ids jsonb := '{}'::jsonb;
begin
  perform _clear_demo_creatives(ws);
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' limit 1;
  select id into c_kalia from companies where workspace_id = ws and name = 'Kalia Cosmetics' limit 1;
  if c_lumen is null and c_kalia is null then return 0; end if;
  select id into p_lum from projects where workspace_id = ws and key = 'LUM' limit 1;
  select id into p_kal from projects where workspace_id = ws and key = 'KAL' limit 1;
  select id into t_lum from tasks where project_id = p_lum and title like 'Brief créa%' limit 1;
  select id into t_kal from tasks where project_id = p_kal and title like '8 nouveaux concepts%' limit 1;
  select id into t_kal2 from tasks where project_id = p_kal and title like 'Scripts UGC%' limit 1;
  select user_id into me from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1;

  -- ---------- Annonces : répartition des métriques de campagne ----------
  drop table if exists _ads;
  drop table if exists _rows;
  create temp table _ads on commit drop as
  select * from (values
    -- ext, campagne, annonce, ensemble, lancée (jours), arrêtée, poids, cpm, ctr, perf, panier, hook (null = statique), hold, fatigue dès (jours), format
    ('demo-lumen-meta', 'Advantage+ Shopping', 'UGC Suspension Opale', 'Broad FR 25-55', 999, 0, 1.4, 1.00, 1.15, 1.35, 1.05, 0.34, 0.30, null::int, 'video'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Carrousel best-sellers', 'Broad FR 25-55', 999, 0, 1.0, 0.95, 0.90, 0.78, 0.95, null, null, null, 'carousel'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Vidéo atelier', 'Intérêts déco maison', 999, 0, 1.1, 1.05, 1.10, 1.12, 1.10, 0.29, 0.24, 24, 'video'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Motion lampadaire Arc', 'Broad FR 25-55', 35, 0, 0.8, 1.00, 1.00, 0.98, 1.20, 0.25, 0.20, null, 'video'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'Statique cadeau Noël', 'Broad FR 25-55', 12, 0, 0.9, 0.90, 1.20, 1.50, 1.00, null, null, null, 'image'),
    ('demo-lumen-meta', 'Advantage+ Shopping', 'UGC cocooning soirée', 'Intérêts déco maison', 25, 0, 1.0, 1.00, 1.25, 1.28, 1.00, 0.38, 0.33, null, 'video'),
    ('demo-lumen-meta', 'Retargeting 30 j', 'Lampadaire Arc statique', 'Visiteurs 30 j', 999, 0, 1.0, 1.00, 1.00, 1.05, 1.25, null, null, null, 'image'),
    ('demo-lumen-meta', 'Retargeting 30 j', 'Offre retour panier', 'Paniers abandonnés', 999, 0, 1.0, 1.10, 1.30, 1.20, 0.90, null, null, null, 'image'),
    ('demo-lumen-meta', 'Retargeting 30 j', 'Avis clientes 4,9', 'Visiteurs 30 j', 40, 0, 0.7, 1.00, 0.85, 0.92, 1.00, null, null, null, 'image'),
    ('demo-kalia-meta', 'Prospection UGC', 'UGC routine du soir', 'Broad femmes 25-45', 999, 0, 1.3, 1.00, 1.10, 1.22, 1.00, 0.36, 0.31, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Avant après sérum', 'Broad femmes 25-45', 999, 0, 1.2, 1.00, 1.20, 1.42, 1.05, 0.41, 0.28, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Témoignage Inès', 'Lookalike acheteuses 3 %', 999, 0, 1.1, 1.00, 1.15, 1.18, 1.00, 0.33, 0.29, 26, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Hook peau qui tiraille', 'Broad femmes 25-45', 18, 0, 1.0, 1.00, 1.30, 1.30, 0.95, 0.44, 0.27, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Motion ingrédients', 'Lookalike acheteuses 3 %', 30, 0, 0.7, 0.95, 0.75, 0.62, 0.90, 0.19, 0.14, null, 'video'),
    ('demo-kalia-meta', 'Prospection UGC', 'Statique avis 4,8', 'Broad femmes 25-45', 45, 0, 0.6, 0.90, 0.80, 0.84, 1.00, null, null, null, 'image'),
    ('demo-kalia-meta', 'Prospection UGC', 'UGC 3 erreurs routine', 'Broad femmes 25-45', 8, 0, 0.9, 1.00, 1.20, 1.16, 1.00, 0.39, 0.26, null, 'video'),
    ('demo-kalia-meta', 'Catalogue DPA', 'DPA carrousel', 'Vues produit 14 j', 999, 0, 1.0, 1.00, 1.00, 1.03, 1.00, null, null, null, 'dpa'),
    ('demo-kalia-meta', 'Catalogue DPA', 'DPA collection', 'Acheteuses 180 j', 999, 0, 1.0, 1.00, 0.95, 0.96, 1.00, null, null, null, 'dpa')
  ) as x(ext, campaign, ad, adset, launch, stop, wt, cpmf, ctrf, perf, aovf, hook, hold, fat, fmt);

  create temp table _rows on commit drop as
  with base as (
    select m.ad_account_id, m.date, m.campaign_id, m.spend, m.impressions, m.clicks, m.conversions, m.conversion_value,
           a.*, (current_date - m.date) as ago,
           '2386' || lpad((abs(hashtext(a.campaign || a.ad)) % 100000000)::text, 8, '0') as ad_id,
           '2385' || lpad((abs(hashtext(a.campaign || a.adset)) % 100000000)::text, 8, '0') as adset_id,
           0.85 + 0.3 * ((hashtext(a.ad || m.date::text) & 255) / 255.0) as noise,
           0.9 + 0.2 * ((hashtext(m.date::text || a.ad) & 255) / 255.0) as noise2
    from ad_metrics_daily m
    join ad_accounts acc on acc.id = m.ad_account_id and acc.workspace_id = ws
    join _ads a on a.ext = acc.external_id and a.campaign = m.campaign_name
    where (current_date - m.date) <= a.launch and (current_date - m.date) >= a.stop
  ),
  f as (
    select b.*,
      least(1.0, (b.launch - b.ago + 1) / 3.0) as ramp,
      case when b.fat is not null and b.ago < b.fat then greatest(0.42, 1 - (b.fat - b.ago) * 0.028) else 1 end as fatf
    from base b
  ),
  ww as (
    select f.*,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise as ws_spend,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.cpmf as ws_imp,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.cpmf * f.ctrf * f.fatf as ws_clk,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.perf * f.fatf * f.noise2 as ws_conv,
      f.wt * f.ramp * (0.6 + 0.4 * f.fatf) * f.noise * f.perf * f.fatf * f.noise2 * f.aovf as ws_val
    from f
  )
  select w.*,
    round((w.spend * w.ws_spend / sum(w.ws_spend) over p)::numeric, 2) as a_spend,
    round(w.impressions * w.ws_imp / sum(w.ws_imp) over p)::bigint as a_imp,
    round(w.clicks * w.ws_clk / sum(w.ws_clk) over p)::bigint as a_clk,
    round((w.conversions * w.ws_conv / sum(w.ws_conv) over p)::numeric, 2) as a_conv,
    round((w.conversion_value * w.ws_val / sum(w.ws_val) over p)::numeric, 2) as a_val
  from ww w
  window p as (partition by w.ad_account_id, w.date, w.campaign_id);

  insert into ad_metrics_ad_daily (ad_account_id, workspace_id, date, campaign_id, adset_id, ad_id, ad_name, spend, impressions, reach, clicks,
                                   conversions, conversion_value, video_3s, video_p25, video_p50, video_p75, video_p100, thruplay)
  select q.ad_account_id, ws, q.date, q.campaign_id, q.adset_id, q.ad_id, q.ad, q.a_spend, q.a_imp, round(q.a_imp / 1.18)::bigint, q.a_clk,
         q.a_conv, q.a_val,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2)::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * least(0.95, q.hold * 2.2))::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * least(0.9, q.hold * 1.5))::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * q.hold * 1.05)::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * q.hold * 0.7)::bigint end,
         case when q.hook is not null then round(q.a_imp * q.hook * (0.75 + 0.25 * q.fatf) * q.noise2 * q.hold)::bigint end
  from _rows q;
  get diagnostics n = row_count;

  insert into ad_ads (ad_account_id, workspace_id, ad_id, name, campaign_id, campaign_name, adset_id, adset_name, status, format, frequency_7d, reach_7d)
  select distinct on (q.ad_account_id, q.ad_id) q.ad_account_id, ws, q.ad_id, q.ad, q.campaign_id, q.campaign, q.adset_id, q.adset,
         'ACTIVE', q.fmt,
         case when q.fat is not null then 3.6 + ((hashtext(q.ad) & 7) / 10.0) when q.campaign like 'Retargeting%' or q.campaign like 'Catalogue%' then 2.6 + ((hashtext(q.ad) & 7) / 10.0) else 1.4 + ((hashtext(q.ad) & 7) / 10.0) end,
         (select round(sum(x.a_imp) / 2.4)::bigint from _rows x where x.ad_id = q.ad_id and x.ago <= 7)
  from _rows q
  order by q.ad_account_id, q.ad_id;

  -- ---------- Concepts ----------
  for r in
    select * from (values
      -- clé, client, titre, angle, hook, persona, conscience, format, statut, annonces liées, variantes (nom|hook;…), tags, verdict, lancé il y a (jours), tâche
      ('lum-opale', 'lumen', 'Suspension Opale en situation', 'Cocooning', 'Mon salon a changé d''ambiance avec une seule lampe', 'Claire, 38 ans, propriétaire qui décore', 'solution', 'ugc', 'winner',
        array['UGC Suspension Opale'], 'V1 salon|Mon salon a changé d''ambiance avec une seule lampe;V2 chambre|Ma chambre ressemble enfin à un hôtel', array['Hiver','Best-seller'],
        'Gagnant : ROAS 30 % au-dessus du compte sur 90 jours, hook rate stable autour de 34 %. À décliner en 3 nouveaux hooks.', 90, null),
      ('lum-best', 'lumen', 'Les best-sellers de la saison', 'Preuve sociale', 'Les 5 luminaires que nos clientes rachètent', 'Acheteuse qui compare', 'product', 'carousel', 'loser',
        array['Carrousel best-sellers'], null, array['Catalogue'], 'Perdant : CPA 25 % au-dessus de la moyenne, le carrousel dilue le message. On le coupe au prochain rafraîchissement.', 90, null),
      ('lum-atelier', 'lumen', 'Dans l''atelier Lumen', 'Artisanat et design signé', 'Chaque abat-jour est soufflé à la main, à 40 km de Lyon', 'Amateur de design, sensible au fait main', 'product', 'short_video', 'fatigued',
        array['Vidéo atelier'], 'V1 souffleur|Chaque abat-jour est soufflé à la main;V2 chiffres|3 heures de travail pour une seule suspension', array['Marque'],
        'Épuisé : CTR en baisse de plus de 30 % depuis son pic, fréquence au-dessus de 3,5. Nouveau montage à prévoir.', 90, null),
      ('lum-arc', 'lumen', 'Lampadaire Arc sans perçage', 'Artisanat et design signé', 'Un arc de 2 mètres, zéro perçage', 'Locataire en appartement', 'solution', 'motion', 'testing',
        array['Motion lampadaire Arc', 'Lampadaire Arc statique'], 'Motion|Un arc de 2 mètres, zéro perçage;Statique retargeting|Toujours en train d''y penser ?', array['Hiver'], '', 35, null),
      ('lum-cadeau', 'lumen', 'Idée cadeau lumineuse', 'Cadeau de Noël', 'Le cadeau qu''on garde 20 ans', 'Acheteur cadeau, 30-55 ans', 'unaware', 'static', 'testing',
        array['Statique cadeau Noël'], 'Carte cadeau|Le cadeau qu''on garde 20 ans;Emballage|Déjà emballé, livré avant le 20 décembre', array['Noël','Black Friday'], '', 12, 'lum'),
      ('lum-cocooning', 'lumen', 'Soirée cocooning', 'Cocooning', 'POV : 18 h, tu n''allumes plus que la lampe d''appoint', 'Claire, 38 ans, propriétaire qui décore', 'problem', 'ugc', 'testing',
        array['UGC cocooning soirée'], 'POV|POV : 18 h, tu n''allumes plus que la lampe d''appoint;Question|Pourquoi ton salon fait « salle d''attente » le soir ?', array['Hiver'], '', 25, 'lum'),
      ('lum-retour', 'lumen', 'Livraison offerte et retours 60 jours', 'Réassurance', 'Tu hésites ? Essaie-la 60 jours chez toi', 'Visiteuse qui a abandonné son panier', 'most', 'static', 'winner',
        array['Offre retour panier'], null, array['Retargeting'], 'Gagnant en retargeting : meilleur CTR du compte, ROAS 5+.', 90, null),
      ('lum-avis', 'lumen', 'Avis clientes 4,9 / 5', 'Preuve sociale', '4,9 / 5 sur 2 300 avis vérifiés', 'Visiteuse qui a abandonné son panier', 'product', 'static', 'testing',
        array['Avis clientes 4,9'], null, array['Retargeting'], '', 40, null),
      ('lum-avantapres', 'lumen', 'Avant / après : le salon sombre', 'Cocooning', 'Même pièce, même heure, une seule lampe en plus', 'Claire, 38 ans, propriétaire qui décore', 'problem', 'ugc', 'production',
        null, 'Avant après|Même pièce, même heure, une seule lampe en plus;Timelapse|De 17 h à 22 h dans mon salon', array['Hiver'], '', null, 'lum'),
      ('lum-bf', 'lumen', 'Black Friday : -20 % sur les suspensions', 'Offre', 'Les suspensions à -20 %, 4 jours seulement', 'Acheteuse qui attend les promos', 'most', 'static', 'brief',
        null, null, array['Black Friday'], '', null, 'lum'),
      ('lum-designer', 'lumen', 'Le designer raconte la collection hiver', 'Artisanat et design signé', 'J''ai dessiné cette lampe en pensant à ma grand-mère', 'Amateur de design, sensible au fait main', 'unaware', 'short_video', 'idea',
        null, null, array['Marque'], '', null, null),
      ('kal-routine', 'kalia', 'Routine du soir en 3 gestes', 'Routine simplifiée', 'Ma routine du soir tient en 90 secondes', 'Active 30-45 ans, peu de temps', 'solution', 'ugc', 'winner',
        array['UGC routine du soir'], 'V1 90 secondes|Ma routine du soir tient en 90 secondes;V2 3 produits|3 produits, pas un de plus;V3 démaquillage|Je me démaquille en 20 secondes', array['Evergreen'],
        'Gagnant : ROAS stable 20 % au-dessus du compte, hook rate 36 %. Tester les V2 et V3 en hooks.', 90, null),
      ('kal-avantapres', 'kalia', 'Avant / après Sérum Éclat', 'Résultats visibles', 'J28 : même lumière, même téléphone, zéro filtre', 'Peau terne, 30-45 ans', 'product', 'ugc', 'winner',
        array['Avant après sérum'], 'J28|J28 : même lumière, même téléphone, zéro filtre;Zoom|Zoom sur mes pores, sans maquillage', array['Sérum','Evergreen'],
        'Meilleure créa du compte : ROAS +40 %, hook rate au-dessus de 40 %. Priorité : 3 nouvelles créatrices sur le même format.', 90, null),
      ('kal-ines', 'kalia', 'Témoignage Inès', 'Preuve sociale', 'J''ai arrêté 6 produits pour un seul', 'Débutante skincare', 'solution', 'ugc', 'fatigued',
        array['Témoignage Inès'], null, array['Témoignage'], 'Épuisé : CTR -35 % depuis son pic, fréquence 3,7. Refaire le hook avec une autre créatrice.', 90, null),
      ('kal-tiraille', 'kalia', 'Peau qui tiraille après la douche', 'Problème peau sèche', 'Si ta peau tiraille après la douche, écoute ça', 'Peau sèche, 30-45 ans', 'problem', 'ugc', 'testing',
        array['Hook peau qui tiraille'], 'Question|Si ta peau tiraille après la douche, écoute ça;Erreur|L''erreur que tu fais juste après la douche', array['Crème nuit'], '', 18, null),
      ('kal-ingredients', 'kalia', '5 ingrédients, rien d''autre', 'Ingrédients naturels', 'Lis la liste d''ingrédients de ta crème', 'Consommatrice clean beauty', 'problem', 'motion', 'loser',
        array['Motion ingrédients'], null, array['Crème nuit'], 'Perdant : hook rate 19 %, les 3 premières secondes n''arrêtent pas le scroll. Angle à retravailler en UGC.', 30, null),
      ('kal-avis', 'kalia', 'Note 4,8 / 5 sur 12 000 avis', 'Preuve sociale', '12 000 femmes ont changé de crème de nuit', 'Débutante skincare', 'product', 'static', 'testing',
        array['Statique avis 4,8'], null, array['Crème nuit'], '', 45, null),
      ('kal-erreurs', 'kalia', '3 erreurs qui ruinent ta routine', 'Routine simplifiée', 'Erreur n°1 : tu mets ton sérum sur une peau sèche', 'Débutante skincare', 'problem', 'ugc', 'testing',
        array['UGC 3 erreurs routine'], null, array['Sérum'], '', 8, 'kal'),
      ('kal-dpa', 'kalia', 'Catalogue dynamique', 'Produit', 'Tes produits vus, avec la livraison offerte', 'Visiteuse qui a vu un produit', 'most', 'dpa', 'testing',
        array['DPA carrousel', 'DPA collection'], null, array['Retargeting'], '', 90, null),
      ('kal-dermato', 'kalia', 'Une dermato répond aux commentaires', 'Expertise', 'Une dermato lit vos commentaires (et elle n''est pas d''accord)', 'Consommatrice clean beauty', 'solution', 'short_video', 'production',
        null, null, array['Expertise'], '', null, 'kal2'),
      ('kal-coffret', 'kalia', 'Unboxing coffret de Noël', 'Cadeau de Noël', 'Le coffret que je m''offre avant de l''offrir', 'Acheteuse cadeau', 'unaware', 'ugc', 'brief',
        null, null, array['Noël'], '', null, 'kal2'),
      ('kal-matin', 'kalia', 'Routine express du matin', 'Routine simplifiée', '2 minutes chrono, café compris', 'Active 30-45 ans, peu de temps', 'solution', 'ugc', 'idea',
        null, null, array['Evergreen'], '', null, 'kal'),
      ('kal-comparatif', 'kalia', 'Crème de pharmacie ou Kalia ?', 'Comparaison', 'J''ai comparé ma crème de pharmacie à 34 € avec celle-ci', 'Peau sèche, 30-45 ans', 'solution', 'static', 'ready',
        null, null, array['Crème nuit'], '', null, 'kal')
    ) as x(key, client, title, angle, hook, persona, awareness, format, status, ads, variants, tags, verdict, launched, task)
  loop
    if (r.client = 'lumen' and c_lumen is null) or (r.client = 'kalia' and c_kalia is null) then continue; end if;
    insert into creative_concepts (workspace_id, company_id, project_id, task_id, title, angle, hook, persona, awareness, format, platforms, status,
                                   brief, tags, verdict, launched_at, owner_id, position, is_demo, created_by, created_at)
    values (ws,
      case r.client when 'lumen' then c_lumen else c_kalia end,
      case r.client when 'lumen' then p_lum else p_kal end,
      case r.task when 'lum' then t_lum when 'kal' then t_kal when 'kal2' then t_kal2 end,
      r.title, r.angle, r.hook, r.persona, r.awareness, r.format, array['meta'], r.status,
      jsonb_build_object(
        'context', case r.client
          when 'lumen' then 'Maison Lumen crée des luminaires design fabriqués en France (panier moyen 180 €). Ton chaleureux, jamais luxe froid. Objectif : ventes en ligne, ROAS cible 3,5.'
          else 'Kalia Cosmetics : cosmétique naturelle en vente directe, formules courtes (5 à 8 ingrédients). Ton complice, preuve avant promesse. Objectif : achats, CPA cible 25 €.' end,
        'script', case when r.format in ('ugc', 'short_video') then
          '0-3 s : ' || r.hook || E'\n3-10 s : le problème vécu, en une phrase, face caméra.\n10-25 s : démonstration du produit en situation réelle (gros plans).\n25-35 s : le résultat, sans exagération.\n35-40 s : appel à l''action.'
          when r.format = 'motion' then E'Plan 1 : accroche en texte animé (' || r.hook || E')\nPlan 2 : produit en rotation lente\nPlan 3 : 3 bénéfices en surimpression\nPlan 4 : logo + offre'
          else 'Accroche : ' || r.hook || E'\nVisuel : produit en situation, lumière naturelle.\nTexte court : un bénéfice, une preuve.' end,
        'shots', case when r.format in ('ugc', 'short_video') then E'Plan face caméra (lumière de fenêtre)\nGros plan produit en main\nPlan d''ambiance (pièce ou salle de bain)\nPlan résultat' else E'Format 4:5 et 9:16\nProduit centré, marge de sécurité de 14 % en haut et en bas' end,
        'instructions', 'Filmer au téléphone, en vertical 9:16, sans filtre. Parler comme à une amie, pas de texte appris par cœur. Livrer 3 prises du hook.',
        'dos', E'Montrer le produit dans les 3 premières secondes\nSous-titres lisibles\nUne seule idée par vidéo',
        'donts', E'Pas de musique sous droits\nPas de promesse médicale ou de « miracle »\nPas de logo concurrent visible',
        'cta', case r.client when 'lumen' then 'Découvre la collection sur maisonlumen.fr' else 'Teste la routine avec -15 % sur ta première commande' end,
        'duration', case when r.format in ('ugc', 'short_video') then '30 à 45 s' when r.format = 'motion' then '10 à 15 s' else '' end),
      r.tags, r.verdict, case when r.launched is not null then current_date - r.launched end, me, (n + 1) * 1000, true, me,
      now() - make_interval(days => coalesce(r.launched, 3) + 4))
    returning id into cid;
    n := n + 1;

    -- variantes
    if r.variants is not null then
      declare vparts text[] := string_to_array(r.variants, ';'); i int := 0;
      begin
        foreach k in array vparts loop
          i := i + 1;
          insert into creative_variants (workspace_id, concept_id, name, hook, position)
          values (ws, cid, split_part(k, '|', 1), split_part(k, '|', 2), i * 1000)
          returning id into vid;
          -- chaque annonce liée est rattachée à la variante de même rang (si elle existe)
          if r.ads is not null and array_length(r.ads, 1) >= i then
            insert into creative_ads (workspace_id, concept_id, variant_id, platform, ad_id)
            select ws, cid, vid, 'meta', a.ad_id from (select distinct x.ad_id from _rows x where x.ad = r.ads[i]) a
            on conflict do nothing;
          end if;
        end loop;
      end;
    end if;
    if r.ads is not null then
      foreach v_ad in array r.ads loop
        insert into creative_ads (workspace_id, concept_id, platform, ad_id)
        select ws, cid, 'meta', x.ad_id from (select distinct y.ad_id from _rows y where y.ad = v_ad) x
        on conflict do nothing;
      end loop;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._demo_creatives(uuid) from anon, authenticated, public;
grant execute on function public._demo_creatives(uuid) to service_role;
grant execute on function public._clear_demo_creatives(uuid) to service_role;

-- Points d'entrée pour l'interface (réservés aux admins de l'espace)
create or replace function public.load_demo_creatives(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_creatives(ws);
end $$;
revoke execute on function public.load_demo_creatives(uuid) from anon, public;
grant execute on function public.load_demo_creatives(uuid) to authenticated;

create or replace function public.clear_demo_creatives(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_creatives(ws);
end $$;
revoke execute on function public.clear_demo_creatives(uuid) from anon, public;
grant execute on function public.clear_demo_creatives(uuid) to authenticated;

-- =====================================================================
-- 0073_booking.sql
-- =====================================================================
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

-- =====================================================================
-- 0074_api_tokens.sql
-- =====================================================================
-- =====================================================================
-- API et serveur MCP : jetons personnels d'accès.
-- Un jeton = un utilisateur dans un espace. Seul le hash SHA-256 est
-- stocké : le jeton complet n'est montré qu'une fois, à la création.
-- La route /api/mcp retrouve le jeton par son hash (service role), puis
-- revérifie à chaque appel l'appartenance et le rôle dans l'espace.
-- Additive : aucune table existante modifiée.
-- =====================================================================

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  -- début visible du jeton (aos_xxxxxxxx), pour le reconnaître dans la liste
  prefix text not null,
  token_hash text not null unique,
  -- read : outils de lecture seulement ; write : lecture et écriture (selon le rôle)
  scope text not null default 'read' check (scope in ('read', 'write')),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_tokens_ws_user on public.api_tokens (workspace_id, user_id);

alter table public.api_tokens enable row level security;

-- Chacun voit ses jetons ; les admins voient ceux de l'espace (pour pouvoir les révoquer)
drop policy if exists "jetons lisibles" on public.api_tokens;
create policy "jetons lisibles" on public.api_tokens for select
  using (public.is_member(workspace_id) and (user_id = auth.uid() or public.is_admin(workspace_id)));
drop policy if exists "jetons supprimables" on public.api_tokens;
create policy "jetons supprimables" on public.api_tokens for delete
  using (public.is_member(workspace_id) and (user_id = auth.uid() or public.is_admin(workspace_id)));

-- Le hash n'est jamais lisible côté client ; création et révocation passent par les RPC
revoke all on public.api_tokens from anon, authenticated;
grant select (id, workspace_id, user_id, name, prefix, scope, last_used_at, expires_at, revoked_at, created_at)
  on public.api_tokens to authenticated;
grant delete on public.api_tokens to authenticated;

-- ---------------------------------------------------------------------
-- Création : renvoie le jeton complet (une seule fois)
-- ---------------------------------------------------------------------
create or replace function public.create_api_token(p_ws uuid, p_name text, p_scope text default 'read', p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_scope text := coalesce(p_scope, 'read');
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  if not public.is_member(p_ws) then raise exception 'Tu n''es pas membre de cet espace'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Donne un nom au jeton'; end if;
  if v_scope not in ('read', 'write') then raise exception 'Portée inconnue'; end if;
  -- Un invité ne peut pas écrire : son jeton est forcément en lecture seule
  if v_scope = 'write' and not public.can_write(p_ws) then v_scope := 'read'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'La date d''expiration est déjà passée'; end if;
  if (select count(*) from api_tokens where workspace_id = p_ws and user_id = auth.uid() and revoked_at is null) >= 20 then
    raise exception 'Limite de 20 jetons actifs atteinte : révoque ceux qui ne servent plus';
  end if;

  v_token := 'aos_' || translate(encode(extensions.gen_random_bytes(30), 'base64'), '+/', '-_');
  insert into api_tokens (workspace_id, user_id, name, prefix, token_hash, scope, expires_at)
  values (p_ws, auth.uid(), left(trim(p_name), 80), left(v_token, 12),
          encode(extensions.digest(v_token, 'sha256'), 'hex'), v_scope, p_expires_at)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', left(v_token, 12), 'scope', v_scope);
end $$;

-- ---------------------------------------------------------------------
-- Révocation (l'auteur ou un admin de l'espace)
-- ---------------------------------------------------------------------
create or replace function public.revoke_api_token(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t api_tokens;
begin
  select * into t from api_tokens where id = p_id;
  if t.id is null or not public.is_member(t.workspace_id)
     or (t.user_id is distinct from auth.uid() and not public.is_admin(t.workspace_id)) then
    raise exception 'Jeton introuvable';
  end if;
  update api_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

revoke execute on function public.create_api_token(uuid, text, text, timestamptz) from anon, public;
revoke execute on function public.revoke_api_token(uuid) from anon, public;
grant execute on function public.create_api_token(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.revoke_api_token(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Lecture du tracking pour le serveur MCP (service role uniquement).
-- Les RPC du tracking vérifient is_member(auth.uid()) : on exécute la
-- requête au nom de l'utilisateur du jeton, dans la transaction seulement,
-- après avoir vérifié son appartenance à l'espace du site.
-- ---------------------------------------------------------------------
create or replace function public.mcp_act_as(p_user uuid, p_ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from workspace_members where workspace_id = p_ws and user_id = p_user) then
    raise exception 'Accès refusé';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function public.mcp_tracking_conversions(p_user uuid, p_ws uuid, p_site uuid, p_start date, p_end date, p_window int, p_types text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare res jsonb;
begin
  if not exists (select 1 from tracking_sites where id = p_site and workspace_id = p_ws) then
    raise exception 'Site introuvable';
  end if;
  perform public.mcp_act_as(p_user, p_ws);
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into res
  from public.tracking_conversions(p_site, p_start, p_end, p_window, p_types) c;
  return res;
end $$;

create or replace function public.mcp_tracking_stats(p_user uuid, p_ws uuid, p_site uuid, p_start date, p_end date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from tracking_sites where id = p_site and workspace_id = p_ws) then
    raise exception 'Site introuvable';
  end if;
  perform public.mcp_act_as(p_user, p_ws);
  return public.tracking_stats(p_site, p_start, p_end);
end $$;

revoke execute on function public.mcp_act_as(uuid, uuid) from anon, authenticated, public;
revoke execute on function public.mcp_tracking_conversions(uuid, uuid, uuid, date, date, int, text[]) from anon, authenticated, public;
revoke execute on function public.mcp_tracking_stats(uuid, uuid, uuid, date, date) from anon, authenticated, public;
grant execute on function public.mcp_act_as(uuid, uuid) to service_role;
grant execute on function public.mcp_tracking_conversions(uuid, uuid, uuid, date, date, int, text[]) to service_role;
grant execute on function public.mcp_tracking_stats(uuid, uuid, uuid, date, date) to service_role;

-- =====================================================================
-- 0080_workspace_modules.sql
-- =====================================================================
-- Modules activés par espace (null = tous, pour les espaces existants).
-- Ergonomie seulement : la RLS reste la protection des données.
alter table public.workspaces add column if not exists modules text[];

-- =====================================================================
-- 0082_creative_intel.sql
-- =====================================================================
-- =====================================================================
-- 0082 : veille concurrentielle (API Meta Ad Library) + tagging et
-- recommandations IA de la bibliothèque créa. Additive.
--  - creative_intel_settings : jeton Ad Library collé à la main (aucune
--    policy : service role uniquement, jamais renvoyé au navigateur)
--  - competitor_watches : surveillances par client (page ou mot-clé)
--  - competitor_ads : pubs de la bibliothèque publicitaire (une par
--    espace et par identifiant d'archive), tags IA
--  - creative_recommendations : historique des recommandations IA
--  - creative_concepts : source (inspiration concurrente) + tags IA
--  - notifications.kind : ajout de « creative »
-- =====================================================================

-- ---------------------------------------------------------------------
-- Réglages : jeton manuel (secret) et état du dernier test
-- ---------------------------------------------------------------------
create table if not exists public.creative_intel_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  access_token text,
  token_label text,
  token_user_id text,
  token_expires_at timestamptz,
  token_checked_at timestamptz,
  token_ok boolean,
  token_error text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.creative_intel_settings enable row level security;
-- aucune policy : lecture / écriture par le service role uniquement

-- État lisible par les membres (sans le jeton)
create or replace function public.creative_intel_status(ws uuid)
returns table (
  has_manual boolean, manual_label text, manual_expires_at timestamptz, manual_checked_at timestamptz,
  manual_ok boolean, manual_error text,
  has_connection boolean, connection_label text, connection_expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    (s.access_token is not null), s.token_label, s.token_expires_at, s.token_checked_at, s.token_ok, s.token_error,
    (c.id is not null), c.label, c.expires_at
  from (select 1) one
  left join creative_intel_settings s on s.workspace_id = ws
  left join lateral (
    select id, label, expires_at from ad_connections
    where workspace_id = ws and platform = 'meta' and (expires_at is null or expires_at > now())
    order by created_at desc limit 1
  ) c on true
  where public.is_member(ws);
$$;
revoke execute on function public.creative_intel_status(uuid) from anon, public;
grant execute on function public.creative_intel_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Surveillances
-- ---------------------------------------------------------------------
create table if not exists public.competitor_watches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null default 'page' check (kind in ('page', 'keyword')),
  page_id text,
  page_name text not null default '',
  search_terms text not null default '',
  countries text[] not null default '{FR}',
  active_only boolean not null default true,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  last_notified_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint competitor_watches_target check (
    (kind = 'page' and page_id is not null and page_id ~ '^[0-9]{3,30}$')
    or (kind = 'keyword' and length(trim(search_terms)) between 2 and 100)
  )
);
create index if not exists competitor_watches_ws on public.competitor_watches (workspace_id);

-- ---------------------------------------------------------------------
-- Pubs concurrentes (API Ad Library). Pas de dépense ni d'impressions
-- pour les pubs commerciales ; aucun média stocké (lien d'aperçu seulement).
-- ---------------------------------------------------------------------
create table if not exists public.competitor_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  watch_id uuid references public.competitor_watches(id) on delete cascade,
  archive_id text not null,
  page_id text not null default '',
  page_name text not null default '',
  bodies text[] not null default '{}',
  titles text[] not null default '{}',
  descriptions text[] not null default '{}',
  captions text[] not null default '{}',
  start_time timestamptz,
  stop_time timestamptz,
  -- URL d'aperçu sans le jeton (le paramètre access_token est retiré)
  snapshot_url text,
  platforms text[] not null default '{}',
  languages text[] not null default '{}',
  eu_reach bigint,
  target_ages text,
  target_gender text,
  target_locations jsonb,
  is_active boolean not null default true,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- tags IA : { angle, hook_type, hook, awareness, format, promise, proof, offer, cta, persona }
  ai_tags jsonb,
  ai_tags_hash text,
  ai_tagged_at timestamptz,
  concept_id uuid references public.creative_concepts(id) on delete set null,
  is_demo boolean not null default false,
  unique (workspace_id, archive_id)
);
create index if not exists competitor_ads_watch on public.competitor_ads (watch_id);
create index if not exists competitor_ads_ws_seen on public.competitor_ads (workspace_id, first_seen desc);

-- ---------------------------------------------------------------------
-- Recommandations IA (historique par client)
-- ---------------------------------------------------------------------
create table if not exists public.creative_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  model text not null default '',
  -- { summary, opportunities: [{ title, kind, why, evidence, competitor_ads, brief }] }
  output jsonb not null default '{}'::jsonb,
  -- chiffres transmis au modèle (traçabilité)
  stats jsonb not null default '{}'::jsonb,
  usage jsonb,
  -- concepts créés depuis une opportunité : { "<index>": "<concept id>" }
  created_concepts jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists creative_recommendations_ws on public.creative_recommendations (workspace_id, company_id, created_at desc);

-- RLS : lecture membres ; l'insertion passe par le serveur (service role)
alter table public.competitor_watches enable row level security;
alter table public.competitor_ads enable row level security;
alter table public.creative_recommendations enable row level security;
do $$
declare t text;
begin
  foreach t in array array['competitor_watches','competitor_ads','creative_recommendations'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "ajout membres" on public.%I', t);
    execute format('drop policy if exists "modif membres" on public.%I', t);
    execute format('drop policy if exists "suppression membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "modif membres" on public.%I for update using (public.can_write(workspace_id))', t);
    execute format('create policy "suppression membres" on public.%I for delete using (public.can_write(workspace_id))', t);
  end loop;
end $$;
-- Les surveillances se créent depuis le navigateur
create policy "ajout membres" on public.competitor_watches for insert with check (public.can_write(workspace_id));

-- ---------------------------------------------------------------------
-- Concepts : inspiration concurrente et tags IA
-- ---------------------------------------------------------------------
-- source : { type: 'competitor', ad_id, archive_id, page_name, url } | { type: 'recommendation', recommendation_id }
alter table public.creative_concepts add column if not exists source jsonb;
alter table public.creative_concepts add column if not exists ai_tags jsonb;
alter table public.creative_concepts add column if not exists ai_tags_hash text;
alter table public.creative_concepts add column if not exists ai_tagged_at timestamptz;

-- ---------------------------------------------------------------------
-- Notifications : type « creative » (on relit la contrainte actuelle)
-- ---------------------------------------------------------------------
do $$
declare def text; kinds text[];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if def is not null and def !~ '\mcreative\M' then
    select array_agg(m[1]) into kinds from regexp_matches(def, '''([a-z_]+)''', 'g') as m;
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || (select string_agg(quote_literal(k), ', ') from unnest(kinds || 'creative'::text) k) || ']))';
  end if;
end $$;

-- =====================================================================
-- Données de démo : 2 surveillances par client démo, 40 pubs fictives
-- (aperçu Meta indisponible : snapshot_url null), tags IA pré-remplis,
-- tags des concepts démo et une recommandation d'exemple (Kalia).
-- =====================================================================
create or replace function public._clear_demo_intel(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from creative_recommendations where workspace_id = ws and is_demo;
  delete from competitor_ads where workspace_id = ws and is_demo;
  delete from competitor_watches where workspace_id = ws and is_demo;
  update creative_concepts set ai_tags = null, ai_tags_hash = null, ai_tagged_at = null where workspace_id = ws and is_demo;
end $$;
revoke execute on function public._clear_demo_intel(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_intel(uuid) to service_role;

create or replace function public._demo_intel(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c_lumen uuid; c_kalia uuid; me uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid;
  n int := 0;
begin
  perform _clear_demo_intel(ws);
  select id into c_lumen from companies where workspace_id = ws and name = 'Maison Lumen' limit 1;
  select id into c_kalia from companies where workspace_id = ws and name = 'Kalia Cosmetics' limit 1;
  if c_lumen is null and c_kalia is null then return 0; end if;
  select user_id into me from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1;

  if c_lumen is not null then
    insert into competitor_watches (workspace_id, company_id, kind, page_id, page_name, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_lumen, 'page', '9990000000101', 'Atelier Lueur', '{FR}', false, now() - interval '5 hours', true, me, now() - interval '60 days')
    returning id into w1;
    insert into competitor_watches (workspace_id, company_id, kind, page_id, page_name, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_lumen, 'page', '9990000000102', 'Nordlys Maison', '{FR,BE}', false, now() - interval '5 hours', true, me, now() - interval '40 days')
    returning id into w2;
  end if;
  if c_kalia is not null then
    insert into competitor_watches (workspace_id, company_id, kind, page_id, page_name, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_kalia, 'page', '9990000000201', 'Belle Racine', '{FR}', false, now() - interval '5 hours', true, me, now() - interval '60 days')
    returning id into w3;
    insert into competitor_watches (workspace_id, company_id, kind, search_terms, countries, active_only, last_synced_at, is_demo, created_by, created_at)
    values (ws, c_kalia, 'keyword', 'sérum vitamine C', '{FR}', false, now() - interval '5 hours', true, me, now() - interval '40 days')
    returning id into w4;
  end if;

  insert into competitor_ads (workspace_id, watch_id, archive_id, page_id, page_name, bodies, titles, start_time, stop_time, snapshot_url,
                              platforms, languages, eu_reach, is_active, first_seen, last_seen, ai_tags, ai_tags_hash, ai_tagged_at, is_demo)
  select ws, w.id, 'demo-' || x.k, x.pid, x.page, array[x.body], array[x.title],
         now() - make_interval(days => x.start), case when x.stop is null then null else now() - make_interval(days => x.stop) end, null,
         x.plats, '{fr}', x.reach, x.stop is null,
         now() - make_interval(days => least(x.start, x.wage)),
         case when x.stop is null then now() - interval '5 hours' else now() - make_interval(days => x.stop) end,
         jsonb_build_object('angle', x.angle, 'hook_type', x.hook, 'hook', split_part(x.body, '. ', 1), 'awareness', x.aw, 'format', x.fmt,
           'promise', x.promise, 'proof', x.proof, 'offer', x.offer, 'cta', x.cta, 'persona', x.persona),
         'demo', now() - interval '5 hours', true
  from (values
    -- clé, surveillance, âge surveillance, page id, page, texte, titre, lancée (j), arrêtée (j), plateformes, portée UE, angle, type de hook, conscience, format, promesse, preuve, offre, CTA, persona
    ('a1', 1, 60, '9990000000101', 'Atelier Lueur', 'Chaque lampe Atelier Lueur est tournée à la main dans notre atelier de Bretagne. Du chêne massif, une lumière chaude, et 10 ans de garantie.', 'La lampe Céleste, en chêne massif', 74, null::int, '{facebook,instagram}'::text[], 420000::bigint, 'Artisanat et fait main', 'autorite', 'product', 'short_video', 'Une lampe faite pour durer', 'Fabrication artisanale, garantie 10 ans', '', 'Découvrir', 'Amateur de design durable'),
    ('a2', 1, 60, '9990000000101', 'Atelier Lueur', 'Chaque lampe Atelier Lueur est tournée à la main dans notre atelier de Bretagne. Du chêne massif, une lumière chaude, et 10 ans de garantie.', 'Céleste : le chêne qui éclaire', 58, null, '{facebook,instagram}', 310000, 'Artisanat et fait main', 'autorite', 'product', 'short_video', 'Une lampe faite pour durer', 'Fabrication artisanale, garantie 10 ans', '', 'Découvrir', 'Amateur de design durable'),
    ('a3', 1, 60, '9990000000101', 'Atelier Lueur', 'Chaque lampe Atelier Lueur est tournée à la main dans notre atelier de Bretagne. Du chêne massif, une lumière chaude, et 10 ans de garantie.', 'Tournée à la main en Bretagne', 41, null, '{instagram}', 150000, 'Artisanat et fait main', 'autorite', 'product', 'short_video', 'Une lampe faite pour durer', 'Fabrication artisanale, garantie 10 ans', '', 'Découvrir', 'Amateur de design durable'),
    ('a4', 1, 60, '9990000000101', 'Atelier Lueur', 'Ton salon est trop sombre le soir ? Une seule lampe d''appoint bien placée change toute l''ambiance. On t''explique où la mettre.', 'Le guide de la lumière du soir', 36, null, '{facebook,instagram}', 520000, 'Ambiance cocooning', 'question', 'problem', 'ugc', 'Un salon chaleureux avec une seule lampe', 'Démonstration en situation', '', 'En savoir plus', 'Propriétaire qui décore, 30-45 ans'),
    ('a5', 1, 60, '9990000000101', 'Atelier Lueur', 'Ton salon est trop sombre le soir ? Une seule lampe d''appoint bien placée change toute l''ambiance. On t''explique où la mettre.', '3 erreurs d''éclairage à éviter', 30, null, '{instagram}', 210000, 'Ambiance cocooning', 'question', 'problem', 'ugc', 'Un salon chaleureux avec une seule lampe', 'Démonstration en situation', '', 'En savoir plus', 'Propriétaire qui décore, 30-45 ans'),
    ('a6', 1, 60, '9990000000101', 'Atelier Lueur', '-25 % sur toute la collection Céleste jusqu''à dimanche. Livraison offerte dès 80 €.', 'Offre de rentrée', 12, 5, '{facebook,instagram}', 90000, 'Promotion', 'offre', 'most', 'static', '-25 % sur la collection', '', '-25 % et livraison offerte', 'Acheter', 'Cliente qui attend les promos'),
    ('a7', 1, 60, '9990000000101', 'Atelier Lueur', '« J''ai hésité 6 mois, je regrette de ne pas l''avoir prise avant. » Claire, cliente depuis 2024.', '4,8/5 sur 1 900 avis', 22, null, '{facebook,instagram}', 130000, 'Preuve sociale', 'temoignage', 'product', 'static', 'Un achat qu''on ne regrette pas', '1 900 avis, note 4,8/5', '', 'Acheter', 'Acheteuse qui hésite'),
    ('a8', 1, 60, '9990000000101', 'Atelier Lueur', 'Nouvelle collection : la suspension Brume, en lin lavé et laiton. Découvre-la en avant-première.', 'Nouveau : suspension Brume', 4, null, '{facebook,instagram}', null, 'Nouveauté produit', 'curiosite', 'product', 'carousel', 'Une suspension inédite', '', 'Avant-première', 'Découvrir', 'Cliente fidèle'),
    ('a9', 1, 60, '9990000000101', 'Atelier Lueur', 'Pourquoi nos abat-jour ne jaunissent jamais : le lin lavé traité sans produit chimique, expliqué en 30 secondes.', 'Le secret du lin lavé', 3, null, '{instagram}', null, 'Artisanat et fait main', 'curiosite', 'solution', 'short_video', 'Des abat-jour qui restent beaux', 'Explication du procédé', '', 'En savoir plus', 'Amateur de design durable'),
    ('a10', 1, 60, '9990000000101', 'Atelier Lueur', 'Idée cadeau : une lampe qu''on garde 20 ans. Emballage cadeau offert jusqu''au 24 décembre.', 'Le cadeau qui dure', 2, null, '{facebook,instagram}', null, 'Cadeau', 'promesse', 'unaware', 'static', 'Un cadeau durable', '', 'Emballage cadeau offert', 'Acheter', 'Acheteur cadeau, 30-55 ans'),
    ('b1', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Lampadaire Fjord, 89 €', 95, null, '{facebook,instagram,audience_network}', 890000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', 'Livraison 48 h', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b2', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Fjord : le best-seller à 89 €', 80, null, '{facebook,instagram}', 640000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', 'Best-seller', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b3', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Livré en 48 h, installé en 5 min', 63, null, '{instagram}', 350000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', 'Livraison 48 h', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b4', 2, 40, '9990000000102', 'Nordlys Maison', 'La lumière scandinave, sans le prix scandinave. Lampadaires dès 89 €, livrés en 48 h.', 'Design nordique dès 89 €', 47, null, '{facebook,instagram}', 280000, 'Prix accessible', 'contraste', 'solution', 'static', 'Le design nordique à petit prix', '', 'Dès 89 €', 'Acheter', 'Jeune locataire qui meuble son appartement'),
    ('b5', 2, 40, '9990000000102', 'Nordlys Maison', 'Avant / après : même salon, même soirée, trois points lumineux en plus.', 'Le salon transformé', 51, null, '{facebook,instagram}', 460000, 'Transformation avant/après', 'contraste', 'problem', 'short_video', 'Transformer une pièce sans travaux', 'Avant / après filmé', '', 'Découvrir', 'Propriétaire qui décore, 30-45 ans'),
    ('b6', 2, 40, '9990000000102', 'Nordlys Maison', 'Avant / après : même salon, même soirée, trois points lumineux en plus.', '3 points lumineux, tout change', 33, null, '{instagram}', 190000, 'Transformation avant/après', 'contraste', 'problem', 'short_video', 'Transformer une pièce sans travaux', 'Avant / après filmé', '', 'Découvrir', 'Propriétaire qui décore, 30-45 ans'),
    ('b7', 2, 40, '9990000000102', 'Nordlys Maison', 'Les ampoules à 2 700 K, c''est la règle d''or des décorateurs. Toutes nos lampes sont livrées avec.', 'La règle des 2 700 K', 27, 9, '{facebook,instagram}', 70000, 'Expertise déco', 'autorite', 'solution', 'carousel', 'Une lumière de décorateur', 'Conseil d''expert', 'Ampoule incluse', 'En savoir plus', 'Passionnée de déco'),
    ('b8', 2, 40, '9990000000102', 'Nordlys Maison', 'Notre designer te montre comment éclairer une pièce en 3 couches : ambiance, accent, lecture.', 'Éclairer en 3 couches', 19, null, '{facebook,instagram}', 110000, 'Expertise déco', 'chiffre', 'problem', 'ugc', 'Une pièce bien éclairée', 'Démonstration par un designer', '', 'En savoir plus', 'Passionnée de déco'),
    ('b9', 2, 40, '9990000000102', 'Nordlys Maison', 'Offre Black Friday en avance : -30 % sur les suspensions pour les inscrits.', 'Accès anticipé -30 %', 6, null, '{facebook,instagram}', null, 'Promotion', 'offre', 'most', 'static', '-30 % en avant-première', '', '-30 % pour les inscrits', 'S''inscrire', 'Cliente qui attend les promos'),
    ('b10', 2, 40, '9990000000102', 'Nordlys Maison', 'Tu passes 4 heures par soir sous un plafonnier ? Ton cerveau croit qu''il est midi.', 'Le plafonnier, ennemi du sommeil', 15, null, '{facebook,instagram,messenger}', 240000, 'Bien-être et sommeil', 'douleur', 'unaware', 'ugc', 'Mieux dormir grâce à la lumière du soir', 'Argument scientifique', '', 'En savoir plus', 'Actif stressé, 25-40 ans'),
    ('c1', 3, 60, '9990000000201', 'Belle Racine', 'Ma peau tiraillait tous les soirs. Depuis 3 semaines avec l''huile Racine, plus rien. Je vous montre ma routine en entier.', 'La routine de Léa, 34 ans', 88, null, '{facebook,instagram}', 1250000, 'Témoignage transformation', 'temoignage', 'problem', 'ugc', 'Une peau confortable en 3 semaines', 'Témoignage cliente filmé', '', 'Acheter', 'Peau sèche, 30-45 ans'),
    ('c2', 3, 60, '9990000000201', 'Belle Racine', 'Ma peau tiraillait tous les soirs. Depuis 3 semaines avec l''huile Racine, plus rien. Je vous montre ma routine en entier.', '3 semaines, plus de tiraillements', 70, null, '{facebook,instagram}', 780000, 'Témoignage transformation', 'temoignage', 'problem', 'ugc', 'Une peau confortable en 3 semaines', 'Témoignage cliente filmé', '', 'Acheter', 'Peau sèche, 30-45 ans'),
    ('c3', 3, 60, '9990000000201', 'Belle Racine', 'Ma peau tiraillait tous les soirs. Depuis 3 semaines avec l''huile Racine, plus rien. Je vous montre ma routine en entier.', 'L''huile qui a sauvé ma peau sèche', 52, null, '{instagram}', 420000, 'Témoignage transformation', 'temoignage', 'problem', 'ugc', 'Une peau confortable en 3 semaines', 'Témoignage cliente filmé', '', 'Acheter', 'Peau sèche, 30-45 ans'),
    ('c4', 3, 60, '9990000000201', 'Belle Racine', 'Une dermatologue lit la liste INCI de ta crème de nuit. Spoiler : 9 ingrédients sur 32 servent vraiment.', 'La dermato décrypte ta crème', 44, null, '{facebook,instagram}', 670000, 'Expertise et transparence', 'autorite', 'solution', 'short_video', 'Payer seulement pour ce qui agit', 'Avis de dermatologue', '', 'En savoir plus', 'Consommatrice clean beauty'),
    ('c5', 3, 60, '9990000000201', 'Belle Racine', 'Une dermatologue lit la liste INCI de ta crème de nuit. Spoiler : 9 ingrédients sur 32 servent vraiment.', '9 ingrédients utiles sur 32', 31, null, '{instagram}', 210000, 'Expertise et transparence', 'autorite', 'solution', 'short_video', 'Payer seulement pour ce qui agit', 'Avis de dermatologue', '', 'En savoir plus', 'Consommatrice clean beauty'),
    ('c6', 3, 60, '9990000000201', 'Belle Racine', '5 ingrédients, 0 compromis. Notre sérum tient sur une étiquette de 3 lignes.', 'Le sérum le plus court de France', 25, 10, '{facebook,instagram}', 150000, 'Formule courte', 'chiffre', 'product', 'static', 'Une formule sans superflu', 'Liste INCI de 5 ingrédients', '', 'Acheter', 'Consommatrice clean beauty'),
    ('c7', 3, 60, '9990000000201', 'Belle Racine', 'Pourquoi ton sérum vitamine C devient orange (et pourquoi il ne sert plus à rien).', 'Ton sérum est-il oxydé ?', 17, null, '{facebook,instagram}', 330000, 'Éducation ingrédients', 'curiosite', 'problem', 'short_video', 'Un sérum qui reste actif', 'Explication chimique simple', '', 'En savoir plus', 'Peau terne, 30-45 ans'),
    ('c8', 3, 60, '9990000000201', 'Belle Racine', 'Coffret routine complète à -20 % pour ta première commande. Satisfaite ou remboursée 30 jours.', 'Coffret découverte -20 %', 9, null, '{facebook,instagram}', 95000, 'Offre découverte', 'offre', 'most', 'carousel', 'Tester sans risque', 'Satisfaite ou remboursée', '-20 % sur la première commande', 'Acheter', 'Nouvelle cliente'),
    ('c9', 3, 60, '9990000000201', 'Belle Racine', 'Nouvelle crème de nuit au bakuchiol : l''alternative douce au rétinol, testée sur 60 peaux sensibles.', 'Le rétinol sans irritation', 5, null, '{facebook,instagram}', null, 'Alternative douce', 'contraste', 'solution', 'ugc', 'Les effets du rétinol sans irritation', 'Test sur 60 peaux sensibles', '', 'Découvrir', 'Peau sensible, 35-50 ans'),
    ('c10', 3, 60, '9990000000201', 'Belle Racine', 'J''ai testé 12 crèmes de nuit en 2 ans. Voici la seule que je rachète.', '12 crèmes testées, 1 gagnante', 1, null, '{instagram}', null, 'Témoignage transformation', 'chiffre', 'solution', 'ugc', 'La crème de nuit qu''on rachète', 'Comparaison vécue', '', 'Acheter', 'Débutante skincare'),
    ('d1', 4, 40, '9990000000301', 'Oléa Paris', 'Teint terne en hiver ? 7 gouttes de notre sérum vitamine C chaque matin, et ton teint retrouve son éclat en 14 jours.', 'L''éclat en 14 jours', 66, null, '{facebook,instagram}', 980000, 'Résultats visibles', 'question', 'problem', 'ugc', 'Un teint éclatant en 14 jours', 'Délai chiffré', '', 'Acheter', 'Peau terne, 30-45 ans'),
    ('d2', 4, 40, '9990000000301', 'Oléa Paris', 'Teint terne en hiver ? 7 gouttes de notre sérum vitamine C chaque matin, et ton teint retrouve son éclat en 14 jours.', 'Sérum Éclat : 7 gouttes suffisent', 49, null, '{facebook,instagram}', 510000, 'Résultats visibles', 'question', 'problem', 'ugc', 'Un teint éclatant en 14 jours', 'Délai chiffré', '', 'Acheter', 'Peau terne, 30-45 ans'),
    ('d3', 4, 40, '9990000000301', 'Oléa Paris', 'Teint terne en hiver ? 7 gouttes de notre sérum vitamine C chaque matin, et ton teint retrouve son éclat en 14 jours.', 'Vitamine C stabilisée à 15 %', 34, null, '{instagram}', 260000, 'Résultats visibles', 'question', 'problem', 'ugc', 'Un teint éclatant en 14 jours', 'Concentration affichée', '', 'Acheter', 'Peau terne, 30-45 ans'),
    ('d4', 4, 40, '9990000000301', 'Oléa Paris', '« Mes taches brunes ont pâli en 6 semaines. » 4 200 avis, 4,7/5.', '4,7/5 sur 4 200 avis', 40, null, '{facebook,instagram}', 400000, 'Preuve sociale', 'temoignage', 'product', 'static', 'Des taches atténuées', '4 200 avis, note 4,7/5', '', 'Acheter', 'Peau à taches, 40-55 ans'),
    ('d5', 4, 40, '9990000000302', 'Maison Verdure', 'Vitamine C, niacinamide ou acide hyaluronique : lequel choisir selon ta peau ? Le guide en 20 secondes.', 'Quel sérum pour ta peau ?', 29, null, '{facebook,instagram}', 190000, 'Éducation ingrédients', 'question', 'solution', 'short_video', 'Choisir le bon sérum', 'Guide pédagogique', '', 'En savoir plus', 'Débutante skincare'),
    ('d6', 4, 40, '9990000000302', 'Maison Verdure', 'Sérum vitamine C bio, fabriqué dans la Drôme. 29 € au lieu de 39 € cette semaine.', '-25 % sur le sérum bio', 11, 4, '{facebook,instagram}', 60000, 'Promotion', 'offre', 'most', 'static', 'Un sérum bio à prix réduit', 'Fabrication française', '29 € au lieu de 39 €', 'Acheter', 'Consommatrice bio'),
    ('d7', 4, 40, '9990000000302', 'Maison Verdure', 'Pas de vitamine C pure sur peau sensible : voici la forme qui ne pique pas.', 'La vitamine C qui ne pique pas', 20, null, '{instagram}', 150000, 'Alternative douce', 'contraste', 'solution', 'ugc', 'La vitamine C sans picotements', 'Forme dérivée expliquée', '', 'Découvrir', 'Peau sensible, 35-50 ans'),
    ('d8', 4, 40, '9990000000201', 'Belle Racine', 'Notre sérum vitamine C arrive. 1 000 flacons pour le lancement, liste d''attente ouverte.', 'Lancement sérum vitamine C', 6, null, '{facebook,instagram}', null, 'Nouveauté produit', 'curiosite', 'product', 'static', 'Être parmi les premières', 'Série limitée', 'Liste d''attente', 'S''inscrire', 'Cliente fidèle'),
    ('d9', 4, 40, '9990000000301', 'Oléa Paris', 'POV : tu arrêtes le fond de teint parce que ta peau n''en a plus besoin.', 'Plus besoin de fond de teint', 4, null, '{instagram}', null, 'Transformation avant/après', 'curiosite', 'unaware', 'ugc', 'Une peau nette sans maquillage', '', '', 'Découvrir', 'Active 25-35 ans'),
    ('d10', 4, 40, '9990000000302', 'Maison Verdure', 'Dermatologue : « la vitamine C le matin, le rétinol le soir, jamais l''inverse. »', 'L''ordre qui change tout', 13, null, '{facebook,instagram}', 120000, 'Expertise et transparence', 'autorite', 'solution', 'short_video', 'Une routine qui fonctionne', 'Avis de dermatologue', '', 'En savoir plus', 'Débutante skincare')
  ) as x(k, wn, wage, pid, page, body, title, start, stop, plats, reach, angle, hook, aw, fmt, promise, proof, offer, cta, persona)
  join (values (1, w1), (2, w2), (3, w3), (4, w4)) as w(n, id) on w.n = x.wn
  where w.id is not null;
  get diagnostics n = row_count;

  -- Tags IA des concepts démo (déduits de leurs champs)
  update creative_concepts c set
    ai_tags = jsonb_build_object(
      'angle', c.angle,
      'hook_type', case when c.hook like '%?%' then 'question'
                        when c.hook ~ '^(J''|Je |Mon |Ma |Mes )' then 'temoignage'
                        when c.hook ~* '(erreur|tiraille|sombre|attente)' then 'douleur'
                        when c.hook ~ '[0-9]' then 'chiffre'
                        when c.hook ~* '(POV|lis |secret)' then 'curiosite'
                        else 'promesse' end,
      'hook', c.hook, 'awareness', c.awareness, 'format', c.format,
      'promise', '', 'proof', '', 'offer', '', 'cta', coalesce(c.brief->>'cta', ''), 'persona', c.persona),
    ai_tags_hash = 'demo', ai_tagged_at = now()
  where c.workspace_id = ws and c.is_demo;

  -- Recommandation d'exemple (Kalia)
  if c_kalia is not null then
    insert into creative_recommendations (workspace_id, company_id, model, output, stats, is_demo, created_by, created_at)
    values (ws, c_kalia, 'exemple', $j${
      "summary": "Tes gagnants reposent sur la preuve visible (avant / après, routine) au niveau « conscient du produit » et « de la solution ». Les concurrents scalent surtout le témoignage « peau qui tiraille » et le décryptage par une dermatologue, deux terrains où tu n'as aucune créa en ligne. Ton angle ingrédients a échoué en motion design : il mérite une seconde chance en face caméra.",
      "opportunities": [
        {
          "title": "Le témoignage « peau qui tiraille » en routine complète",
          "kind": "scale",
          "why": "Belle Racine fait tourner le même témoignage depuis 88 jours en 3 variantes (portée UE cumulée de 2,45 M) : c'est leur créa la plus durable. Chez toi, le hook « Si ta peau tiraille après la douche » atteint 44 % de hook rate, le meilleur du compte, mais n'existe qu'en une seule annonce. Ton UGC témoignage Inès s'essouffle (CTR -35 % vs son pic) : il faut une relève sur le même registre.",
          "evidence": [{"label": "Hook rate du hook « peau qui tiraille »", "value": "44 %"}, {"label": "Longévité du témoignage Belle Racine", "value": "88 jours, 3 variantes"}, {"label": "Témoignage Inès", "value": "Fatigue, CTR -35 %"}],
          "competitor_ads": ["demo-c1", "demo-c2"],
          "brief": {
            "concept_title": "Ma routine du soir quand ma peau tiraille",
            "angle": "Témoignage transformation",
            "hooks": ["Ma peau tiraillait tous les soirs, jusqu'à ce que je change ça", "Si ta peau tiraille après la douche, regarde ma routine en entier", "3 semaines sans tiraillements : je te montre tout"],
            "script": "0-3 s : hook face caméra, visage sans maquillage.\n3-10 s : le problème vécu (tiraillements, crème qui ne suffit plus).\n10-25 s : la routine en 3 gestes, gros plans sur la texture.\n25-35 s : le résultat à 3 semaines, même lumière.\n35-40 s : -15 % sur la première commande.",
            "shots": ["Face caméra dans la salle de bain, lumière de fenêtre", "Gros plan texture sur le dos de la main", "Application sur le visage, plan serré", "Plan résultat, même cadrage qu'au début"],
            "format": "ugc",
            "awareness": "problem",
            "persona": "Peau sèche, 30-45 ans",
            "cta": "Teste la routine avec -15 % sur ta première commande"
          }
        },
        {
          "title": "Une dermatologue décrypte la crème de nuit",
          "kind": "counter",
          "why": "Deux concurrents scalent l'angle expertise : Belle Racine (44 jours, 2 variantes, 670 k de portée) et Maison Verdure (« la vitamine C le matin, le rétinol le soir »). Ton concept « Une dermato répond aux commentaires » est en production depuis des semaines : c'est le moment de le sortir, avec un hook chiffré plus fort que la simple présence d'une experte.",
          "evidence": [{"label": "Longévité Belle Racine (dermato)", "value": "44 jours, 2 variantes"}, {"label": "Ton concept dermato", "value": "En production"}],
          "competitor_ads": ["demo-c4", "demo-d10"],
          "brief": {
            "concept_title": "La dermato lit ta liste d'ingrédients",
            "angle": "Expertise et transparence",
            "hooks": ["Une dermato lit la liste d'ingrédients de ta crème (et elle n'est pas d'accord)", "Sur 30 ingrédients, combien servent vraiment ?", "Ce que ta dermato ne mettrait jamais sur son visage"],
            "script": "0-3 s : la dermatologue tient un pot de crème du commerce, hook.\n3-15 s : elle surligne les ingrédients inutiles.\n15-30 s : elle compare avec la formule Kalia en 5 ingrédients.\n30-40 s : sa recommandation, sans promesse médicale.",
            "shots": ["Plan poitrine de la dermatologue, blouse, fond neutre", "Gros plan sur l'étiquette surlignée", "Comparaison des deux étiquettes côte à côte", "Produit Kalia en main"],
            "format": "short_video",
            "awareness": "solution",
            "persona": "Consommatrice clean beauty",
            "cta": "Découvre la formule en 5 ingrédients"
          }
        },
        {
          "title": "Refaire l'angle ingrédients en face caméra",
          "kind": "gap",
          "why": "Ton motion « 5 ingrédients, rien d'autre » a été coupé avec 19 % de hook rate : c'est le format, pas forcément l'angle. Belle Racine obtient 17 jours et 330 k de portée avec « Pourquoi ton sérum vitamine C devient orange », un hook de curiosité au niveau « conscient du problème ». Tu n'as aucun concept de curiosité en ligne.",
          "evidence": [{"label": "Hook rate du motion ingrédients", "value": "19 %"}, {"label": "Concepts « curiosité » en ligne", "value": "0"}],
          "competitor_ads": ["demo-c7", "demo-d5"],
          "brief": {
            "concept_title": "Pourquoi ta crème ne marche plus",
            "angle": "Éducation ingrédients",
            "hooks": ["Pourquoi ta crème de nuit ne fait plus effet au bout d'un mois", "Retourne ton pot de crème : si tu vois ça, jette-le", "L'ingrédient que tu paies le plus cher et qui ne sert à rien"],
            "script": "0-3 s : hook avec le produit retourné vers la caméra.\n3-15 s : l'explication simple (oxydation, dosage, ordre des ingrédients).\n15-30 s : ce qu'il faut regarder sur une étiquette.\n30-40 s : la formule courte Kalia comme exemple.",
            "shots": ["Face caméra, cuisine ou salle de bain", "Gros plan étiquette", "Comparaison de deux textures", "Produit Kalia posé"],
            "format": "ugc",
            "awareness": "problem",
            "persona": "Consommatrice clean beauty",
            "cta": "Lis notre liste d'ingrédients"
          }
        },
        {
          "title": "Décliner ton avant / après avec un délai chiffré",
          "kind": "scale",
          "why": "Ton avant / après Sérum Éclat est la meilleure créa du compte (ROAS 40 % au-dessus de la moyenne, hook rate au-dessus de 40 %) mais repose sur une seule annonce. Oléa Paris scale la même promesse avec un délai chiffré (« l'éclat en 14 jours ») depuis 66 jours, en 3 variantes et 980 k de portée.",
          "evidence": [{"label": "ROAS avant / après vs moyenne", "value": "+40 %"}, {"label": "Longévité Oléa Paris", "value": "66 jours, 3 variantes"}],
          "competitor_ads": ["demo-d1", "demo-d2", "demo-d3"],
          "brief": {
            "concept_title": "J1, J14, J28 : même lumière, zéro filtre",
            "angle": "Résultats visibles",
            "hooks": ["J14 : même lumière, même téléphone, zéro filtre", "7 gouttes chaque matin pendant 28 jours, voici mon teint", "Le jour où j'ai arrêté l'anticernes"],
            "script": "0-3 s : split screen J1 / J28.\n3-15 s : le geste du matin, 7 gouttes.\n15-30 s : J1, J14, J28 au même endroit et à la même heure.\n30-40 s : appel à l'action.",
            "shots": ["Même cadrage face fenêtre à J1, J14, J28", "Gros plan pipette", "Split screen final"],
            "format": "ugc",
            "awareness": "product",
            "persona": "Peau terne, 30-45 ans",
            "cta": "Teste le Sérum Éclat avec -15 %"
          }
        }
      ]
    }$j$::jsonb,
    '{"exemple": true}'::jsonb, true, me, now() - interval '2 days');
  end if;
  return n;
end $$;
revoke execute on function public._demo_intel(uuid) from anon, authenticated, public;
grant execute on function public._demo_intel(uuid) to service_role;

create or replace function public.load_demo_intel(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_intel(ws);
end $$;
revoke execute on function public.load_demo_intel(uuid) from anon, public;
grant execute on function public.load_demo_intel(uuid) to authenticated;

create or replace function public.clear_demo_intel(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_intel(ws);
end $$;
revoke execute on function public.clear_demo_intel(uuid) from anon, public;
grant execute on function public.clear_demo_intel(uuid) to authenticated;

-- =====================================================================
-- 0090_client_portal.sql
-- =====================================================================
-- =====================================================================
-- Portail client : socle de sécurité
--
-- Principe : un utilisateur client N'EST PAS membre de l'espace. Il vit dans
-- `client_users`, rattaché à UNE entreprise. Toutes les policies existantes
-- reposent sur is_member() : un client ne voit donc aucune table en direct,
-- y compris les tables ajoutées plus tard (refus par défaut).
-- Le portail lit et écrit uniquement par des fonctions `portal_*`
-- (security definer) qui vérifient portal_can(entreprise, fonctionnalité)
-- et ne renvoient que les colonnes destinées au client.
-- =====================================================================

-- Fonctionnalités ouvrables à un client
create or replace function public.portal_all_features()
returns text[] language sql immutable as $$
  select array['reporting','tasks','creatives','files','documents','onboarding','booking']::text[];
$$;

-- Réglages du portail d'une entreprise cliente
create table public.client_portals (
  company_id uuid primary key references public.companies(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  features text[] not null default public.portal_all_features()
    check (features <@ public.portal_all_features()),
  welcome text not null default '',
  updated_at timestamptz not null default now()
);

-- Personnes du client ayant un accès
create table public.client_users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- null = toutes les fonctionnalités ouvertes au niveau de l'entreprise ; sinon sous-ensemble
  features text[] check (features is null or features <@ public.portal_all_features()),
  contact_id uuid references public.contacts(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (company_id, user_id)
);
create index on public.client_users (user_id);
create index on public.client_users (workspace_id);
alter table public.client_users
  add constraint client_users_profile_fk foreign key (user_id) references public.profiles(id) on delete cascade;

create table public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  features text[] check (features is null or features <@ public.portal_all_features()),
  contact_id uuid references public.contacts(id) on delete set null,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

alter table public.client_portals enable row level security;
alter table public.client_users enable row level security;
alter table public.client_invitations enable row level security;

-- Côté agence : lecture par les membres, gestion par les non-invités
create policy "lecture membres" on public.client_portals for select using (public.is_member(workspace_id));
create policy "gestion membres" on public.client_portals for all
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));

create policy "lecture membres" on public.client_users for select using (public.is_member(workspace_id));
create policy "gestion membres" on public.client_users for update using (public.can_write(workspace_id));
create policy "retrait membres" on public.client_users for delete using (public.can_write(workspace_id));
-- Un client voit sa propre ligne (jamais celles des autres) ; il ne peut ni l'insérer ni la modifier :
-- l'insertion passe par accept_client_invitation.
create policy "ma ligne" on public.client_users for select using (user_id = auth.uid());

create policy "gestion membres" on public.client_invitations for all
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));

-- Les membres voient le profil (nom, couleur) des clients de leur espace, pour afficher leurs commentaires
drop policy "profil lisible" on public.profiles;
create policy "profil lisible" on public.profiles for select using (
  id = auth.uid()
  or public.shares_workspace(id)
  or exists (select 1 from public.client_users cu where cu.user_id = profiles.id and public.is_member(cu.workspace_id))
);

-- ---------------------------------------------------------------------
-- Ce que l'agence choisit de montrer
-- ---------------------------------------------------------------------
-- Projet : none = rien, selected = seulement les tâches cochées, all = toutes les tâches
alter table public.projects add column if not exists portal_mode text not null default 'selected'
  check (portal_mode in ('none','selected','all'));
alter table public.tasks add column if not exists client_visible boolean not null default false;
-- Commentaire interne (défaut) ou partagé avec le client
alter table public.comments add column if not exists visibility text not null default 'internal'
  check (visibility in ('internal','client'));
alter table public.attachments add column if not exists client_visible boolean not null default false;
-- Validation d'une créa par le client : null = non soumise
alter table public.creative_concepts add column if not exists client_review text
  check (client_review is null or client_review in ('pending','approved','changes'));
alter table public.creative_concepts add column if not exists client_feedback text not null default '';
alter table public.creative_concepts add column if not exists client_reviewed_at timestamptz;
alter table public.creative_concepts add column if not exists client_reviewed_by uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------
-- Contrôle d'accès : LA fonction que toute RPC portal_* doit appeler
-- ---------------------------------------------------------------------
-- Fonctionnalités effectives de l'utilisateur courant sur une entreprise.
--  - client : celles de sa ligne (ou toutes) croisées avec celles du portail, si le portail est activé ;
--  - membre de l'espace : celles du portail (aperçu « voir comme le client »), même portail désactivé ;
--  - sinon : tableau vide.
create or replace function public.portal_features(p_company uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  ws uuid; cp client_portals; cu client_users; uid uuid := auth.uid();
begin
  if uid is null or p_company is null then return '{}'; end if;
  select workspace_id into ws from companies where id = p_company;
  if ws is null then return '{}'; end if;
  select * into cp from client_portals where company_id = p_company;

  if exists (select 1 from workspace_members m where m.workspace_id = ws and m.user_id = uid) then
    return coalesce(cp.features, portal_all_features());
  end if;

  if cp.company_id is null or not cp.enabled then return '{}'; end if;
  select * into cu from client_users where company_id = p_company and user_id = uid;
  if cu.id is null then return '{}'; end if;
  return array(select unnest(coalesce(cu.features, cp.features)) intersect select unnest(cp.features));
end $$;

create or replace function public.portal_can(p_company uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_feature = any(public.portal_features(p_company));
$$;

-- L'utilisateur courant est-il un membre de l'espace en train de prévisualiser (et non un client) ?
create or replace function public.portal_is_preview(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies c join workspace_members m on m.workspace_id = c.workspace_id
    where c.id = p_company and m.user_id = auth.uid()
  );
$$;

-- Lève une erreur si l'accès est refusé (à appeler en tête de chaque RPC portal_*)
create or replace function public.portal_require(p_company uuid, p_feature text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.portal_can(p_company, p_feature) then
    raise exception 'accès refusé' using errcode = '42501';
  end if;
end $$;

-- Une tâche est-elle visible par le client de cette entreprise ?
create or replace function public.portal_task_visible(p_task uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t join projects p on p.id = t.project_id
    where t.id = p_task and p.company_id = p_company and p.archived_at is null and t.archived_at is null
      and (p.portal_mode = 'all' or (p.portal_mode = 'selected' and t.client_visible))
  );
$$;

-- Portails accessibles à l'utilisateur courant (page d'entrée du portail)
create or replace function public.portal_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', c.id, 'company', c.name, 'color', c.color,
    'workspace_id', w.id, 'workspace', w.name, 'slug', w.slug, 'accent', w.accent, 'currency', w.currency,
    'welcome', cp.welcome,
    'features', array(select unnest(coalesce(cu.features, cp.features)) intersect select unnest(cp.features))
  ) order by w.name, c.name), '[]'::jsonb)
  from client_users cu
  join client_portals cp on cp.company_id = cu.company_id and cp.enabled
  join companies c on c.id = cu.company_id
  join workspaces w on w.id = cu.workspace_id
  where cu.user_id = auth.uid();
$$;

-- Acceptation d'une invitation client : l'email du compte doit être celui de l'invitation
create or replace function public.accept_client_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv client_invitations; mail text; slug text;
begin
  if auth.uid() is null then raise exception 'non authentifié'; end if;
  select * into inv from client_invitations where token = p_token;
  if inv.id is null or inv.revoked_at is not null then raise exception 'invitation invalide'; end if;
  select email into mail from auth.users where id = auth.uid();
  if lower(mail) <> lower(inv.email) then
    raise exception 'cette invitation est destinée à %', inv.email using errcode = '42501';
  end if;
  insert into client_users (workspace_id, company_id, user_id, features, contact_id, invited_by)
  values (inv.workspace_id, inv.company_id, auth.uid(), inv.features, inv.contact_id, inv.invited_by)
  on conflict (company_id, user_id) do update set features = excluded.features;
  update client_invitations set accepted_at = coalesce(accepted_at, now()) where id = inv.id;
  select w.slug into slug from workspaces w where w.id = inv.workspace_id;
  return jsonb_build_object('slug', slug, 'company_id', inv.company_id);
end $$;

-- Infos minimales d'une invitation pour la page d'accueil du lien (avant connexion) : nom de l'agence et email attendu
create or replace function public.client_invitation_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', i.email, 'workspace', w.name, 'accent', w.accent, 'company', c.name,
                            'valid', i.revoked_at is null)
  from client_invitations i join workspaces w on w.id = i.workspace_id join companies c on c.id = i.company_id
  where i.token = p_token;
$$;

create or replace function public.portal_touch(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update client_users set last_seen_at = now() where company_id = p_company and user_id = auth.uid();
$$;

revoke execute on function public.portal_features(uuid), public.portal_can(uuid, text), public.portal_is_preview(uuid),
  public.portal_require(uuid, text), public.portal_task_visible(uuid, uuid), public.portal_me(),
  public.accept_client_invitation(text), public.portal_touch(uuid) from anon, public;
grant execute on function public.portal_features(uuid), public.portal_can(uuid, text), public.portal_is_preview(uuid),
  public.portal_require(uuid, text), public.portal_task_visible(uuid, uuid), public.portal_me(),
  public.accept_client_invitation(text), public.portal_touch(uuid) to authenticated;
grant execute on function public.client_invitation_info(text) to anon, authenticated;

-- =====================================================================
-- 0091_portal_rpc.sql
-- =====================================================================
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

-- =====================================================================
-- 0092_portal_agency.sql
-- =====================================================================
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

-- =====================================================================
-- 0095_analytics.sql
-- =====================================================================
-- =====================================================================
-- 0095 : analytics de site dans le reporting (Google Analytics 4, Microsoft Clarity)
-- Migration additive : nouvelles tables, une colonne sur reports, fonctions de lecture.
--  - ad_connections accepte la plateforme « ga4 » (même client OAuth Google que
--    Google Ads, scope analytics.readonly) : les jetons restent sans policy client ;
--  - analytics_sources : propriété GA4 ou projet Clarity associé à un client ;
--  - analytics_secrets : jeton API Clarity, sans policy (service role uniquement) ;
--  - ga4_channels_daily, ga4_pages_daily, ga4_dims_daily : métriques GA4 par jour ;
--  - clarity_daily : instantané quotidien Clarity (l'API ne donne aucun historique) ;
--  - reports.sections : sections facultatives d'un rapport (« site », « behavior ») ;
--  - _site_analytics : agrégats d'un client sur une période, partagés par le tableau
--    de bord (site_analytics), le rapport public (public_report), le portail client
--    (portal_site_analytics, portal_report) et le serveur MCP.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Connexions : une connexion Google Analytics est une ligne ad_connections
-- (platform = 'ga4'), listée par la vue ad_connections_public comme les autres.
-- Le cache ad_connections.accounts contient alors les propriétés accessibles.
-- ---------------------------------------------------------------------
alter table public.ad_connections drop constraint if exists ad_connections_platform_check;
alter table public.ad_connections add constraint ad_connections_platform_check
  check (platform in ('meta','google','ga4'));

-- ---------------------------------------------------------------------
-- Sources d'analytics d'un client (une ou plusieurs par client et par outil)
--  ga4     : external_id = identifiant numérique de la propriété, connection_id = connexion Google
--  clarity : external_id = identifiant du projet Clarity (liens vers le tableau de bord)
--  settings : { key_event: nom de l'évènement clé retenu comme conversion (GA4, null = tous),
--               token_exp: expiration du jeton Clarity (lue dans le jeton, non secrète) }
-- ---------------------------------------------------------------------
create table if not exists public.analytics_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  kind text not null check (kind in ('ga4','clarity')),
  connection_id uuid references public.ad_connections(id) on delete set null,
  external_id text not null,
  name text not null default '',
  currency text,
  timezone text,
  settings jsonb not null default '{}'::jsonb,
  first_synced_at timestamptz,
  last_synced_at timestamptz,
  sync_error text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, external_id)
);
create index if not exists analytics_sources_company on public.analytics_sources (company_id, kind);

-- Jeton API Clarity : jamais lisible par le navigateur (RLS sans policy + droits retirés)
create table if not exists public.analytics_secrets (
  source_id uuid primary key references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- GA4 : métriques quotidiennes (écrites par la synchro, service role)
-- ---------------------------------------------------------------------
-- Jour × groupe de canaux × source / medium (principales sources, le reste regroupé en « (autres) »)
create table if not exists public.ga4_channels_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  channel text not null default '',
  source text not null default '',
  medium text not null default '',
  sessions bigint not null default 0,
  users bigint not null default 0,
  new_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_seconds bigint not null default 0,
  key_events numeric(14,2) not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  primary key (source_id, date, channel, source, medium)
);

-- Jour × page de destination (principales pages, le reste en « (autres) »)
create table if not exists public.ga4_pages_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  page text not null,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  key_events numeric(14,2) not null default 0,
  primary key (source_id, date, page)
);

-- Jour × dimension simple : total (value = ''), device, country
create table if not exists public.ga4_dims_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  dim text not null check (dim in ('total','device','country')),
  value text not null default '',
  sessions bigint not null default 0,
  users bigint not null default 0,
  new_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_seconds bigint not null default 0,
  key_events numeric(14,2) not null default 0,
  purchases numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  pageviews bigint not null default 0,
  primary key (source_id, date, dim, value)
);

-- ---------------------------------------------------------------------
-- Clarity : un instantané par jour.
--  scope = 'page'    : key = URL (sans paramètres), device = appareil
--  scope = 'device'  : key = appareil (totaux exacts par appareil)
--  scope = 'channel' : key = canal d'acquisition
--  *_sessions : sessions concernées par le signal (sessions × pourcentage Clarity) ;
--  les compteurs sans suffixe sont le nombre d'occurrences.
--  window_days > 1 : jour reconstitué à partir d'un agrégat de 2 ou 3 jours (synchro manquée).
-- ---------------------------------------------------------------------
create table if not exists public.clarity_daily (
  source_id uuid not null references public.analytics_sources(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  scope text not null check (scope in ('page','device','channel')),
  key text not null default '',
  device text not null default '',
  sessions numeric(14,2) not null default 0,
  bot_sessions numeric(14,2) not null default 0,
  users numeric(14,2) not null default 0,
  pages_per_session numeric(10,2),
  scroll_depth numeric(6,2),
  total_time numeric(10,2),
  active_time numeric(10,2),
  dead_clicks numeric(14,2) not null default 0,
  dead_sessions numeric(14,2) not null default 0,
  rage_clicks numeric(14,2) not null default 0,
  rage_sessions numeric(14,2) not null default 0,
  quickbacks numeric(14,2) not null default 0,
  quickback_sessions numeric(14,2) not null default 0,
  excessive_scrolls numeric(14,2) not null default 0,
  excessive_sessions numeric(14,2) not null default 0,
  script_errors numeric(14,2) not null default 0,
  script_error_sessions numeric(14,2) not null default 0,
  error_clicks numeric(14,2) not null default 0,
  error_click_sessions numeric(14,2) not null default 0,
  window_days smallint not null default 1,
  primary key (source_id, date, scope, key, device)
);

create index if not exists ga4_channels_daily_ws on public.ga4_channels_daily (workspace_id, date);
create index if not exists ga4_dims_daily_ws on public.ga4_dims_daily (workspace_id, date);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.analytics_sources enable row level security;
alter table public.analytics_secrets enable row level security;
alter table public.ga4_channels_daily enable row level security;
alter table public.ga4_pages_daily enable row level security;
alter table public.ga4_dims_daily enable row level security;
alter table public.clarity_daily enable row level security;

-- Jetons : aucune policy, et aucun droit de table pour les rôles du navigateur
revoke all on public.analytics_secrets from anon, authenticated;

drop policy if exists "lecture membres" on public.analytics_sources;
drop policy if exists "ajout membres" on public.analytics_sources;
drop policy if exists "modif membres" on public.analytics_sources;
drop policy if exists "suppression membres" on public.analytics_sources;
create policy "lecture membres" on public.analytics_sources for select using (public.is_member(workspace_id));
-- Une propriété GA4 se suit depuis le navigateur (comme un compte publicitaire). Un projet Clarity
-- ne se crée que par la route serveur, qui range son jeton dans analytics_secrets.
create policy "ajout membres" on public.analytics_sources for insert
  with check (public.can_write(workspace_id) and kind = 'ga4' and not is_demo);
create policy "modif membres" on public.analytics_sources for update
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "suppression membres" on public.analytics_sources for delete using (public.can_write(workspace_id));

do $$
declare t text;
begin
  foreach t in array array['ga4_channels_daily','ga4_pages_daily','ga4_dims_daily','clarity_daily'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select using (public.is_member(workspace_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Rapports : sections facultatives (« site » = trafic du site, « behavior » = comportement)
-- ---------------------------------------------------------------------
alter table public.reports add column if not exists sections text[] not null default '{}';

-- ---------------------------------------------------------------------
-- Agrégats d'un client sur une période (fonction interne, sans contrôle d'accès :
-- jamais exécutable par anon ni authenticated, seulement par les fonctions ci-dessous
-- et par le service role).
--  p_prev_start / p_prev_end : période de comparaison (par défaut, même durée juste avant)
--  p_client : true = version destinée au client final (ni identifiant externe, ni erreur de synchro,
--             ni tracking first-party)
--  p_parts  : parties à calculer ('ga4', 'clarity')
-- ---------------------------------------------------------------------
create or replace function public._site_analytics(
  p_company uuid, p_start date, p_end date,
  p_prev_start date default null, p_prev_end date default null,
  p_client boolean default false, p_parts text[] default array['ga4','clarity']
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ps date; v_pe date;
  g_ids uuid[]; c_ids uuid[];
  ga jsonb := null; cl jsonb := null; fp jsonb := null;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'période invalide' using errcode = '22023';
  end if;
  v_ps := coalesce(p_prev_start, p_start - (p_end - p_start) - 1);
  if v_ps >= p_start or p_start - v_ps > 800 then v_ps := p_start - (p_end - p_start) - 1; end if;
  v_pe := coalesce(p_prev_end, p_start - 1);
  if v_pe >= p_start or v_pe < v_ps then v_pe := p_start - 1; end if;

  if 'ga4' = any(p_parts) then
    select array_agg(s.id) into g_ids from analytics_sources s where s.company_id = p_company and s.kind = 'ga4';
  end if;
  if 'clarity' = any(p_parts) then
    select array_agg(s.id) into c_ids from analytics_sources s where s.company_id = p_company and s.kind = 'clarity';
  end if;

  -- ------------------------------ GA4 ------------------------------
  if g_ids is not null then
    ga := jsonb_build_object(
      'sources', (select jsonb_agg(
          jsonb_build_object('id', s.id, 'name', s.name, 'key_event', s.settings->>'key_event', 'last_synced_at', s.last_synced_at, 'demo', s.is_demo)
          || case when p_client then '{}'::jsonb
                  else jsonb_build_object('external_id', s.external_id, 'sync_error', s.sync_error, 'connected', s.connection_id is not null) end
          order by s.name)
        from analytics_sources s where s.id = any(g_ids)),
      'currency', (select s.currency from analytics_sources s where s.id = any(g_ids) and s.currency is not null order by s.created_at limit 1),
      'synced_at', (select max(s.last_synced_at) from analytics_sources s where s.id = any(g_ids)),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', x.date, 'sessions', x.sessions, 'users', x.users, 'new_users', x.new_users,
            'engaged', x.engaged, 'engagement_s', x.engagement_s, 'key_events', x.key_events, 'purchases', x.purchases,
            'revenue', x.revenue, 'pageviews', x.pageviews) order by x.date)
          from (select t.date, sum(t.sessions) as sessions, sum(t.users) as users, sum(t.new_users) as new_users, sum(t.engaged_sessions) as engaged,
                       sum(t.engagement_seconds) as engagement_s, sum(t.key_events) as key_events, sum(t.purchases) as purchases,
                       sum(t.revenue) as revenue, sum(t.pageviews) as pageviews
                from ga4_dims_daily t
                where t.source_id = any(g_ids) and t.dim = 'total' and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.date) x), '[]'::jsonb),
      'channels', coalesce((select jsonb_agg(jsonb_build_object('channel', x.channel, 'sessions', x.s, 'users', x.u, 'new_users', x.nu, 'engaged', x.e,
            'key_events', x.k, 'purchases', x.p, 'revenue', x.r,
            'prev_sessions', x.ps, 'prev_key_events', x.pk, 'prev_revenue', x.pr) order by x.s desc, x.channel)
          from (select t.channel,
                  coalesce(sum(t.sessions) filter (where t.date between p_start and p_end), 0) as s,
                  coalesce(sum(t.users) filter (where t.date between p_start and p_end), 0) as u,
                  coalesce(sum(t.new_users) filter (where t.date between p_start and p_end), 0) as nu,
                  coalesce(sum(t.engaged_sessions) filter (where t.date between p_start and p_end), 0) as e,
                  coalesce(sum(t.key_events) filter (where t.date between p_start and p_end), 0) as k,
                  coalesce(sum(t.purchases) filter (where t.date between p_start and p_end), 0) as p,
                  coalesce(sum(t.revenue) filter (where t.date between p_start and p_end), 0) as r,
                  coalesce(sum(t.sessions) filter (where t.date between v_ps and v_pe), 0) as ps,
                  coalesce(sum(t.key_events) filter (where t.date between v_ps and v_pe), 0) as pk,
                  coalesce(sum(t.revenue) filter (where t.date between v_ps and v_pe), 0) as pr
                from ga4_channels_daily t
                where t.source_id = any(g_ids) and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.channel) x
          where x.s > 0 or x.ps > 0), '[]'::jsonb),
      'sources_medium', coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'medium', x.medium, 'channel', x.channel, 'sessions', x.s,
            'engaged', x.e, 'key_events', x.k, 'purchases', x.p, 'revenue', x.r, 'prev_sessions', x.ps) order by x.s desc, x.source)
          from (select t.source, t.medium, max(t.channel) as channel,
                  coalesce(sum(t.sessions) filter (where t.date between p_start and p_end), 0) as s,
                  coalesce(sum(t.engaged_sessions) filter (where t.date between p_start and p_end), 0) as e,
                  coalesce(sum(t.key_events) filter (where t.date between p_start and p_end), 0) as k,
                  coalesce(sum(t.purchases) filter (where t.date between p_start and p_end), 0) as p,
                  coalesce(sum(t.revenue) filter (where t.date between p_start and p_end), 0) as r,
                  coalesce(sum(t.sessions) filter (where t.date between v_ps and v_pe), 0) as ps
                from ga4_channels_daily t
                where t.source_id = any(g_ids) and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.source, t.medium
                order by 4 desc limit 30) x
          where x.s > 0), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(jsonb_build_object('page', x.page, 'sessions', x.s, 'engaged', x.e, 'key_events', x.k, 'prev_sessions', x.ps) order by x.s desc, x.page)
          from (select t.page,
                  coalesce(sum(t.sessions) filter (where t.date between p_start and p_end), 0) as s,
                  coalesce(sum(t.engaged_sessions) filter (where t.date between p_start and p_end), 0) as e,
                  coalesce(sum(t.key_events) filter (where t.date between p_start and p_end), 0) as k,
                  coalesce(sum(t.sessions) filter (where t.date between v_ps and v_pe), 0) as ps
                from ga4_pages_daily t
                where t.source_id = any(g_ids) and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.page
                order by 2 desc limit 30) x
          where x.s > 0), '[]'::jsonb),
      'devices', coalesce((select jsonb_agg(jsonb_build_object('device', x.value, 'sessions', x.s, 'users', x.u, 'engaged', x.e, 'key_events', x.k, 'revenue', x.r) order by x.s desc, x.value)
          from (select t.value, sum(t.sessions) as s, sum(t.users) as u, sum(t.engaged_sessions) as e, sum(t.key_events) as k, sum(t.revenue) as r
                from ga4_dims_daily t
                where t.source_id = any(g_ids) and t.dim = 'device' and t.date between p_start and p_end
                group by t.value) x
          where x.s > 0), '[]'::jsonb),
      'countries', coalesce((select jsonb_agg(jsonb_build_object('country', x.value, 'sessions', x.s, 'key_events', x.k, 'revenue', x.r) order by x.s desc, x.value)
          from (select t.value, sum(t.sessions) as s, sum(t.key_events) as k, sum(t.revenue) as r
                from ga4_dims_daily t
                where t.source_id = any(g_ids) and t.dim = 'country' and t.date between p_start and p_end
                group by t.value
                order by 2 desc limit 12) x
          where x.s > 0), '[]'::jsonb)
    );
  end if;

  -- ------------------------------ Clarity ------------------------------
  if c_ids is not null then
    cl := jsonb_build_object(
      'sources', (select jsonb_agg(
          jsonb_build_object('id', s.id, 'name', s.name, 'first_synced_at', s.first_synced_at, 'last_synced_at', s.last_synced_at, 'demo', s.is_demo)
          || case when p_client then '{}'::jsonb else jsonb_build_object('external_id', s.external_id, 'sync_error', s.sync_error) end
          order by s.name)
        from analytics_sources s where s.id = any(c_ids)),
      'first_day', (select min(t.date) from clarity_daily t where t.source_id = any(c_ids)),
      'last_day', (select max(t.date) from clarity_daily t where t.source_id = any(c_ids)),
      'synced_at', (select max(s.last_synced_at) from analytics_sources s where s.id = any(c_ids)),
      'daily', coalesce((select jsonb_agg(to_jsonb(x) order by x.d)
          from (select t.date as d, sum(t.sessions) as sessions, sum(t.users) as users,
                       sum(t.dead_clicks) as dead_clicks, sum(t.dead_sessions) as dead_sessions,
                       sum(t.rage_clicks) as rage_clicks, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickbacks) as quickbacks, sum(t.quickback_sessions) as quickback_sessions,
                       sum(t.excessive_scrolls) as excessive_scrolls, sum(t.excessive_sessions) as excessive_sessions,
                       sum(t.script_errors) as script_errors, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.error_clicks) as error_clicks, sum(t.error_click_sessions) as error_click_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time,
                       sum(t.total_time * t.sessions) / nullif(sum(t.sessions) filter (where t.total_time is not null), 0) as total_time,
                       sum(t.pages_per_session * t.sessions) / nullif(sum(t.sessions) filter (where t.pages_per_session is not null), 0) as pages_per_session,
                       max(t.window_days) as window_days
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'device' and (t.date between p_start and p_end or t.date between v_ps and v_pe)
                group by t.date) x), '[]'::jsonb),
      'devices', coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc, x.device)
          from (select t.key as device, sum(t.sessions) as sessions, sum(t.users) as users,
                       sum(t.dead_clicks) as dead_clicks, sum(t.dead_sessions) as dead_sessions,
                       sum(t.rage_clicks) as rage_clicks, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickbacks) as quickbacks, sum(t.quickback_sessions) as quickback_sessions,
                       sum(t.excessive_scrolls) as excessive_scrolls, sum(t.excessive_sessions) as excessive_sessions,
                       sum(t.script_errors) as script_errors, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.error_clicks) as error_clicks, sum(t.error_click_sessions) as error_click_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'device' and t.date between p_start and p_end
                group by t.key) x
          where x.sessions > 0), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc, x.url, x.device)
          from (select t.key as url, t.device, sum(t.sessions) as sessions,
                       sum(t.dead_clicks) as dead_clicks, sum(t.dead_sessions) as dead_sessions,
                       sum(t.rage_clicks) as rage_clicks, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickbacks) as quickbacks, sum(t.quickback_sessions) as quickback_sessions,
                       sum(t.excessive_scrolls) as excessive_scrolls, sum(t.excessive_sessions) as excessive_sessions,
                       sum(t.script_errors) as script_errors, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.error_clicks) as error_clicks, sum(t.error_click_sessions) as error_click_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'page' and t.date between p_start and p_end
                group by t.key, t.device
                order by 3 desc limit 240) x
          where x.sessions > 0), '[]'::jsonb),
      'channels', coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc, x.channel)
          from (select t.key as channel, sum(t.sessions) as sessions,
                       sum(t.dead_sessions) as dead_sessions, sum(t.rage_sessions) as rage_sessions,
                       sum(t.quickback_sessions) as quickback_sessions, sum(t.script_error_sessions) as script_error_sessions,
                       sum(t.scroll_depth * t.sessions) / nullif(sum(t.sessions) filter (where t.scroll_depth is not null), 0) as scroll_depth,
                       sum(t.active_time * t.sessions) / nullif(sum(t.sessions) filter (where t.active_time is not null), 0) as active_time
                from clarity_daily t
                where t.source_id = any(c_ids) and t.scope = 'channel' and t.date between p_start and p_end
                group by t.key) x
          where x.sessions > 0), '[]'::jsonb)
    );
  end if;

  -- ------------------------------ Tracking first-party (agence seulement) ------------------------------
  if not p_client and exists (select 1 from tracking_sites s where s.company_id = p_company) then
    select jsonb_build_object(
      'purchases', count(*) filter (where e.type in ('purchase','deal_won')),
      'revenue', coalesce(sum(e.value) filter (where e.type in ('purchase','deal_won')), 0),
      'leads', count(*) filter (where e.type in ('lead','booking')))
    into fp
    from tracking_events e join tracking_sites s on s.id = e.site_id
    where s.company_id = p_company and e.type in ('purchase','deal_won','lead','booking')
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz;
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'prev_start', v_ps, 'prev_end', v_pe),
    'ga4', ga, 'clarity', cl, 'first_party', fp);
end $$;
revoke execute on function public._site_analytics(uuid, date, date, date, date, boolean, text[]) from anon, authenticated, public;
grant execute on function public._site_analytics(uuid, date, date, date, date, boolean, text[]) to service_role;

-- Tableau de bord de l'agence : réservé aux membres de l'espace du client (null sinon)
create or replace function public.site_analytics(p_company uuid, p_start date, p_end date, p_prev_start date default null, p_prev_end date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from companies c where c.id = p_company and public.is_member(c.workspace_id)) then
    return null;
  end if;
  return public._site_analytics(p_company, p_start, p_end, p_prev_start, p_prev_end, false);
end $$;
revoke execute on function public.site_analytics(uuid, date, date, date, date) from anon, public;
grant execute on function public.site_analytics(uuid, date, date, date, date) to authenticated;

-- Reporting global : sessions et évènements clés GA4 par client (security invoker : la RLS s'applique)
create or replace function public.analytics_overview(p_ws uuid, p_start date, p_end date)
returns table (company_id uuid, sessions bigint, key_events numeric, purchases numeric, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select s.company_id, sum(t.sessions)::bigint, sum(t.key_events), sum(t.purchases), sum(t.revenue)
  from ga4_dims_daily t
  join analytics_sources s on s.id = t.source_id
  where t.workspace_id = p_ws and t.dim = 'total' and t.date between p_start and p_end and s.company_id is not null
  group by s.company_id;
$$;
revoke execute on function public.analytics_overview(uuid, date, date) from anon, public;
grant execute on function public.analytics_overview(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Portail client : site (GA4) et comportement (Clarity) de CETTE entreprise.
-- Mêmes règles que les autres fonctions portal_* : contrôle d'accès en tête,
-- agrégats seulement, version « client » (sans identifiant externe ni erreur de synchro).
-- ---------------------------------------------------------------------
create or replace function public.portal_site_analytics(p_company uuid, p_start date, p_end date, p_prev_start date default null, p_prev_end date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.portal_require(p_company, 'reporting');
  perform public.portal_module_require(p_company, 'reporting');
  return public._site_analytics(p_company, p_start, p_end, p_prev_start, p_prev_end, true);
end $$;
revoke execute on function public.portal_site_analytics(uuid, date, date, date, date) from anon, public;
grant execute on function public.portal_site_analytics(uuid, date, date, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Rapport public : ajoute les sections facultatives. Seules les parties cochées
-- sont calculées et renvoyées (version « client »).
-- ---------------------------------------------------------------------
create or replace function public._report_analytics(p_company uuid, p_start date, p_end date, p_sections text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_sections && array['site','behavior'] then
    public._site_analytics(p_company, p_start, p_end, null, null, true,
      array(select x from unnest(array[case when 'site' = any(p_sections) then 'ga4' end, case when 'behavior' = any(p_sections) then 'clarity' end]) as x where x is not null))
  end;
$$;
revoke execute on function public._report_analytics(uuid, date, date, text[]) from anon, authenticated, public;
grant execute on function public._report_analytics(uuid, date, date, text[]) to service_role;

create or replace function public.public_report(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r reports; res jsonb;
begin
  select * into r from reports where public_token = p_token and shared;
  if r.id is null then return null; end if;
  select jsonb_build_object(
    'report', to_jsonb(r) - 'public_token' - 'created_by',
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(metric, target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id,
        'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks, 'conversions', m.conversions, 'value', m.conversion_value))
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb),
    'analytics', public._report_analytics(r.company_id, r.period_start, r.period_end, r.sections)
  ) into res;
  return res;
end $$;
grant execute on function public.public_report(text) to anon, authenticated;

-- Rapport publié lu dans le portail : mêmes sections
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
      'period_end', r.period_end, 'commentary', r.commentary, 'next_steps', r.next_steps, 'shared', r.shared, 'created_at', r.created_at,
      'sections', r.sections),
    'workspace', (select jsonb_build_object('name', w.name, 'accent', w.accent, 'currency', w.currency) from workspaces w where w.id = r.workspace_id),
    'company', (select jsonb_build_object('name', c.name) from companies c where c.id = r.company_id),
    'targets', coalesce((select jsonb_object_agg(k.metric, k.target) from kpi_targets k where k.company_id = r.company_id), '{}'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'name', a.name, 'currency', a.currency))
        from ad_accounts a where a.company_id = r.company_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('account', m.ad_account_id, 'date', m.date, 'campaign', m.campaign_name,
        'campaign_id', m.campaign_id, 'spend', m.spend, 'impressions', m.impressions, 'clicks', m.clicks,
        'conversions', m.conversions, 'value', m.conversion_value) order by m.date)
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.company_id = r.company_id and m.date between (r.period_start - (r.period_end - r.period_start) - 1) and r.period_end), '[]'::jsonb),
    'analytics', public._report_analytics(r.company_id, r.period_start, r.period_end, r.sections)
  );
end $$;
revoke execute on function public.portal_report(uuid, uuid) from anon, public;
grant execute on function public.portal_report(uuid, uuid) to authenticated;

-- =====================================================================
-- Données de démo : une propriété GA4 et un projet Clarity fictifs pour
-- Maison Lumen et Kalia Cosmetics.
--  - GA4 : 90 jours, jusqu'au dernier jour des campagnes de démo. Les canaux payants les suivent
--    (sessions Paid Social = part des clics Meta du jour, achats = part des
--    conversions déclarées par Meta), les autres canaux ont un volume propre.
--  - Clarity : 30 jours, avec deux pages à problèmes par site (clics de rage
--    sur mobile au panier ou au paiement, clics morts sur une fiche produit).
-- Tout est écrit en SQL ensembliste : un seul appel, bien sous les 8 s de l'API.
-- =====================================================================
create or replace function public._clear_demo_analytics(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from analytics_sources where workspace_id = ws and is_demo;
  update reports set sections = '{}'
  where workspace_id = ws and title = 'Rapport mensuel · Maison Lumen' and sections <> '{}'
    and not exists (select 1 from analytics_sources s where s.company_id = reports.company_id);
end $$;
revoke execute on function public._clear_demo_analytics(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_analytics(uuid) to service_role;

create or replace function public._demo_analytics(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  cfg record; comp uuid; g uuid; c uuid; n int := 0; anchor date;
begin
  perform _clear_demo_analytics(ws);
  -- Dernier jour des campagnes de démo : les données de site s'arrêtent le même jour qu'elles
  select coalesce(max(m.date), current_date - 1) into anchor
  from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
  where a.workspace_id = ws and a.external_id like 'demo-%';
  for cfg in
    select * from (values
      ('Maison Lumen', 'lumen', 'maisonlumen.fr', 226.0, 1.0,
        array['/', '/collections/suspensions', '/produits/suspension-opale', '/collections/lampadaires', '/produits/lampadaire-arc', '/blog/eclairer-un-salon', '/panier', '/checkout'],
        '/panier', '/produits/lampadaire-arc'),
      ('Kalia Cosmetics', 'kalia', 'kalia-cosmetics.com', 145.0, 0.85,
        array['/', '/collections/soins-visage', '/produits/serum-eclat', '/produits/creme-nuit-reparatrice', '/blog/routine-peau-seche', '/pages/diagnostic-peau', '/panier', '/checkout'],
        '/checkout', '/produits/serum-eclat')
    ) as x(company, slug, domain, aov, vol, pages, rage_page, dead_page)
  loop
    select co.id into comp from companies co where co.workspace_id = ws and co.name = cfg.company limit 1;
    if comp is null then continue; end if;

    insert into analytics_sources (workspace_id, company_id, kind, external_id, name, currency, timezone, settings, first_synced_at, last_synced_at, is_demo)
    values (ws, comp, 'ga4', 'demo-ga4-' || cfg.slug, cfg.domain || ' (GA4)', 'EUR', 'Europe/Paris', '{"key_event": "purchase"}'::jsonb, (anchor - 89)::timestamptz, (anchor + 1)::timestamptz + interval '5 hours', true)
    returning id into g;
    insert into analytics_sources (workspace_id, company_id, kind, external_id, name, settings, first_synced_at, last_synced_at, is_demo)
    values (ws, comp, 'clarity', 'demo-clarity-' || cfg.slug, cfg.domain, '{}'::jsonb, (anchor - 29)::timestamptz, (anchor + 1)::timestamptz + interval '5 hours', true)
    returning id into c;
    n := n + 2;

    -- ---------- GA4 : jour × canal × source / medium ----------
    insert into ga4_channels_daily (source_id, workspace_id, date, channel, source, medium, sessions, users, new_users, engaged_sessions, engagement_seconds, key_events, purchases, revenue)
    with days as (
      select d::date as date, (anchor - d::date) as ago
      from generate_series(anchor - 89, anchor, interval '1 day') d
    ),
    ads as (
      -- clics et conversions Meta du jour pour ce client (campagnes de démo)
      select m.date, sum(m.clicks)::numeric as clicks, sum(m.conversions) as conv
      from ad_metrics_daily m join ad_accounts a on a.id = m.ad_account_id
      where a.workspace_id = ws and a.company_id = comp and a.platform = 'meta'
      group by m.date
    ),
    ch as (
      select * from (values
        -- canal, source, medium, part des clics Meta, sessions de base, part des conversions Meta, taux de conversion propre, engagement, nouveaux, secondes par session engagée
        ('Paid Social', 'facebook', 'paid', 0.58, 0.0, 0.52, 0.0, 0.44, 0.80, 52),
        ('Paid Social', 'instagram', 'paid', 0.24, 0.0, 0.20, 0.0, 0.41, 0.84, 47),
        ('Paid Search', 'google', 'cpc', 0.0, 22.0, 0.0, 0.031, 0.66, 0.52, 78),
        ('Organic Search', 'google', 'organic', 0.0, 96.0, 0.0, 0.017, 0.69, 0.61, 96),
        ('Organic Search', 'bing', 'organic', 0.0, 9.0, 0.0, 0.014, 0.66, 0.63, 88),
        ('Direct', '(direct)', '(none)', 0.0, 58.0, 0.0, 0.024, 0.60, 0.38, 84),
        ('Email', 'klaviyo', 'email', 0.0, 24.0, 0.0, 0.038, 0.74, 0.08, 102),
        ('Organic Social', 'instagram', 'social', 0.0, 19.0, 0.0, 0.006, 0.47, 0.58, 49),
        ('Organic Social', 'pinterest', 'social', 0.0, 8.0, 0.0, 0.004, 0.43, 0.77, 41),
        ('Referral', 'elle.fr', 'referral', 0.0, 6.0, 0.0, 0.011, 0.63, 0.82, 71),
        ('Unassigned', '(not set)', '(not set)', 0.0, 3.0, 0.0, 0.0, 0.30, 0.70, 30)
      ) as x(channel, source, medium, click_share, base, conv_share, cr, eng, newu, secs)
    ),
    raw as (
      select d.date, ch.*,
        0.82 + 0.36 * ((hashtext(ch.source || ch.medium || d.date::text) & 1023) / 1023.0) as noise,
        0.85 + 0.30 * ((hashtext(d.date::text || ch.source) & 255) / 255.0) as noise2,
        case when extract(isodow from d.date) in (6, 7) then 0.86 else 1.0 end as wk,
        -- newsletter le mardi et le jeudi
        case when ch.channel = 'Email' and extract(isodow from d.date) in (2, 4) then 3.2 else 1.0 end as mail,
        1 + (89 - d.ago) * 0.0025 as trend,
        coalesce(a.clicks, 0) as clicks, coalesce(a.conv, 0) as conv
      from days d cross join ch left join ads a on a.date = d.date
    ),
    s as (
      select r.*,
        greatest(0, round(case when r.click_share > 0 then r.clicks * r.click_share * (0.94 + 0.12 * (r.noise - 0.82) / 0.36)
                               else r.base * cfg.vol * r.noise * r.wk * r.mail * r.trend end))::bigint as sessions
      from raw r
    ),
    k as (
      select s.*,
        round((case when s.conv_share > 0 then s.conv * s.conv_share * s.noise2 else s.sessions * s.cr * s.noise2 end)::numeric)::numeric as purchases
      from s
    )
    select g, ws, k.date, k.channel, k.source, k.medium, k.sessions,
      round(k.sessions * 0.88)::bigint, round(k.sessions * 0.88 * k.newu)::bigint,
      round(k.sessions * k.eng * (0.95 + 0.1 * (k.noise2 - 0.85) / 0.3))::bigint,
      round(k.sessions * k.eng * k.secs)::bigint,
      k.purchases, k.purchases,
      round((k.purchases * cfg.aov * (0.88 + 0.24 * ((hashtext(k.source || k.date::text) & 255) / 255.0)))::numeric, 2)
    from k where k.sessions > 0;

    -- ---------- GA4 : totaux du jour, appareils et pays (dérivés des canaux) ----------
    insert into ga4_dims_daily (source_id, workspace_id, date, dim, value, sessions, users, new_users, engaged_sessions, engagement_seconds, key_events, purchases, revenue, pageviews)
    with t as (
      select date, sum(sessions) as sessions, sum(users) as users, sum(new_users) as new_users, sum(engaged_sessions) as engaged,
             sum(engagement_seconds) as secs, sum(key_events) as k, sum(revenue) as r
      from ga4_channels_daily where source_id = g group by date
    ),
    dims as (
      select * from (values
        -- dimension, valeur, part des sessions, part des achats, part du revenu, engagement relatif
        ('total', '', 1.0, 1.0, 1.0, 1.0),
        ('device', 'mobile', 0.72, 0.55, 0.50, 0.94),
        ('device', 'desktop', 0.24, 0.41, 0.46, 1.17),
        ('device', 'tablet', 0.04, 0.04, 0.04, 1.02),
        ('country', 'France', 0.87, 0.90, 0.90, 1.0),
        ('country', 'Belgium', 0.06, 0.05, 0.05, 1.0),
        ('country', 'Switzerland', 0.04, 0.03, 0.04, 1.0),
        ('country', 'Canada', 0.02, 0.01, 0.01, 1.0),
        ('country', 'Luxembourg', 0.01, 0.01, 0.0, 1.0)
      ) as x(dim, value, sh, ksh, rsh, engf)
    )
    select g, ws, t.date, dims.dim, dims.value,
      round(t.sessions * dims.sh)::bigint,
      round(t.users * dims.sh * (case when dims.dim = 'total' then 0.97 else 1 end))::bigint,
      round(t.new_users * dims.sh)::bigint,
      least(round(t.sessions * dims.sh), round(t.engaged * dims.sh * dims.engf))::bigint,
      round(t.secs * dims.sh * dims.engf)::bigint,
      round(t.k * dims.ksh), round(t.k * dims.ksh), round((t.r * dims.rsh)::numeric, 2),
      round(t.sessions * dims.sh * (case when dims.value = 'desktop' then 3.1 else 2.3 end))::bigint
    from t cross join dims;

    -- ---------- GA4 : pages de destination ----------
    insert into ga4_pages_daily (source_id, workspace_id, date, page, sessions, engaged_sessions, key_events)
    with t as (
      select date, sessions, key_events from ga4_dims_daily where source_id = g and dim = 'total'
    ),
    pg as (
      select * from (values (1, 0.24, 0.55, 0.14), (2, 0.19, 0.61, 0.20), (3, 0.21, 0.52, 0.36), (4, 0.09, 0.60, 0.08),
                            (5, 0.12, 0.49, 0.16), (6, 0.07, 0.72, 0.02), (7, 0.02, 0.81, 0.03), (8, 0.01, 0.88, 0.01)) as x(i, sh, eng, ksh)
    )
    select g, ws, y.date, y.page, y.sessions, round(y.sessions * y.eng)::bigint, round(y.key_events * y.ksh)
    from (
      select t.date, cfg.pages[pg.i] as page,
        round(t.sessions * pg.sh * (0.9 + 0.2 * ((hashtext(t.date::text || pg.i::text) & 255) / 255.0)))::bigint as sessions,
        pg.eng, pg.ksh, t.key_events
      from t cross join pg
    ) y
    union all
    select g, ws, t.date, '(autres)', round(t.sessions * 0.05)::bigint, round(t.sessions * 0.05 * 0.5)::bigint, 0
    from t;

    -- ---------- Clarity : 30 jours, pages × appareil ----------
    insert into clarity_daily (source_id, workspace_id, date, scope, key, device, sessions, bot_sessions, users, pages_per_session, scroll_depth, total_time, active_time,
      dead_clicks, dead_sessions, rage_clicks, rage_sessions, quickbacks, quickback_sessions, excessive_scrolls, excessive_sessions,
      script_errors, script_error_sessions, error_clicks, error_click_sessions)
    with t as (
      -- Clarity voit un peu moins de sessions que GA4 (consentement, bloqueurs)
      select date, sessions * 0.93 as sessions from ga4_dims_daily where source_id = g and dim = 'total' and date > anchor - 30
    ),
    pg as (
      -- page, part des sessions (pages vues, pas seulement les arrivées), profondeur de défilement, temps actif
      select * from (values (1, 0.26, 47.0, 38.0), (2, 0.22, 58.0, 55.0), (3, 0.24, 63.0, 71.0), (4, 0.11, 56.0, 49.0),
                            (5, 0.15, 61.0, 66.0), (6, 0.07, 72.0, 118.0), (7, 0.13, 78.0, 44.0), (8, 0.08, 86.0, 97.0)) as x(i, sh, scroll, active)
    ),
    dv as (
      select * from (values ('Mobile', 0.71, -5.0, 0.86), ('PC', 0.25, 4.0, 1.25), ('Tablet', 0.04, 0.0, 1.05)) as x(device, sh, dscroll, tf)
    ),
    base as (
      select t.date, cfg.pages[pg.i] as page, dv.device,
        round(t.sessions * pg.sh * dv.sh * (0.88 + 0.24 * ((hashtext(t.date::text || pg.i::text || dv.device) & 255) / 255.0))) as sessions,
        pg.scroll + dv.dscroll as scroll, pg.active * dv.tf as active,
        0.8 + 0.4 * ((hashtext(dv.device || pg.i::text || t.date::text) & 255) / 255.0) as nz,
        -- tirages stables entre 0 et 1 : arrondi aléatoire des petits volumes (sinon tout tombe à zéro)
        (hashtext('a' || t.date::text || pg.i::text || dv.device) & 255) / 256.0 as u1,
        (hashtext('b' || t.date::text || pg.i::text || dv.device) & 255) / 256.0 as u2
      from t cross join pg cross join dv
    ),
    r as (
      select b.*,
        -- taux de sessions touchées : base du site, puis les deux pages à problèmes
        (case when b.page = cfg.rage_page and b.device = 'Mobile' then 0.094 when b.page = cfg.rage_page then 0.016 else 0.005 end) * b.nz as rage,
        (case when b.page = cfg.dead_page then (case when b.device = 'PC' then 0.118 else 0.171 end) else 0.041 end) * b.nz as dead,
        (case when b.page = cfg.dead_page then 0.071 when b.page = '/' then 0.046 else 0.027 end) * b.nz as quick,
        (case when b.page like '/blog/%' then 0.031 else 0.011 end) * b.nz as exc,
        (case when b.page = cfg.rage_page then 0.052 else 0.012 end) * b.nz as serr,
        (case when b.page = cfg.rage_page then 0.021 else 0.003 end) * b.nz as eclk
      from base b
    )
    select c, ws, r.date, 'page', 'https://' || cfg.domain || r.page, r.device, r.sessions, round(r.sessions * 0.04), round(r.sessions * 0.9),
      round((1.6 + 0.9 * r.nz)::numeric, 2), round(r.scroll::numeric, 1), round((r.active * 1.9)::numeric), round(r.active::numeric),
      round(floor(r.sessions * r.dead + r.u1) * 1.7), floor(r.sessions * r.dead + r.u1),
      round(floor(r.sessions * r.rage + r.u2) * 2.6), floor(r.sessions * r.rage + r.u2),
      round(floor(r.sessions * r.quick + r.u2) * 1.1), floor(r.sessions * r.quick + r.u2),
      floor(r.sessions * r.exc + r.u1), floor(r.sessions * r.exc + r.u1),
      round(floor(r.sessions * r.serr + r.u1) * 1.4), floor(r.sessions * r.serr + r.u1),
      round(floor(r.sessions * r.eclk + r.u2) * 1.2), floor(r.sessions * r.eclk + r.u2)
    from r where r.sessions > 0;

    -- Clarity : totaux par appareil (somme des pages, une session visitant en moyenne 1,26 page suivie)
    insert into clarity_daily (source_id, workspace_id, date, scope, key, device, sessions, bot_sessions, users, pages_per_session, scroll_depth, total_time, active_time,
      dead_clicks, dead_sessions, rage_clicks, rage_sessions, quickbacks, quickback_sessions, excessive_scrolls, excessive_sessions,
      script_errors, script_error_sessions, error_clicks, error_click_sessions)
    select c, ws, p.date, 'device', p.device, '', round(sum(p.sessions) / 1.26), round(sum(p.bot_sessions) / 1.26), round(sum(p.users) / 1.26),
      round((sum(p.pages_per_session * p.sessions) / nullif(sum(p.sessions), 0))::numeric, 2),
      round((sum(p.scroll_depth * p.sessions) / nullif(sum(p.sessions), 0))::numeric, 1),
      round((sum(p.total_time * p.sessions) / nullif(sum(p.sessions), 0))::numeric), round((sum(p.active_time * p.sessions) / nullif(sum(p.sessions), 0))::numeric),
      sum(p.dead_clicks), round(sum(p.dead_sessions) * 0.9), sum(p.rage_clicks), round(sum(p.rage_sessions) * 0.95),
      sum(p.quickbacks), round(sum(p.quickback_sessions) * 0.9), sum(p.excessive_scrolls), round(sum(p.excessive_sessions) * 0.95),
      sum(p.script_errors), round(sum(p.script_error_sessions) * 0.9), sum(p.error_clicks), round(sum(p.error_click_sessions) * 0.95)
    from clarity_daily p where p.source_id = c and p.scope = 'page'
    group by p.date, p.device;

    -- Clarity : par canal (le trafic payant social revient plus vite en arrière)
    insert into clarity_daily (source_id, workspace_id, date, scope, key, device, sessions, users, scroll_depth, active_time,
      dead_sessions, rage_sessions, quickback_sessions, script_error_sessions)
    with t as (
      select date, sum(sessions) as sessions, sum(dead_sessions) as dead, sum(rage_sessions) as rage, sum(quickback_sessions) as quick, sum(script_error_sessions) as serr,
             sum(scroll_depth * sessions) / nullif(sum(sessions), 0) as scroll, sum(active_time * sessions) / nullif(sum(sessions), 0) as active
      from clarity_daily where source_id = c and scope = 'device' group by date
    ),
    ch as (
      select * from (values ('PaidSocial', 0.52, 1.45, 0.78), ('OrganicSearch', 0.21, 0.62, 1.22), ('Direct', 0.12, 0.70, 1.18),
                            ('Email', 0.06, 0.48, 1.35), ('Social', 0.05, 1.10, 0.85), ('PaidSearch', 0.03, 0.80, 1.10), ('Referral', 0.01, 0.90, 1.00)) as x(channel, sh, qf, ef)
    )
    select c, ws, t.date, 'channel', ch.channel, '', round(t.sessions * ch.sh), round(t.sessions * ch.sh * 0.9),
      round((t.scroll * (0.75 + 0.25 * ch.ef))::numeric, 1), round((t.active * ch.ef)::numeric),
      round(t.dead * ch.sh), round(t.rage * ch.sh), round(t.quick * ch.sh * ch.qf), round(t.serr * ch.sh)
    from t cross join ch;
  end loop;

  -- Le rapport mensuel de démo affiche les deux nouvelles sections
  update reports set sections = array['site', 'behavior']
  where workspace_id = ws and title = 'Rapport mensuel · Maison Lumen' and sections = '{}';
  return n;
end $$;
revoke execute on function public._demo_analytics(uuid) from anon, authenticated, public;
grant execute on function public._demo_analytics(uuid) to service_role;

-- Points d'entrée pour l'interface (réservés aux admins de l'espace)
create or replace function public.load_demo_analytics(ws uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  return _demo_analytics(ws);
end $$;
revoke execute on function public.load_demo_analytics(uuid) from anon, public;
grant execute on function public.load_demo_analytics(uuid) to authenticated;

create or replace function public.clear_demo_analytics(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_analytics(ws);
end $$;
revoke execute on function public.clear_demo_analytics(uuid) from anon, public;
grant execute on function public.clear_demo_analytics(uuid) to authenticated;

-- =====================================================================
-- 0100_tracking_funnel_keys.sql
-- =====================================================================
-- =====================================================================
-- Tracking OS, étape 1 : entonnoir configurable par site et clés d'envoi.
--
-- 1. tracking_stages : les étapes du parcours d'un site (prospect, rendez-vous,
--    vente…), posées depuis un gabarit à la création puis modifiables.
-- 2. tracking_funnel : conversions d'une période regroupées par type.
-- 3. tracking_keys : plusieurs clés d'envoi par site, révocables une à une,
--    dont seul le hash SHA-256 est stocké. Elles remplacent
--    tracking_sites.secret_key (une clé unique, en clair) : la clé en place
--    est reprise par son empreinte, les intégrations existantes continuent
--    de fonctionner.
-- Rejouable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Étapes de l'entonnoir
-- ---------------------------------------------------------------------
create table if not exists public.tracking_stages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Type d'évènement de référence (lead, booking, purchase… ou nom libre)
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(trim(label)) between 1 and 60),
  position int not null default 0,
  -- lead : entrée dans l'entonnoir ; step : jalon ; sale : vente
  kind text not null default 'step' check (kind in ('lead', 'step', 'sale')),
  has_value boolean not null default false,
  -- Autres types d'évènement comptés dans cette étape (deal_won pour une vente…)
  aliases text[] not null default '{}',
  unique (site_id, key)
);
create index if not exists tracking_stages_site on public.tracking_stages (site_id, position);

alter table public.tracking_stages enable row level security;
drop policy if exists "étapes lisibles" on public.tracking_stages;
create policy "étapes lisibles" on public.tracking_stages for select using (public.is_member(workspace_id));
drop policy if exists "étapes modifiables" on public.tracking_stages;
create policy "étapes modifiables" on public.tracking_stages for all
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));

-- Gabarits. Les clés sont les types d'évènement que le script et l'API normalisent déjà.
create or replace function public._tracking_template(p_template text)
returns table (key text, label text, pos int, kind text, has_value boolean, aliases text[])
language sql immutable set search_path = public as $$
  select t.key, t.label, t.pos, t.kind, t.has_value, t.aliases
  from (values
    ('appel', 'lead', 'Prospects', 1, 'lead', false, '{}'::text[]),
    ('appel', 'booking', 'Rendez-vous pris', 2, 'step', false, '{}'),
    ('appel', 'show', 'Rendez-vous honorés', 3, 'step', false, '{}'),
    ('appel', 'qualified', 'Prospects qualifiés', 4, 'step', false, '{}'),
    ('appel', 'purchase', 'Ventes', 5, 'sale', true, '{deal_won}'),
    ('ecommerce', 'add_to_cart', 'Ajouts au panier', 1, 'step', false, '{}'),
    ('ecommerce', 'begin_checkout', 'Paiements initiés', 2, 'step', false, '{}'),
    ('ecommerce', 'purchase', 'Achats', 3, 'sale', true, '{}'),
    ('leads', 'lead', 'Prospects', 1, 'lead', false, '{booking}'),
    ('leads', 'qualified', 'Prospects qualifiés', 2, 'step', false, '{}'),
    ('leads', 'purchase', 'Ventes', 3, 'sale', true, '{deal_won}')
  ) as t(template, key, label, pos, kind, has_value, aliases)
  where t.template = p_template;
$$;
revoke execute on function public._tracking_template(text) from anon, authenticated, public;

-- Remplace l'entonnoir d'un site par un gabarit.
create or replace function public.tracking_apply_template(p_site uuid, p_template text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from tracking_sites where id = p_site;
  if v_ws is null or not public.can_write(v_ws) then raise exception 'Site introuvable'; end if;
  if p_template not in ('appel', 'ecommerce', 'leads') then raise exception 'Gabarit inconnu'; end if;
  delete from tracking_stages where site_id = p_site;
  insert into tracking_stages (site_id, workspace_id, key, label, position, kind, has_value, aliases)
  select p_site, v_ws, t.key, t.label, t.pos, t.kind, t.has_value, t.aliases from public._tracking_template(p_template) t;
end $$;
revoke execute on function public.tracking_apply_template(uuid, text) from anon, public;
grant execute on function public.tracking_apply_template(uuid, text) to authenticated;

-- Tout nouveau site reçoit un entonnoir, quel que soit le chemin de création
-- (interface, démo, MCP). Le gabarit vient de settings.template, « leads » sinon.
create or replace function public._tracking_site_stages()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_template text := coalesce(new.settings->>'template', 'leads');
begin
  if v_template not in ('appel', 'ecommerce', 'leads') then v_template := 'leads'; end if;
  insert into tracking_stages (site_id, workspace_id, key, label, position, kind, has_value, aliases)
  select new.id, new.workspace_id, t.key, t.label, t.pos, t.kind, t.has_value, t.aliases from public._tracking_template(v_template) t;
  return new;
end $$;
revoke execute on function public._tracking_site_stages() from anon, authenticated, public;
drop trigger if exists tracking_site_stages on public.tracking_sites;
create trigger tracking_site_stages after insert on public.tracking_sites
  for each row execute function public._tracking_site_stages();

-- Sites créés avant cette migration.
insert into public.tracking_stages (site_id, workspace_id, key, label, position, kind, has_value, aliases)
select s.id, s.workspace_id, t.key, t.label, t.pos, t.kind, t.has_value, t.aliases
from public.tracking_sites s cross join lateral public._tracking_template('leads') t
where not exists (select 1 from public.tracking_stages x where x.site_id = s.id);

-- ---------------------------------------------------------------------
-- 2. L'entonnoir d'une période : une ligne par étape (personnes distinctes,
--    évènements, valeur), puis une ligne par type d'évènement reçu qui ne
--    correspond à aucune étape (stage_id null). L'appartenance à l'espace
--    est vérifiée par tracking_conversions ; la fenêtre d'un jour évite de
--    charger des points de contact dont on ne se sert pas ici.
-- ---------------------------------------------------------------------
drop function if exists public.tracking_funnel(uuid, date, date);
create or replace function public.tracking_funnel(p_site uuid, p_start date, p_end date)
returns table (stage_id uuid, type text, events int, people int, value numeric)
language sql stable set search_path = public as $$
  with c as (
    select x.type, x.person, x.value from public.tracking_conversions(p_site, p_start, p_end, 1, null) x
  )
  select s.id, null::text, count(c.type)::int, count(distinct c.person)::int, coalesce(sum(c.value), 0)
  from tracking_stages s
  left join c on c.type = s.key or c.type = any(s.aliases)
  where s.site_id = p_site
  group by s.id
  union all
  select null::uuid, c.type, count(*)::int, count(distinct c.person)::int, coalesce(sum(c.value), 0)
  from c
  where not exists (select 1 from tracking_stages s where s.site_id = p_site and (c.type = s.key or c.type = any(s.aliases)))
  group by c.type;
$$;
revoke execute on function public.tracking_funnel(uuid, date, date) from anon, public;
grant execute on function public.tracking_funnel(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Clés d'envoi
-- ---------------------------------------------------------------------
create table if not exists public.tracking_keys (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  -- début visible de la clé, pour la reconnaître dans la liste
  prefix text not null,
  key_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists tracking_keys_site on public.tracking_keys (site_id, created_at desc);

alter table public.tracking_keys enable row level security;
-- Comme l'ancienne clé secrète : invisibles pour un invité.
drop policy if exists "clés lisibles" on public.tracking_keys;
create policy "clés lisibles" on public.tracking_keys for select using (public.can_write(workspace_id));
drop policy if exists "clés supprimables" on public.tracking_keys;
create policy "clés supprimables" on public.tracking_keys for delete using (public.can_write(workspace_id) and revoked_at is not null);

-- Le hash n'est jamais lisible côté client ; création et révocation passent par les RPC
revoke all on public.tracking_keys from anon, authenticated;
grant select (id, site_id, workspace_id, name, prefix, created_by, created_at, last_used_at, revoked_at) on public.tracking_keys to authenticated;
grant delete on public.tracking_keys to authenticated;

-- Création : renvoie la clé complète (une seule fois)
create or replace function public.create_tracking_key(p_site uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_key text;
  v_id uuid;
begin
  select workspace_id into v_ws from tracking_sites where id = p_site;
  if v_ws is null or not public.can_write(v_ws) then raise exception 'Site introuvable'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Donne un nom à la clé'; end if;
  if (select count(*) from tracking_keys where site_id = p_site and revoked_at is null) >= 20 then
    raise exception 'Limite de 20 clés actives atteinte : révoque celles qui ne servent plus';
  end if;
  v_key := 'sk_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into tracking_keys (site_id, workspace_id, name, prefix, key_hash, created_by)
  values (p_site, v_ws, left(trim(p_name), 80), left(v_key, 9), encode(extensions.digest(v_key, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end $$;

create or replace function public.revoke_tracking_key(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k tracking_keys;
begin
  select * into k from tracking_keys where id = p_id;
  if k.id is null or not public.can_write(k.workspace_id) then raise exception 'Clé introuvable'; end if;
  update tracking_keys set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

revoke execute on function public.create_tracking_key(uuid, text) from anon, public;
revoke execute on function public.revoke_tracking_key(uuid) from anon, public;
grant execute on function public.create_tracking_key(uuid, text) to authenticated;
grant execute on function public.revoke_tracking_key(uuid) to authenticated;

-- Reprise de la clé secrète en place, par son empreinte, puis retrait de la colonne en clair.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tracking_sites' and column_name = 'secret_key') then
    insert into public.tracking_keys (site_id, workspace_id, name, prefix, key_hash)
    select s.id, s.workspace_id, 'Clé d''origine', left(s.secret_key, 9), encode(extensions.digest(s.secret_key, 'sha256'), 'hex')
    from public.tracking_sites s
    on conflict (key_hash) do nothing;
    drop function if exists public.tracking_site_secret(uuid);
    alter table public.tracking_sites drop column secret_key;
  end if;
end $$;

-- =====================================================================
-- 0101_tracking_identity_signals.sql
-- =====================================================================
-- =====================================================================
-- Tracking OS, étape 2 : identité par email ET téléphone, signaux pour le
-- renvoi aux régies.
--
-- 1. visitors.person_id : une personne = tous les visiteurs reliés par un
--    même email ou un même téléphone (un appareil, puis un autre, puis un
--    autre email avec le même numéro). Jusqu'ici la fusion se faisait à la
--    lecture, par email seulement.
-- 2. visitor_signals : ce que Meta et Google demandent pour rapprocher une
--    conversion d'un clic (cookies _fbp / _fbc / _ga, adresse IP et
--    navigateur de la visite). Aucune policy : service role seulement.
--    L'IP est effacée après 30 jours.
-- 3. Les fonctions de lecture regroupent par personne.
-- Rejouable.
-- =====================================================================

alter table public.visitors add column if not exists person_id uuid;
-- Téléphone au format international sans « + » (33612345678), pour le rapprochement
alter table public.visitors add column if not exists phone_e164 text;
create index if not exists visitors_site_person on public.visitors (site_id, person_id) where person_id is not null;
create index if not exists visitors_site_phone on public.visitors (site_id, phone_e164) where phone_e164 is not null;

-- Visiteurs déjà identifiés : une personne par email, comme le faisait la lecture.
with p as (
  select v.site_id, v.email, gen_random_uuid() as pid
  from public.visitors v
  where v.email is not null
  group by v.site_id, v.email
  having bool_and(v.person_id is null)
)
update public.visitors v set person_id = p.pid
from p where v.site_id = p.site_id and v.email = p.email;

-- ---------------------------------------------------------------------
-- Rattache un visiteur à sa personne. Si l'email et le téléphone désignent
-- deux personnes jusque-là distinctes, elles fusionnent : la plus ancienne
-- garde son identifiant. is_new dit si la personne vient d'apparaître.
-- ---------------------------------------------------------------------
create or replace function public.tracking_link_person(p_visitor uuid, p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v visitors;
  known uuid[];
  pid uuid;
begin
  -- Chaîne vide = inconnu (l'appelant n'a pas toujours les deux)
  p_email := nullif(p_email, '');
  p_phone := nullif(p_phone, '');
  select * into v from visitors where id = p_visitor for update;
  if v.id is null then return null; end if;

  select array_agg(distinct x.person_id) into known
  from (
    select o.person_id from visitors o
    where o.site_id = v.site_id and o.person_id is not null
      and ((p_email is not null and o.email = p_email) or (p_phone is not null and o.phone_e164 = p_phone))
    union
    select v.person_id where v.person_id is not null
  ) x;

  if known is null then
    pid := gen_random_uuid();
    update visitors set person_id = pid where id = p_visitor;
    return jsonb_build_object('person_id', pid, 'is_new', true);
  end if;

  select o.person_id into pid from visitors o
  where o.site_id = v.site_id and o.person_id = any(known)
  order by coalesce(o.identified_at, o.first_seen), o.id limit 1;
  pid := coalesce(pid, known[1]);
  update visitors set person_id = pid where site_id = v.site_id and person_id = any(known) and person_id <> pid;
  update visitors set person_id = pid where id = p_visitor and person_id is distinct from pid;
  return jsonb_build_object('person_id', pid, 'is_new', false);
end $$;
revoke execute on function public.tracking_link_person(uuid, text, text) from anon, authenticated, public;
grant execute on function public.tracking_link_person(uuid, text, text) to service_role;

-- Filet pour les écritures qui ne passent pas par tracking_link_person (données de
-- démo, modules voisins) : un visiteur qui reçoit un email rejoint la personne de cet email.
create or replace function public._visitor_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.person_id is null then
    select o.person_id into new.person_id from visitors o
    where o.site_id = new.site_id and o.email = new.email and o.person_id is not null limit 1;
    new.person_id := coalesce(new.person_id, gen_random_uuid());
  end if;
  return new;
end $$;
revoke execute on function public._visitor_person() from anon, authenticated, public;
drop trigger if exists visitor_person on public.visitors;
create trigger visitor_person before insert or update of email on public.visitors
  for each row execute function public._visitor_person();

-- ---------------------------------------------------------------------
-- Signaux publicitaires d'un visiteur
-- ---------------------------------------------------------------------
create table if not exists public.visitor_signals (
  visitor_id uuid primary key references public.visitors(id) on delete cascade,
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fbp text,
  fbc text,
  ga_cid text,
  ip inet,
  ua text,
  seen_at timestamptz not null default now()
);
create index if not exists visitor_signals_ip_age on public.visitor_signals (seen_at) where ip is not null;
-- Aucune policy : ni lecture ni écriture hors service role
alter table public.visitor_signals enable row level security;
revoke all on public.visitor_signals from anon, authenticated;

create or replace function public.tracking_purge_signals()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update visitor_signals set ip = null where ip is not null and seen_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.tracking_purge_signals() from anon, authenticated, public;
grant execute on function public.tracking_purge_signals() to service_role;

-- ---------------------------------------------------------------------
-- Conversions d'une période avec les points de contact de la PERSONNE
-- (tous ses visiteurs, reliés par email ou téléphone) dans la fenêtre.
-- Pour le site de l'agence (company_id null), les deals gagnés du CRM dont
-- le contact a l'email d'un visiteur comptent comme conversion « deal_won ».
-- ---------------------------------------------------------------------
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
    select e.id::text as id, e.ts, e.type, e.name, coalesce(e.value, 0) as value, e.currency, e.source, e.visitor_id
    from tracking_events e
    where e.site_id = p_site and e.type <> 'pageview'
      and exists (select 1 from site)
      and (p_types is null or e.type = any(p_types))
      and e.ts >= p_start::timestamptz and e.ts < (p_end + 1)::timestamptz
    union all
    select 'deal:' || d.id::text, d.closed_at, 'deal_won', d.title, d.value, null, 'crm',
           (select vv.id from visitors vv where vv.site_id = p_site and vv.email = lower(c.email) order by vv.last_seen desc limit 1)
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
  pc as (
    select c.*, v.person_id,
           case when v.person_id is null then array[c.visitor_id]
                else (select array_agg(vv.id) from visitors vv where vv.site_id = p_site and vv.person_id = v.person_id) end as vids
    from conv c
    left join visitors v on v.id = c.visitor_id
  )
  select c.id, c.ts, c.type, c.name, c.value, c.currency, c.source,
         coalesce(c.person_id::text, c.visitor_id::text, c.id) as person,
         (select vv.email from visitors vv where vv.id = any(c.vids) and vv.email is not null order by vv.identified_at desc nulls last limit 1) as email,
         c.visitor_id,
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

-- ---------------------------------------------------------------------
-- Statistiques de trafic : les identifiés et les prospects se comptent par personne.
-- ---------------------------------------------------------------------
create or replace function public.tracking_stats(p_site uuid, p_start date, p_end date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id)) then null else jsonb_build_object(
    'visitors', (select count(distinct t.visitor_id) from touchpoints t
                 where t.site_id = p_site and t.ts >= p_start::timestamptz and t.ts < (p_end + 1)::timestamptz),
    'identified', (select count(*) from (
                     select v.person_id from visitors v where v.site_id = p_site and v.person_id is not null
                     group by v.person_id
                     having min(v.identified_at) >= p_start::timestamptz and min(v.identified_at) < (p_end + 1)::timestamptz) x),
    'leads', (select count(distinct coalesce(v.person_id::text, e.visitor_id::text)) from tracking_events e left join visitors v on v.id = e.visitor_id
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

-- ---------------------------------------------------------------------
-- Personnes identifiées d'un site, avec leurs achats. Une personne peut
-- n'avoir qu'un téléphone (conversion envoyée par un CRM sans email).
-- ---------------------------------------------------------------------
drop function if exists public.tracking_people(uuid, text, int);
create or replace function public.tracking_people(p_site uuid, p_q text default '', p_limit int default 100)
returns table (
  person_id uuid, email text, name text, phone text, visitors int, contact_id uuid,
  first_seen timestamptz, last_seen timestamptz, identified_at timestamptz,
  purchases int, revenue numeric, leads int
)
language sql stable security definer set search_path = public as $$
  with g as (
    select v.person_id,
           (array_agg(v.email order by v.identified_at desc nulls last) filter (where v.email is not null))[1] as email,
           max(v.name) as name, max(v.phone) as phone, count(*)::int as visitors,
           (array_agg(v.contact_id) filter (where v.contact_id is not null))[1] as contact_id,
           min(v.first_seen) as first_seen, max(v.last_seen) as last_seen, min(v.identified_at) as identified_at,
           array_agg(v.id) as ids
    from visitors v
    where v.site_id = p_site and v.person_id is not null
      and exists (select 1 from tracking_sites s where s.id = p_site and public.is_member(s.workspace_id))
    group by v.person_id
    having coalesce(p_q, '') = ''
        or bool_or(v.email ilike '%' || p_q || '%' or v.name ilike '%' || p_q || '%' or v.phone ilike '%' || p_q || '%')
    order by max(v.last_seen) desc
    limit greatest(1, least(p_limit, 500))
  )
  select g.person_id, g.email, g.name, g.phone, g.visitors, g.contact_id, g.first_seen, g.last_seen, g.identified_at,
         (select count(*)::int from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('purchase', 'deal_won')),
         (select coalesce(sum(e.value), 0) from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('purchase', 'deal_won')),
         (select count(*)::int from tracking_events e where e.visitor_id = any(g.ids) and e.type in ('lead', 'booking'))
  from g
  order by g.last_seen desc;
$$;
grant execute on function public.tracking_people(uuid, text, int) to authenticated;
revoke execute on function public.tracking_people(uuid, text, int) from anon, public;
