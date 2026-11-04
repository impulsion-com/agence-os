-- =====================================================================
-- Docs & process : le wiki de l'agence (process, checklists, documentation).
-- Repris de l'onglet Docs du CRM Impulsion, lui-même sur le modèle de Docmost :
-- des espaces, des pages, des sous-pages sans limite de profondeur, un historique.
--
-- 1. doc_spaces : un espace (Process, Agence, Clients…), avec un emoji.
-- 2. doc_pages : une page. Contenu en HTML Tiptap (relu par l'éditeur, jamais
--    injecté tel quel), texte brut pour la recherche, corbeille (deleted_at).
--    Clés étrangères composites : une page reste dans l'espace de travail de son
--    espace, et dans l'espace de sa page parente. Changer l'espace d'une page
--    emmène ses sous-pages (on update cascade). Un espace qui contient encore des
--    pages, corbeille comprise, ne se supprime pas (no action).
-- 3. doc_versions : l'historique, une version par séance d'écriture (les
--    enregistrements d'une même personne à moins de 10 minutes se fondent).
--    Écrit seulement par doc_save_page : on ne réécrit pas l'histoire depuis le navigateur.
-- 4. RPC : doc_save_page (refuse d'écraser le travail d'un autre, code AO409),
--    doc_move_page, doc_trash_page, doc_restore_page.
-- 5. Démo : deux espaces de process d'exemple (is_demo).
-- Les images sont dans le bucket « attachments », sous <workspace_id>/docs/.
-- Rejouable.
-- =====================================================================

create table if not exists public.doc_spaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  icon text check (icon is null or length(icon) <= 16),
  description text,
  position int not null default 0,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index if not exists doc_spaces_ws on public.doc_spaces (workspace_id, position);

create table if not exists public.doc_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  space_id uuid not null,
  parent_id uuid,
  title text not null default '' check (length(title) <= 300),
  icon text check (icon is null or length(icon) <= 16),
  -- Au-delà, c'est presque toujours une image collée en base64 : elle doit passer par le stockage
  content text not null default '' check (length(content) <= 2000000),
  plain text not null default '',
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  -- Page Notion d'origine : relancer un import complète sans doublonner
  notion_id text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id),
  foreign key (space_id, workspace_id) references public.doc_spaces (id, workspace_id),
  foreign key (parent_id, space_id) references public.doc_pages (id, space_id) on delete cascade on update cascade
);
create index if not exists doc_pages_tree on public.doc_pages (workspace_id, space_id, parent_id, position);
create index if not exists doc_pages_notion on public.doc_pages (workspace_id, notion_id) where notion_id is not null;
create index if not exists doc_pages_recent on public.doc_pages (workspace_id, updated_at desc) where deleted_at is null;

