-- Permet d'embarquer le profil dans les requêtes PostgREST (workspace_members → profiles)
alter table public.workspace_members
  add constraint workspace_members_profile_fk foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.invitations
  add constraint invitations_email_ws unique (workspace_id, email);
