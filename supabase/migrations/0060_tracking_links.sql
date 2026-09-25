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
