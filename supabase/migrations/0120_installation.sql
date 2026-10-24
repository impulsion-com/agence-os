-- =====================================================================
-- Installation : tâches planifiées dans Supabase et version du schéma.
--
-- 1. Les tâches planifiées (synchro quotidienne, veille créa, rappels de
--    rendez-vous) ne dépendent plus de l'hébergeur : pg_cron appelle les
--    routes /api/cron/* de l'app par pg_net, avec CRON_SECRET rangé dans le
--    coffre (Vault). Marche sur Hostinger, un VPS ou Vercel (les crons de
--    vercel.json sont retirés pour ne pas tout lancer deux fois).
--    Programmation depuis Réglages > Installation (route serveur, service role).
--    pg_net ne fait que mettre la requête en file : chaque appel est noté dans
--    cron_calls pour relire ensuite son vrai code HTTP (401 si le secret a
--    changé, 5xx si l'app plante) dans net._http_response, gardée 6 h.
-- 2. schema_version() : numéro de la dernière migration appliquée. La page
--    Installation le compare à celui qu'attend le code et liste les fichiers
--    à exécuter après une mise à jour. Chaque migration le met à jour.
-- Rejouable. Disponible sur l'offre gratuite de Supabase.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.schema_version()
returns int language sql immutable as $$ select 120 $$;
grant execute on function public.schema_version() to authenticated, service_role;

-- Les trois tâches et leur rythme (UTC). Un seul endroit à modifier.
create or replace function public._cron_jobs()
returns table (name text, path text, schedule text, timeout_ms int)
language sql immutable as $$
  values
    ('agence-os-sync', '/api/cron/sync', '0 5 * * *', 300000),
    ('agence-os-creative-intel', '/api/cron/creative-intel', '30 5 * * *', 300000),
    ('agence-os-booking-reminders', '/api/cron/booking-reminders', '*/15 * * * *', 60000)
$$;

-- URL appelée par une tâche, lue dans sa commande « select public._cron_call('<url>', <délai>) »
create or replace function public._cron_url(p_command text)
returns text language sql immutable as $$ select substring(p_command from '_cron_call\(''([^'']+)''') $$;

-- Journal des appels (aucune policy : lecture par le service role seulement)
create table if not exists public.cron_calls (
  request_id bigint primary key,
  url text not null,
  created_at timestamptz not null default now()
);
alter table public.cron_calls enable row level security;
create index if not exists cron_calls_url on public.cron_calls (url, created_at desc);

-- Appel d'une route /api/cron/* avec le secret relu dans Vault. Garde les 20 derniers appels par URL.
create or replace function public._cron_call(p_url text, p_timeout_ms int)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint;
begin
  select net.http_get(
    url := p_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'agence_os_cron_secret')),
    timeout_milliseconds := p_timeout_ms
  ) into v_id;
  insert into public.cron_calls (request_id, url) values (v_id, p_url) on conflict do nothing;
  delete from public.cron_calls c where c.url = p_url and c.request_id not in (
    select x.request_id from public.cron_calls x where x.url = p_url order by x.created_at desc limit 20
  );
  return v_id;
end $$;

-- Programme (ou reprogramme) les tâches : l'URL de l'app et le secret viennent du serveur,
-- jamais d'un utilisateur. Le secret est dans Vault ; la commande le relit à chaque appel.
create or replace function public.cron_install(p_app_url text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := rtrim(coalesce(p_app_url, ''), '/');
  v_id uuid;
  j record;
begin
  if v_url !~ '^https?://' then raise exception 'URL de l''application invalide'; end if;
  if length(coalesce(p_secret, '')) < 16 then raise exception 'CRON_SECRET trop court (16 caractères minimum)'; end if;
  select id into v_id from vault.secrets where name = 'agence_os_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'agence_os_cron_secret', 'CRON_SECRET d''Agence OS (tâches planifiées)');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
  for j in select * from public._cron_jobs() loop
    perform cron.schedule(j.name, j.schedule, format('select public._cron_call(%L, %s)', v_url || j.path, j.timeout_ms));
  end loop;
  return public.cron_status();
end $$;

create or replace function public.cron_uninstall()
returns void language plpgsql security definer set search_path = public as $$
declare j record;
begin
  for j in select c.jobname from cron.job c where c.jobname in (select name from public._cron_jobs()) loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

-- Appel immédiat de la tâche la plus légère (rappels de rendez-vous) pour le bouton « Tester » :
-- vérifie d'un coup l'URL programmée, le secret de Vault et la réponse de l'app.
create or replace function public.cron_ping()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select public._cron_url(c.command) into v_url from cron.job c where c.jobname = 'agence-os-booking-reminders';
  if v_url is null then raise exception 'Tâches non programmées'; end if;
  return public._cron_call(v_url, 60000);
end $$;

-- Réponse HTTP d'un appel (null tant qu'elle n'est pas arrivée).
create or replace function public.cron_response(p_request bigint)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('status', r.status_code, 'timed_out', r.timed_out, 'error', r.error_msg, 'body', left(r.content, 300))
  from net._http_response r where r.id = p_request
$$;

-- État des tâches : programmées ou non, URL visée, dernier appel et sa réponse HTTP.
create or replace function public.cron_status()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', d.name,
    'path', d.path,
    'schedule', d.schedule,
    'scheduled', c.jobid is not null,
    'url', public._cron_url(c.command),
    'last_run', l.created_at,
    'last_http', r.status_code,
    'last_error', coalesce(r.error_msg, case when r.timed_out then 'délai dépassé' end)
  ) order by d.name), '[]'::jsonb)
  from public._cron_jobs() d
  left join cron.job c on c.jobname = d.name
  left join lateral (
    select x.request_id, x.created_at from public.cron_calls x where x.url = public._cron_url(c.command) order by x.created_at desc limit 1
  ) l on true
  left join net._http_response r on r.id = l.request_id
$$;

revoke execute on function public._cron_jobs(), public._cron_url(text), public._cron_call(text, int), public.cron_install(text, text),
  public.cron_uninstall(), public.cron_ping(), public.cron_response(bigint), public.cron_status() from anon, authenticated, public;
grant execute on function public._cron_jobs(), public._cron_url(text), public._cron_call(text, int), public.cron_install(text, text),
  public.cron_uninstall(), public.cron_ping(), public.cron_response(bigint), public.cron_status() to service_role;