create table if not exists public.doc_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  page_id uuid not null references public.doc_pages(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists doc_versions_page on public.doc_versions (page_id, updated_at desc);

alter table public.doc_spaces enable row level security;
alter table public.doc_pages enable row level security;
alter table public.doc_versions enable row level security;

drop policy if exists "lecture membres" on public.doc_spaces;
drop policy if exists "ajout membres" on public.doc_spaces;
drop policy if exists "modif membres" on public.doc_spaces;
drop policy if exists "suppression membres" on public.doc_spaces;
create policy "lecture membres" on public.doc_spaces for select using (public.is_member(workspace_id));
create policy "ajout membres" on public.doc_spaces for insert with check (public.can_write(workspace_id));
create policy "modif membres" on public.doc_spaces for update using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "suppression membres" on public.doc_spaces for delete using (public.can_write(workspace_id));

drop policy if exists "lecture membres" on public.doc_pages;
drop policy if exists "ajout membres" on public.doc_pages;
drop policy if exists "modif membres" on public.doc_pages;
drop policy if exists "suppression corbeille" on public.doc_pages;
create policy "lecture membres" on public.doc_pages for select using (public.is_member(workspace_id));
create policy "ajout membres" on public.doc_pages for insert with check (public.can_write(workspace_id));
create policy "modif membres" on public.doc_pages for update using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
-- Suppression définitive depuis la corbeille seulement
create policy "suppression corbeille" on public.doc_pages for delete using (public.can_write(workspace_id) and deleted_at is not null);

drop policy if exists "lecture membres" on public.doc_versions;
create policy "lecture membres" on public.doc_versions for select using (public.is_member(workspace_id));

create or replace function public.touch_doc()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists doc_spaces_touch on public.doc_spaces;
create trigger doc_spaces_touch before update on public.doc_spaces for each row execute function public.touch_doc();

-- ---------------------------------------------------------------------
-- Enregistrement d'une page : titre et/ou contenu, avec l'historique.
-- p_read : horodatage de la dernière version lue par l'éditeur. Si quelqu'un
-- d'autre a enregistré depuis, l'écriture est refusée (AO409) : on n'écrase
-- jamais le travail d'un autre en silence. Le conflit se juge sur la dernière
-- version (titre ou contenu), pas sur updated_at : déplacer la page ou changer
-- son icône ne bloque pas celui qui l'a ouverte.
-- Renvoie { version_at } à renvoyer au prochain enregistrement.
-- ---------------------------------------------------------------------
create or replace function public.doc_save_page(p_id uuid, p_title text default null, p_content text default null, p_plain text default null, p_read timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pg doc_pages;
  last_v doc_versions;
  me uuid := auth.uid();
  who text;
begin
  select * into pg from doc_pages where id = p_id;
  if pg.id is null or not public.can_write(pg.workspace_id) then
    raise exception 'Page introuvable ou en lecture seule.' using errcode = '42501';
  end if;
  if p_title is null and p_content is null then
    return jsonb_build_object('version_at', (select max(updated_at) from doc_versions where page_id = p_id));
  end if;

  select * into last_v from doc_versions where page_id = p_id order by updated_at desc limit 1;
  if p_read is not null and last_v.id is not null and last_v.author_id is distinct from me and p_read < last_v.updated_at then
    select full_name into who from profiles where id = last_v.author_id;
    raise exception '% a modifié cette page entre-temps. Recharge-la avant de continuer.', coalesce(nullif(who, ''), 'Quelqu''un') using errcode = 'AO409';
  end if;

  update doc_pages set
    title = coalesce(btrim(p_title), title),
    content = coalesce(p_content, content),
    plain = case when p_content is null then plain else coalesce(p_plain, '') end,
    updated_by = me,
    updated_at = now()
  where id = p_id
  returning * into pg;

  select * into last_v from doc_versions where page_id = p_id order by created_at desc limit 1;
  if last_v.id is not null and last_v.author_id is not distinct from me and now() - last_v.updated_at < interval '10 minutes' then
    update doc_versions set title = pg.title, content = pg.content, updated_at = now() where id = last_v.id;
  elsif last_v.id is null or last_v.content <> pg.content or last_v.title <> pg.title then
    insert into doc_versions (workspace_id, page_id, title, content, author_id) values (pg.workspace_id, p_id, pg.title, pg.content, me);
  end if;
  return jsonb_build_object('version_at', (select max(updated_at) from doc_versions where page_id = p_id), 'updated_at', pg.updated_at);
end $$;
revoke execute on function public.doc_save_page(uuid, text, text, text, timestamptz) from anon, public;
grant execute on function public.doc_save_page(uuid, text, text, text, timestamptz) to authenticated;

-- Sous-pages d'une page, à toute profondeur (la page comprise)
create or replace function public._doc_subtree(p_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive t(id) as (
    select p_id
    union all
    select d.id from doc_pages d join t on d.parent_id = t.id
  )
  select id from t;
$$;
revoke execute on function public._doc_subtree(uuid) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Déplacement : sous une autre page (p_parent), ou à la racine d'un espace
-- (p_parent null, p_space). p_order : les pages sœurs dans l'ordre voulu, la
-- page déplacée comprise. Les sous-pages suivent dans le nouvel espace.
-- ---------------------------------------------------------------------
create or replace function public.doc_move_page(p_id uuid, p_space uuid default null, p_parent uuid default null, p_order uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  pg doc_pages;
  target_space uuid;
begin
  select * into pg from doc_pages where id = p_id;
  if pg.id is null or not public.can_write(pg.workspace_id) then
    raise exception 'Page introuvable ou en lecture seule.' using errcode = '42501';
  end if;
  if p_parent is not null then
    if p_parent in (select _doc_subtree(p_id)) then
      raise exception 'Une page ne peut pas devenir sa propre sous-page.';
    end if;
    select space_id into target_space from doc_pages where id = p_parent and workspace_id = pg.workspace_id;
    if target_space is null then raise exception 'Page parente introuvable.'; end if;
  else
    target_space := coalesce(p_space, pg.space_id);
    if not exists (select 1 from doc_spaces where id = target_space and workspace_id = pg.workspace_id) then
      raise exception 'Espace introuvable.';
    end if;
  end if;

  if p_parent is distinct from pg.parent_id or target_space <> pg.space_id then
    update doc_pages set
      parent_id = p_parent,
      space_id = target_space,
      position = coalesce((select max(position) + 1 from doc_pages where space_id = target_space and parent_id is not distinct from p_parent), 0)
    where id = p_id;
  end if;

  if p_order is not null then
    update doc_pages d set position = o.ord::int
    from unnest(p_order) with ordinality as o(id, ord)
    where d.id = o.id and d.workspace_id = pg.workspace_id and d.space_id = target_space and d.parent_id is not distinct from p_parent;
  end if;
end $$;
revoke execute on function public.doc_move_page(uuid, uuid, uuid, uuid[]) from anon, public;
grant execute on function public.doc_move_page(uuid, uuid, uuid, uuid[]) to authenticated;

-- Corbeille : la page part avec ses sous-pages, au même instant (c'est ce qui
-- permet de les restaurer ensemble). Renvoie le nombre de pages.
create or replace function public.doc_trash_page(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  n int;
begin
  select workspace_id into ws from doc_pages where id = p_id;
  if ws is null or not public.can_write(ws) then
    raise exception 'Page introuvable ou en lecture seule.' using errcode = '42501';
  end if;
  update doc_pages set deleted_at = now() where id in (select _doc_subtree(p_id)) and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.doc_trash_page(uuid) from anon, public;
grant execute on function public.doc_trash_page(uuid) to authenticated;

-- Restaure une page et les sous-pages parties avec elle. Si sa parente est
-- encore à la corbeille, elle revient à la racine de son espace.
create or replace function public.doc_restore_page(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pg doc_pages;
begin
  select * into pg from doc_pages where id = p_id;
  if pg.id is null or not public.can_write(pg.workspace_id) then
    raise exception 'Page introuvable ou en lecture seule.' using errcode = '42501';
  end if;
  if pg.deleted_at is null then return; end if;
  update doc_pages set deleted_at = null where id in (select _doc_subtree(p_id)) and deleted_at = pg.deleted_at;
  if exists (select 1 from doc_pages where id = pg.parent_id and deleted_at is not null) then
    update doc_pages set
      parent_id = null,
      position = coalesce((select max(position) + 1 from doc_pages where space_id = pg.space_id and parent_id is null), 0)
    where id = p_id;
  end if;
end $$;
revoke execute on function public.doc_restore_page(uuid) from anon, public;
grant execute on function public.doc_restore_page(uuid) to authenticated;

create or replace function public.schema_version()
returns int language sql immutable as $$ select 122 $$;
grant execute on function public.schema_version() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Démo : deux espaces de process d'agence, prêts à être adaptés.
-- ---------------------------------------------------------------------
create or replace function public._clear_demo_docs(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Les pages ajoutées à la main dans un espace de démo restent, l'espace aussi
  delete from doc_pages where workspace_id = ws and is_demo and parent_id is null;
  delete from doc_pages where workspace_id = ws and is_demo;
  delete from doc_spaces s where s.workspace_id = ws and s.is_demo and not exists (select 1 from doc_pages p where p.space_id = s.id);
end $$;
revoke execute on function public._clear_demo_docs(uuid) from anon, authenticated, public;

create or replace function public._demo_docs(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := coalesce(auth.uid(), (select user_id from workspace_members where workspace_id = ws order by (role = 'owner') desc, joined_at limit 1));
  s_proc uuid; s_ag uuid; p_onb uuid; p uuid;
  r record;
begin
  perform _clear_demo_docs(ws);
  insert into doc_spaces (workspace_id, name, icon, description, position, is_demo, created_by)
    values (ws, 'Process', '📋', 'Comment on travaille, étape par étape. La référence quand on a un doute.', 0, true, me) returning id into s_proc;
  insert into doc_spaces (workspace_id, name, icon, description, position, is_demo, created_by)
    values (ws, 'Agence', '🏢', 'Conventions, outils et accès de l''équipe.', 1, true, me) returning id into s_ag;

  for r in select * from (values
    (1, 'proc', null::int, 'Onboarding d''un nouveau client', '🚀',
     '<p>Le premier mois fait la relation. Ce process part de la signature et s''arrête au premier reporting. On coche au fur et à mesure, dans cette page ou dans le projet du client.</p>'
     '<h2>Semaine 1 : accès et kick-off</h2>'
     '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Envoyer le formulaire d''onboarding (brief, objectifs, fichiers)</p></li>'
     '<li data-type="taskItem" data-checked="true"><p>Caler le kick-off (45 min, visio) dans les 5 jours après signature</p></li>'
     '<li data-type="taskItem" data-checked="false"><p>Récupérer tous les accès : voir la <a href="#acces">checklist des accès</a></p></li>'
     '<li data-type="taskItem" data-checked="false"><p>Créer le projet client depuis le modèle « Lancement »</p></li></ul>'
     '<h2>Semaine 2 : audit</h2>'
     '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Audit du tracking : pixel, API de conversions, événements GA4, consentement</p></li>'
     '<li data-type="taskItem" data-checked="false"><p>Audit des comptes : structure, budgets, historique des 90 derniers jours</p></li>'
     '<li data-type="taskItem" data-checked="false"><p>Restitution au client avec 3 priorités, pas 15</p></li></ul>'
     '<h2>Semaines 3 et 4 : lancement</h2>'
     '<p>On suit le process <strong>Lancement d''une campagne Meta</strong>. Premier point hebdo à J+7 après le lancement, premier reporting mensuel à la fin du mois.</p>'
     '<blockquote><p>Règle d''or : rien ne part en ligne sans tracking vérifié. Une campagne sans mesure, c''est un budget perdu et un client qui doute.</p></blockquote>'),
    (2, 'proc', 1, 'Checklist des accès', '🔑',
     '<p>À demander dès la signature. Toujours en accès partenaire, jamais avec les identifiants du client.</p>'
     '<table><tbody><tr><th><p>Plateforme</p></th><th><p>Accès</p></th><th><p>Comment</p></th></tr>'
     '<tr><td><p>Meta Business Manager</p></td><td><p>Partenaire, contrôle total sur le compte pub, le pixel et la page</p></td><td><p>Le client ajoute l''ID de notre BM dans Paramètres, Partenaires</p></td></tr>'
     '<tr><td><p>Google Ads</p></td><td><p>Administrateur, via notre compte MCC</p></td><td><p>On envoie la demande depuis le MCC, le client accepte</p></td></tr>'
     '<tr><td><p>Google Analytics 4</p></td><td><p>Éditeur</p></td><td><p>Gestion des accès de la propriété</p></td></tr>'
     '<tr><td><p>Google Tag Manager</p></td><td><p>Publication</p></td><td><p>Gestion des utilisateurs du conteneur</p></td></tr>'
     '<tr><td><p>Shopify ou CMS</p></td><td><p>Collaborateur</p></td><td><p>Code collaborateur envoyé par le client</p></td></tr></tbody></table>'),
    (3, 'proc', null, 'Lancement d''une campagne Meta', '📣',
     '<p>De la stratégie validée au premier euro dépensé. Compter 3 à 5 jours selon les créas.</p>'
     '<ol><li><p><strong>Plan média validé</strong> : objectif, budget, audiences, calendrier.</p></li>'
     '<li><p><strong>Créas</strong> : au moins 3 angles différents, chacun en 1:1, 4:5 et 9:16. Nommées selon la <em>nomenclature</em> (espace Agence).</p></li>'
     '<li><p><strong>Tracking vérifié</strong> : événement de conversion reçu dans le gestionnaire d''événements, qualité de correspondance au-dessus de 6.</p></li>'
     '<li><p><strong>Liens trackés</strong> : UTM générés depuis Agence OS, jamais tapés à la main.</p></li>'
     '<li><p><strong>Relecture à deux</strong> : budgets, dates, exclusions, liens. Une faute de budget coûte plus cher qu''une faute d''orthographe.</p></li>'
     '<li><p><strong>Mise en ligne</strong> et message au client avec ce qui tourne et quand on fait le premier point.</p></li></ol>'
     '<h3>Les 72 premières heures</h3>'
     '<p>On ne touche à rien avant 3 jours, sauf erreur évidente (lien cassé, budget faux, refus de diffusion). La phase d''apprentissage a besoin de calme.</p>'),
    (4, 'proc', null, 'Reporting mensuel', '📊',
     '<p>Un rapport qui se lit en deux minutes, et un appel de 30 minutes pour en parler.</p>'
     '<ul><li><p><strong>J+2</strong> : vérifier la synchro Meta et Google dans Reporting, comparer avec le tracking (Attribution).</p></li>'
     '<li><p><strong>J+3</strong> : rédiger l''analyse. Trois parties : ce qui a marché, ce qui n''a pas marché, ce qu''on fait le mois prochain.</p></li>'
     '<li><p><strong>J+4</strong> : partager le rapport par lien, puis appel client.</p></li></ul>'
     '<p>Le chiffre qui compte, c''est celui du client (ventes, rendez-vous), pas le ROAS de la plateforme. Quand les deux divergent, on l''explique.</p>'),
    (5, 'ag', null, 'Nomenclature des campagnes et des créas', '🏷️',
     '<p>Tout le monde nomme pareil, sinon l''analyse créa ne sait pas lire les annonces. Format des noms d''annonces :</p>'
     '<pre><code>F:UGC | A:Routine | H:Avant-après | C:Léa | Nom libre</code></pre>'
     '<table><tbody><tr><th><p>Préfixe</p></th><th><p>Propriété</p></th><th><p>Exemples</p></th></tr>'
     '<tr><td><p>F</p></td><td><p>Format</p></td><td><p>UGC, Statique, Carrousel, Motion, DPA</p></td></tr>'
     '<tr><td><p>A</p></td><td><p>Angle</p></td><td><p>Problème, Preuve sociale, Offre, Routine</p></td></tr>'
     '<tr><td><p>H</p></td><td><p>Accroche</p></td><td><p>Douleur, Avis, Témoignage, Promo</p></td></tr>'
     '<tr><td><p>C</p></td><td><p>Créateur</p></td><td><p>Prénom du créateur UGC</p></td></tr></tbody></table>'
     '<p>Les campagnes : <code>Client | Objectif | Audience | AAAA-MM</code>.</p>'),
    (6, 'ag', null, 'Outils et accès de l''équipe', '🧰',
     '<p>Ce qu''on utilise, et pour quoi. Les mots de passe ne vont <strong>jamais</strong> ici : ils sont dans le gestionnaire de mots de passe partagé.</p>'
     '<ul><li><p><strong>Agence OS</strong> : projets, CRM, reporting, docs (tu es ici).</p></li>'
     '<li><p><strong>Slack</strong> : un canal par client, préfixé <code>client-</code>.</p></li>'
     '<li><p><strong>Google Drive</strong> : un dossier par client, partagé en lecture avec lui.</p></li>'
     '<li><p><strong>Canva</strong> : les kits de marque des clients, un dossier chacun.</p></li></ul>')
  ) v(n, sp, parent_n, title, icon, html) order by n
  loop
    insert into doc_pages (workspace_id, space_id, parent_id, title, icon, content, plain, position, created_by, updated_by, is_demo, created_at, updated_at)
    values (
      ws, case r.sp when 'proc' then s_proc else s_ag end,
      case when r.parent_n = 1 then p_onb end,
      r.title, r.icon, r.html,
      btrim(regexp_replace(regexp_replace(replace(r.html, '&nbsp;', ' '), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')),
      r.n, me, me, true, now() - make_interval(days => 12 - r.n), now() - make_interval(days => 6 - r.n % 5, hours => r.n)
    ) returning id into p;
    if r.n = 1 then p_onb := p; end if;
    insert into doc_versions (workspace_id, page_id, title, content, author_id, created_at, updated_at)
      values (ws, p, r.title, r.html, me, now() - make_interval(days => 6 - r.n % 5, hours => r.n), now() - make_interval(days => 6 - r.n % 5, hours => r.n));
  end loop;
  -- Le lien interne de l'onboarding pointe vers la checklist créée juste après
  update doc_pages d set content = replace(d.content, 'href="#acces"', 'href="/w/' || w.slug || '/docs/' || c.id || '"')
    from doc_pages c, workspaces w
    where d.id = p_onb and c.parent_id = p_onb and c.title = 'Checklist des accès' and w.id = ws;
end $$;
revoke execute on function public._demo_docs(uuid) from anon, authenticated, public;
grant execute on function public._demo_docs(uuid) to service_role;

create or replace function public.clear_demo_docs(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(ws) then raise exception 'réservé aux admins de l''espace'; end if;
  perform _clear_demo_docs(ws);
end $$;
revoke execute on function public.clear_demo_docs(uuid) from anon, public;
