-- Agence OS : installation complète (généré par scripts/build-setup-sql.mjs, ne pas modifier à la main)
-- Migrations incluses : 0001_schema.sql, 0002_member_profile_fk.sql, 0003_demo_data.sql, 0005_revoke_anon_helpers.sql, 0020_workspace_notifications.sql, 0040_proposals.sql, 0050_reporting.sql, 0060_tracking_links.sql, 0061_tracking_attribution.sql, 0062_links.sql, 0063_tracking_secret.sql, 0064_demo_tracking_chunks.sql

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
