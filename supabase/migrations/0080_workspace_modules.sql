-- Modules activés par espace (null = tous, pour les espaces existants).
-- Ergonomie seulement : la RLS reste la protection des données.
alter table public.workspaces add column if not exists modules text[];
