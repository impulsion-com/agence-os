-- Les fonctions utilitaires RLS ne doivent pas être appelables par le rôle anonyme.
revoke execute on function public.is_member(uuid) from anon, public;
revoke execute on function public.has_role(uuid, public.member_role[]) from anon, public;
revoke execute on function public.can_write(uuid) from anon, public;
revoke execute on function public.is_admin(uuid) from anon, public;
revoke execute on function public.shares_workspace(uuid) from anon, public;
revoke execute on function public.task_ws(uuid) from anon, public;
revoke execute on function public.project_ws(uuid) from anon, public;
revoke execute on function public.proposal_ws(uuid) from anon, public;
revoke execute on function public.create_workspace(text, text) from anon, public;
revoke execute on function public.accept_invitation(text) from anon, public;
grant execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]), public.can_write(uuid),
  public.is_admin(uuid), public.shares_workspace(uuid), public.task_ws(uuid), public.project_ws(uuid),
  public.proposal_ws(uuid), public.create_workspace(text, text), public.accept_invitation(text) to authenticated;
