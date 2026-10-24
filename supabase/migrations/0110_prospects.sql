-- =====================================================================
-- Prospection : fiches d'entreprises importées (Google Maps via gosom/google-maps-scraper,
-- par fichier CSV ou par l'outil MCP import_prospects), triées avant d'entrer au CRM.
-- Séparée de `companies` : une recherche peut ramener des milliers de fiches, le CRM
-- ne reçoit que celles qu'on retient (« Ajouter au CRM »).
-- Additive : ne modifie aucune table existante.
-- =====================================================================

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- google_maps (export gosom) ou manual
  source text not null default 'google_maps',
  -- identifiant stable chez la source (place_id Google), sert au dédoublonnage
  external_id text not null default '',
  name text not null,
  category text not null default '',
  address text not null default '',
  city text not null default '',
  postal_code text not null default '',
  country text not null default '',
  phone text not null default '',
  website text not null default '',
  emails text[] not null default '{}',
  rating numeric(2,1),
  reviews integer,
  maps_url text not null default '',
  latitude double precision,
  longitude double precision,
  -- recherche qui a trouvé la fiche (« agence marketing Lyon »)
  search text not null default '',
  -- new : à trier ; added : ajouté au CRM ; ignored : écarté
  status text not null default 'new' check (status in ('new','added','ignored')),
  company_id uuid references public.companies(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists prospects_ws_external on public.prospects (workspace_id, source, external_id) where external_id <> '';
create index if not exists prospects_ws_status on public.prospects (workspace_id, status, created_at desc);

alter table public.prospects enable row level security;
drop policy if exists "lecture membres" on public.prospects;
drop policy if exists "ajout membres" on public.prospects;
drop policy if exists "modif membres" on public.prospects;
drop policy if exists "suppr membres" on public.prospects;
create policy "lecture membres" on public.prospects for select using (public.is_member(workspace_id));
create policy "ajout membres" on public.prospects for insert with check (public.can_write(workspace_id));
create policy "modif membres" on public.prospects for update using (public.can_write(workspace_id));
create policy "suppr membres" on public.prospects for delete using (public.can_write(workspace_id));
