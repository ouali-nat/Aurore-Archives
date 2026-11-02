alter table public.aurore_admin_permissions drop constraint if exists aurore_admin_permissions_valid;
alter table public.aurore_admin_permissions add constraint aurore_admin_permissions_valid
check (permissions <@ array['users','connections','reports','visitors']::text[]);

create or replace function public.promouvoir_utilisateur_admin_v2(p_utilisateur_id uuid,p_permissions text[])
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_permissions text[]:=coalesce(p_permissions,'{}'::text[]);
begin
 if auth.uid() is distinct from '19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then raise exception 'Seul le compte propriétaire peut promouvoir un utilisateur.' using errcode='42501'; end if;
 if p_utilisateur_id is null or p_utilisateur_id='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then raise exception 'Identifiant utilisateur invalide.' using errcode='22023'; end if;
 if not (v_permissions <@ array['users','connections','reports','visitors']::text[]) then raise exception 'Une permission demandée est invalide.' using errcode='22023'; end if;
 if not exists(select 1 from public."Profils" where id=p_utilisateur_id) then raise exception 'Utilisateur introuvable.' using errcode='P0002'; end if;
 update public."Profils" set role='admin_limite',updated_at=now() where id=p_utilisateur_id;
 insert into public.aurore_admin_permissions(user_id,permissions,updated_by,updated_at) values(p_utilisateur_id,v_permissions,auth.uid(),now())
 on conflict(user_id) do update set permissions=excluded.permissions,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end $$;
grant execute on function public.promouvoir_utilisateur_admin_v2(uuid,text[]) to authenticated;

create or replace function public.mes_permissions_admin()
returns text[] language sql stable security definer set search_path='public','pg_temp' as $$
 select case
 when auth.uid()='19621106-98f5-4a09-9f72-8c4fc8ae2219'::uuid then array['users','connections','reports','visitors']::text[]
 when exists(select 1 from public."Profils" p where p.id=auth.uid() and p.role in ('admin','administrateur') and coalesce(p.banni,false)=false) then array['users','connections','reports','visitors']::text[]
 else coalesce((select ap.permissions from public.aurore_admin_permissions ap join public."Profils" p on p.id=ap.user_id where ap.user_id=auth.uid() and p.role='admin_limite' and coalesce(p.banni,false)=false), '{}'::text[])
 end;
$$;
grant execute on function public.mes_permissions_admin() to authenticated;