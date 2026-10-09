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
