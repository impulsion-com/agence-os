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
