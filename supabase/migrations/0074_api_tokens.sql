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
