-- Gestion des administrateurs à permissions limitées et suivi des sessions.
create table if not exists public.aurore_admin_permissions (
  user_id uuid primary key references public."Profils"(id) on delete cascade,
  permissions text[] not null default '{}',
  updated_by uuid references public."Profils"(id),
  updated_at timestamptz not null default now(),
  constraint aurore_admin_permissions_valid check (
    permissions <@ array['users','connections','documents','reports','deposits','visitors']::text[]
  )
);
alter table public.aurore_admin_permissions enable row level security;
drop policy if exists aurore_admin_permissions_owner_only on public.aurore_admin_permissions;
create policy aurore_admin_permissions_owner_only on public.aurore_admin_permissions
for all using (auth.uid()='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid)
with check (auth.uid()='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid);

create or replace function public.has_admin_permission(p_permission text)
returns boolean language sql stable security definer
set search_path='public','auth','pg_temp' as $$
 select
   auth.uid()='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid
   or exists(select 1 from public."Profils" p
     where p.id=auth.uid() and lower(btrim(coalesce(p.role,''))) in ('admin','administrateur')
       and coalesce(p.banni,false)=false)
   or exists(select 1 from public."Profils" p
     join public.aurore_admin_permissions ap on ap.user_id=p.id
     where p.id=auth.uid() and p.role='admin_limite'
       and coalesce(p.banni,false)=false and p_permission=any(ap.permissions));
$$;
grant execute on function public.has_admin_permission(text) to authenticated;

create or replace function public.mes_permissions_admin()
returns text[] language sql stable security definer
set search_path='public','pg_temp' as $$
 select case
   when auth.uid()='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then
     array['users','connections','documents','reports','deposits','visitors']::text[]
   when exists(select 1 from public."Profils" p where p.id=auth.uid() and p.role in ('admin','administrateur') and coalesce(p.banni,false)=false) then
     array['users','connections','documents','reports','deposits','visitors']::text[]
   else coalesce((select ap.permissions from public.aurore_admin_permissions ap
     join public."Profils" p on p.id=ap.user_id
     where ap.user_id=auth.uid() and p.role='admin_limite' and coalesce(p.banni,false)=false), '{}'::text[])
 end;
$$;
grant execute on function public.mes_permissions_admin() to authenticated;

create or replace function public.promouvoir_utilisateur_admin_v2(p_utilisateur_id uuid,p_permissions text[])
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_permissions text[]:=coalesce(p_permissions,'{}'::text[]);
begin
 if auth.uid() is distinct from '19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then
   raise exception 'Seul le compte propriétaire peut promouvoir un utilisateur.' using errcode='42501';
 end if;
 if p_utilisateur_id is null or p_utilisateur_id='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then
   raise exception 'Identifiant utilisateur invalide.' using errcode='22023';
 end if;
 if not (v_permissions <@ array['users','connections','documents','reports','deposits','visitors']::text[]) then
   raise exception 'Une permission demandée est invalide.' using errcode='22023';
 end if;
 if not exists(select 1 from public."Profils" where id=p_utilisateur_id) then
   raise exception 'Utilisateur introuvable.' using errcode='P0002';
 end if;
 update public."Profils" set role='admin_limite',updated_at=now() where id=p_utilisateur_id;
 insert into public.aurore_admin_permissions(user_id,permissions,updated_by,updated_at)
 values(p_utilisateur_id,v_permissions,auth.uid(),now())
 on conflict(user_id) do update set permissions=excluded.permissions,updated_by=excluded.updated_by,updated_at=now();
end $$;
grant execute on function public.promouvoir_utilisateur_admin_v2(uuid,text[]) to authenticated;

-- Ancien endpoint sécurisé : une ancienne interface ne peut plus créer un admin global.
create or replace function public.promouvoir_utilisateur_admin(utilisateur_id uuid)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 perform public.promouvoir_utilisateur_admin_v2(utilisateur_id,'{}'::text[]);
end $$;

create or replace function public.retrograder_utilisateur_admin(utilisateur_id uuid)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if auth.uid() is distinct from '19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then
   raise exception 'Seul le compte propriétaire peut rétrograder un administrateur.' using errcode='42501';
 end if;
 if utilisateur_id='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then
   raise exception 'Le compte propriétaire ne peut pas être rétrogradé.' using errcode='42501';
 end if;
 if not exists(select 1 from public."Profils" where id=utilisateur_id and role in ('admin','admin_limite')) then
   raise exception 'Administrateur introuvable.' using errcode='P0002';
 end if;
 delete from public.aurore_admin_permissions where user_id=utilisateur_id;
 update public."Profils" set role='user',updated_at=now() where id=utilisateur_id;
end $$;

create or replace function public.enregistrer_sortie_connexion_v2(p_connexion_id bigint)
returns boolean language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if auth.uid() is null then return false; end if;
 update public."Connexions" set sortie=coalesce(sortie,now())
 where id=p_connexion_id and user_id=auth.uid();
 return found;
end $$;
grant execute on function public.enregistrer_sortie_connexion_v2(bigint) to authenticated;

drop function if exists public.lister_profils_admin_activite();
create function public.lister_profils_admin_activite()
returns table(
 id uuid,prenom text,nom text,email text,role text,lycee text,niveau text,classe text,
 filiere text,discipline text,fonction text,enfant_informations text,banni boolean,
 created_at timestamptz,updated_at timestamptz,derniere_connexion timestamptz,
 derniere_deconnexion timestamptz,nombre_connexions bigint,permissions text[],
 nombre_telechargements bigint,nombre_favoris bigint,nombre_a_lire_plus_tard bigint,
 nombre_depots bigint,dernier_document_telecharge text,dernier_telechargement timestamptz
)
language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if not public.has_admin_permission('users') then
   raise exception 'Permission utilisateurs requise.' using errcode='42501';
 end if;
 return query
 select p.id,p.prenom,p.nom,p.email,p.role,p.lycee,p.niveau,p.classe,p.filiere,p.discipline,
   p.fonction,p.enfant_informations,p.banni,p.created_at,p.updated_at,
   a.derniere_connexion,a.derniere_deconnexion,a.nombre_connexions,
   coalesce(ap.permissions,'{}'::text[]),coalesce(dl.n,0),coalesce(fv.n,0),coalesce(lt.n,0),
   coalesce(dp.n,0),dl.titre,dl.derniere_date
 from public."Profils" p
 left join public.aurore_admin_permissions ap on ap.user_id=p.id
 left join lateral(
   select max(c.date) derniere_connexion,max(c.sortie) derniere_deconnexion,count(*) nombre_connexions
   from public."Connexions" c where c.user_id=p.id
 ) a on true
 left join lateral(select count(*) n,max(t.created_at) derniere_date,(array_agg(t.titre_document order by t.created_at desc))[1] titre
   from public.telechargements_documents t where t.user_id=p.id) dl on true
 left join lateral(select count(*) n from public.favoris_documents f where f.user_id=p.id) fv on true
 left join lateral(select count(*) n from public.documents_plus_tard l where l.user_id=p.id) lt on true
 left join lateral(select count(*) n from public."Depots_deposants" d where d.user_id=p.id) dp on true
 order by p.created_at desc;
end $$;
grant execute on function public.lister_profils_admin_activite() to authenticated;

create or replace function public.lister_statuts_bannissement_admin()
returns table(id uuid,banni boolean) language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if not public.has_admin_permission('users') then raise exception 'Permission utilisateurs requise.' using errcode='42501'; end if;
 return query select p.id,coalesce(p.banni,false) from public."Profils" p;
end $$;

create or replace function public.compter_profils_admin()
returns integer language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if not public.has_admin_permission('users') then raise exception 'Permission utilisateurs requise.' using errcode='42501'; end if;
 return (select count(*)::integer from public."Profils");
end $$;

create or replace function public.lister_visites_anonymes_recentes(limite integer default 300)
returns setof public."Visites_anonymes" language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if not public.has_admin_permission('visitors') then raise exception 'Permission visiteurs requise.' using errcode='42501'; end if;
 return query select * from public."Visites_anonymes" order by created_at desc limit greatest(1,least(limite,300));
end $$;

create or replace function public.compter_visites_anonymes()
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if not public.has_admin_permission('visitors') then raise exception 'Permission visiteurs requise.' using errcode='42501'; end if;
 return (select count(*) from public."Visites_anonymes");
end $$;

-- RLS : les administrateurs limités ne voient que les ressources de leurs permissions.
drop policy if exists "lecture admin" on public."Connexions";
create policy "lecture admin" on public."Connexions" for select using(public.has_admin_permission('connections'));
drop policy if exists "Depots_deposants_select_admin" on public."Depots_deposants";
create policy "Depots_deposants_select_admin" on public."Depots_deposants" for select using(public.has_admin_permission('deposits'));
drop policy if exists "Lecture complète pour les admins" on public."Document";
create policy "Lecture complète pour les admins" on public."Document" for select using(public.has_admin_permission('documents'));
drop policy if exists "Modification réservée aux admins" on public."Document";
create policy "Modification réservée aux admins" on public."Document" for update using(public.has_admin_permission('documents')) with check(public.has_admin_permission('documents'));
drop policy if exists "Suppression réservée aux admins" on public."Document";
create policy "Suppression réservée aux admins" on public."Document" for delete using(public.has_admin_permission('documents'));
drop policy if exists "profils_select_own" on public."Profils";
create policy "profils_select_own" on public."Profils" for select using(id=auth.uid() or public.has_admin_permission('users'));
drop policy if exists signalements_select_admin on public."Signalements";
create policy signalements_select_admin on public."Signalements" for select using(public.has_admin_permission('reports'));
drop policy if exists signalements_update_admin on public."Signalements";
create policy signalements_update_admin on public."Signalements" for update using(public.has_admin_permission('reports')) with check(public.has_admin_permission('reports'));
drop policy if exists signalements_delete_admin on public."Signalements";
create policy signalements_delete_admin on public."Signalements" for delete using(public.has_admin_permission('reports'));
drop policy if exists admin_documents_suspendus_access on public.admin_documents_suspendus;
create policy admin_documents_suspendus_access on public.admin_documents_suspendus for all
using(public.has_admin_permission('documents')) with check(public.has_admin_permission('documents'));
