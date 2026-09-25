-- La clé secrète d'un site suivi ne doit pas être lisible par un invité :
-- privilège par colonne (tout sauf secret_key), et lecture via une fonction réservée aux non-invités.
revoke select on public.tracking_sites from anon, authenticated;
grant select (id, workspace_id, company_id, name, domains, public_key, settings, last_event_at, created_at)
  on public.tracking_sites to authenticated;

create or replace function public.tracking_site_secret(p_site uuid)
returns text language sql stable security definer set search_path = public as $$
  select secret_key from tracking_sites where id = p_site and public.can_write(workspace_id);
$$;
revoke execute on function public.tracking_site_secret(uuid) from anon, public;
grant execute on function public.tracking_site_secret(uuid) to authenticated;
