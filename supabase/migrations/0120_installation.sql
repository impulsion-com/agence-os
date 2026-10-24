-- =====================================================================
-- Installation : tâches planifiées dans Supabase et version du schéma.
--
-- 1. Les tâches planifiées (synchro quotidienne, veille créa, rappels de
--    rendez-vous) ne dépendent plus de l'hébergeur : pg_cron appelle les
--    routes /api/cron/* de l'app par pg_net, avec CRON_SECRET rangé dans le
--    coffre (Vault). Marche sur Hostinger, un VPS ou Vercel (dans ce dernier
--    cas, retirer les crons de vercel.json pour ne pas tout lancer deux fois).
--    Programmation depuis Réglages > Installation (route serveur, service role).
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
    perform cron.schedule(j.name, j.schedule, format(
      $cmd$select net.http_get(url := %L, headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'agence_os_cron_secret')), timeout_milliseconds := %s)$cmd$,
      v_url || j.path, j.timeout_ms));
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

-- État des tâches : programmées ou non, URL visée, dernier passage et sa réponse HTTP (gardée 6 h par pg_net).
create or replace function public.cron_status()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', d.name,
    'path', d.path,
    'schedule', d.schedule,
    'scheduled', c.jobid is not null,
    'url', substring(c.command from 'url := ''([^'']+)'''),
    'last_run', r.start_time,
    'last_status', r.status,
    'last_message', left(r.return_message, 300)
  ) order by d.name), '[]'::jsonb)
  from public._cron_jobs() d
  left join cron.job c on c.jobname = d.name
  left join lateral (
    select x.start_time, x.status, x.return_message from cron.job_run_details x where x.jobid = c.jobid order by x.start_time desc limit 1
  ) r on true
$$;

revoke execute on function public._cron_jobs(), public.cron_install(text, text), public.cron_uninstall(), public.cron_status() from anon, authenticated, public;
grant execute on function public._cron_jobs(), public.cron_install(text, text), public.cron_uninstall(), public.cron_status() to service_role;
