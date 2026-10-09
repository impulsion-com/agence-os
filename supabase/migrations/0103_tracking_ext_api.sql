-- =====================================================================
-- Tracking OS, étape 5 : API de lecture pour l'extension Chrome.
--
-- 1. Un jeton personnel peut avoir la portée « ext » : il n'ouvre que
--    /api/ext/v1 (les chiffres d'attribution, en lecture), jamais le serveur
--    MCP. C'est la clé qu'on colle dans une extension de navigateur : elle
--    doit donner le moins possible.
-- 2. tracking_ad_referential : campagnes, ensembles et publicités connus pour
--    des comptes publicitaires, toutes dates confondues. L'extension en a
--    besoin pour distinguer « 0 vente » de « entité inconnue ».
-- Rejouable.
-- =====================================================================

alter table public.api_tokens drop constraint if exists api_tokens_scope_check;
alter table public.api_tokens add constraint api_tokens_scope_check check (scope in ('read', 'write', 'ext'));

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
  if v_scope not in ('read', 'write', 'ext') then raise exception 'Portée inconnue'; end if;
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


revoke execute on function public.create_api_token(uuid, text, text, timestamptz) from anon, public;
grant execute on function public.create_api_token(uuid, text, text, timestamptz) to authenticated;

create or replace function public.tracking_ad_referential(p_accounts uuid[])
returns table (level text, external_id text, parent_id text, name text, ad_account_id uuid)
language sql stable security definer set search_path = public as $$
  select 'campaign', m.campaign_id, null::text, max(m.campaign_name), m.ad_account_id
  from ad_metrics_daily m where m.ad_account_id = any(p_accounts) and m.campaign_id <> ''
  group by m.ad_account_id, m.campaign_id
  union
  select 'campaign', a.campaign_id, null::text, max(a.campaign_name), a.ad_account_id
  from ad_ads a where a.ad_account_id = any(p_accounts) and coalesce(a.campaign_id, '') <> ''
    and not exists (select 1 from ad_metrics_daily m where m.ad_account_id = a.ad_account_id and m.campaign_id = a.campaign_id)
  group by a.ad_account_id, a.campaign_id
  union all
  select 'adset', a.adset_id, max(a.campaign_id), max(a.adset_name), a.ad_account_id
  from ad_ads a where a.ad_account_id = any(p_accounts) and coalesce(a.adset_id, '') <> ''
  group by a.ad_account_id, a.adset_id
  union all
  select 'ad', a.ad_id, a.adset_id, a.name, a.ad_account_id
  from ad_ads a where a.ad_account_id = any(p_accounts);
$$;
revoke execute on function public.tracking_ad_referential(uuid[]) from anon, authenticated, public;
grant execute on function public.tracking_ad_referential(uuid[]) to service_role;
