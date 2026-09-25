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
