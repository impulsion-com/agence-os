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
