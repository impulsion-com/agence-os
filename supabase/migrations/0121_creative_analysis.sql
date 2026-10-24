-- =====================================================================
-- Analyse créa façon Motion : nomenclature et même créa sur plusieurs annonces.
--
-- 1. workspaces.creative_naming : comment lire les propriétés d'une annonce
--    dans son nom (préfixes « F:UGC | A:Routine » ou positions « UGC_Routine »).
--    Null = préfixes détectés automatiquement. Modifiable par les admins (policy
--    « espace modifiable » existante).
-- 2. ad_ads.asset_key : identifiant de la vidéo ou de l'image diffusée
--    (Meta : v:<video_id> ou i:<image_hash> ; Google : yt:<id YouTube>), pour
--    juger une créa sur l'ensemble des annonces qui la diffusent.
-- 3. Démo : noms d'annonces avec nomenclature et une vidéo diffusée dans deux
--    ensembles, posés en dernière étape du chargement (après le tracking, qui
--    calcule ses identifiants à partir des noms d'origine).
-- Rejouable.
-- =====================================================================

alter table public.workspaces add column if not exists creative_naming jsonb;
alter table public.ad_ads add column if not exists asset_key text;
create index if not exists ad_ads_asset on public.ad_ads (workspace_id, asset_key) where asset_key is not null;

create or replace function public.schema_version()
returns int language sql immutable as $$ select 121 $$;
grant execute on function public.schema_version() to authenticated, service_role;

create or replace function public._demo_creative_naming(ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select * from (values
      ('Avant après sérum', 'F:UGC | A:Transformation | H:Avant-après | C:Léa | Avant après sérum'),
      ('Avis clientes 4,9', 'F:Statique | A:Preuve sociale | H:Avis | Avis clientes 4,9'),
      ('Carrousel best-sellers', 'F:Carrousel | A:Best-sellers | H:Produit | Carrousel best-sellers'),
      ('DPA carrousel', 'F:DPA | A:Catalogue | H:Produit | DPA carrousel'),
      ('DPA collection', 'F:DPA | A:Catalogue | H:Produit | DPA collection'),
      ('Hook peau qui tiraille', 'F:UGC | A:Problème | H:Douleur | C:Inès | Hook peau qui tiraille'),
      ('Lampadaire Arc statique', 'F:Statique | A:Design | H:Produit | Lampadaire Arc statique'),
      ('Motion ingrédients', 'F:Motion | A:Ingrédients | H:Ingrédient | Motion ingrédients'),
      ('Motion lampadaire Arc', 'F:Motion | A:Design | H:Produit | Motion lampadaire Arc'),
      ('Offre retour panier', 'F:Statique | A:Offre | H:Promo | Offre retour panier'),
      ('Statique avis 4,8', 'F:Statique | A:Preuve sociale | H:Avis | Statique avis 4,8'),
      ('Statique cadeau Noël', 'F:Statique | A:Saison | H:Cadeau | Statique cadeau Noël'),
      ('Témoignage Inès', 'F:UGC | A:Preuve sociale | H:Témoignage | C:Inès | Témoignage Inès'),
      ('UGC 3 erreurs routine', 'F:UGC | A:Problème | H:Erreurs | C:Léa | UGC 3 erreurs routine'),
      ('UGC cocooning soirée', 'F:UGC | A:Cocooning | H:Ambiance | C:Claire | UGC cocooning soirée'),
      ('UGC routine du soir', 'F:UGC | A:Routine | H:Routine | C:Léa | UGC routine du soir'),
      ('UGC Suspension Opale', 'F:UGC | A:Cocooning | H:Ambiance | C:Claire | UGC Suspension Opale'),
      ('Vidéo atelier', 'F:Vidéo | A:Savoir-faire | H:Coulisses | Vidéo atelier')
    ) v(old_name, new_name)
  loop
    update ad_ads a set name = r.new_name
      from ad_accounts c where c.id = a.ad_account_id and c.workspace_id = ws and c.external_id like 'demo-%' and a.name = r.old_name;
    update ad_metrics_ad_daily m set ad_name = r.new_name
      from ad_accounts c where c.id = m.ad_account_id and c.workspace_id = ws and c.external_id like 'demo-%' and m.ad_name = r.old_name;
  end loop;
  -- Une créa par annonce, sauf la vidéo Opale diffusée dans deux ensembles sous deux noms
  update ad_ads a set asset_key = case
      when a.name like '%UGC Suspension Opale' or a.name like '%UGC cocooning soirée' then 'v:demo-opale'
      when a.format = 'video' then 'v:demo-' || a.ad_id
      when a.format = 'image' then 'i:demo-' || a.ad_id
      else null end
    from ad_accounts c where c.id = a.ad_account_id and c.workspace_id = ws and c.external_id like 'demo-%';
  update workspaces set creative_naming = jsonb_build_object(
      'mode', 'prefix', 'separator', '|',
      'fields', jsonb_build_array(
        jsonb_build_object('key', 'F', 'label', 'Format'), jsonb_build_object('key', 'A', 'label', 'Angle'),
        jsonb_build_object('key', 'H', 'label', 'Accroche'), jsonb_build_object('key', 'C', 'label', 'Créateur')))
    where id = ws and creative_naming is null;
end $$;
revoke execute on function public._demo_creative_naming(uuid) from anon, authenticated, public;
grant execute on function public._demo_creative_naming(uuid) to service_role;

-- Retrait de la démo : on oublie la nomenclature de démo, sinon les vraies annonces seraient lues
-- avec ses seuls préfixes F, A, H, C et son séparateur imposé.
create or replace function public._clear_demo_creative_naming(ws uuid)
returns void language sql security definer set search_path = public as $$
  update workspaces set creative_naming = null
  where id = ws and creative_naming = jsonb_build_object(
      'mode', 'prefix', 'separator', '|',
      'fields', jsonb_build_array(
        jsonb_build_object('key', 'F', 'label', 'Format'), jsonb_build_object('key', 'A', 'label', 'Angle'),
        jsonb_build_object('key', 'H', 'label', 'Accroche'), jsonb_build_object('key', 'C', 'label', 'Créateur')))
$$;
revoke execute on function public._clear_demo_creative_naming(uuid) from anon, authenticated, public;
grant execute on function public._clear_demo_creative_naming(uuid) to service_role;
