-- Traçabilité administration : activité utilisateurs, connexions, visiteurs et largeur du formulaire A.
alter table public."Profils" add column if not exists updated_at timestamptz;
update public."Profils" set updated_at=coalesce(updated_at,created_at,now()) where updated_at is null;
alter table public."Profils" alter column updated_at set default now();

create table if not exists public.aurore_admin_interface_settings(
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.aurore_admin_interface_settings enable row level security;
drop policy if exists "Public can read Aurore admin interface settings" on public.aurore_admin_interface_settings;
create policy "Public can read Aurore admin interface settings" on public.aurore_admin_interface_settings for select using(true);
drop policy if exists "Admins can write Aurore admin interface settings" on public.aurore_admin_interface_settings;
create policy "Admins can write Aurore admin interface settings" on public.aurore_admin_interface_settings for all
using(exists(select 1 from public."Profils" p where p.id=auth.uid() and p.role='admin'))
with check(exists(select 1 from public."Profils" p where p.id=auth.uid() and p.role='admin'));
insert into public.aurore_admin_interface_settings(setting_key,setting_value)
values('content_factory_section_a_form',jsonb_build_object('max_width_px',1320,'subject_width_px',620))
on conflict(setting_key) do nothing;

create or replace function public.enregistrer_sortie_connexion()
returns boolean language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 update public."Connexions" set sortie=now()
 where id=(select c.id from public."Connexions" c where c.user_id=auth.uid() and c.sortie is null order by c.date desc limit 1);
 return true;
end $$;

create or replace function public.enregistrer_sortie_visite_anonyme_par_visitor(p_visitor_id text)
returns boolean language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if nullif(trim(coalesce(p_visitor_id,'')),'') is null then return false; end if;
 update public."Visites_anonymes" set sortie=now()
 where id=(select v.id from public."Visites_anonymes" v where v.visitor_id=p_visitor_id and v.sortie is null order by v.created_at desc limit 1);
 return true;
end $$;

create or replace function public.lister_profils_admin_activite()
returns table(id uuid,prenom text,nom text,email text,role text,lycee text,niveau text,classe text,filiere text,discipline text,fonction text,enfant_informations text,banni boolean,created_at timestamptz,updated_at timestamptz,derniere_connexion timestamptz,derniere_deconnexion timestamptz,nombre_connexions bigint)
language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if not exists(select 1 from public."Profils" p where p.id=auth.uid() and p.role='admin') then raise exception 'Accès réservé aux administrateurs.' using errcode='42501'; end if;
 return query
 select p.id,p.prenom,p.nom,p.email,p.role,p.lycee,p.niveau,p.classe,p.filiere,p.discipline,p.fonction,p.enfant_informations,p.banni,p.created_at,p.updated_at,
        a.derniere_connexion,a.derniere_deconnexion,a.nombre_connexions
 from public."Profils" p
 left join lateral(
   select max(c.date) derniere_connexion,
          max(c.sortie) filter(where c.date=(select max(c2.date) from public."Connexions" c2 where c2.user_id=p.id)) derniere_deconnexion,
          count(*) nombre_connexions
   from public."Connexions" c where c.user_id=p.id
 ) a on true
 order by p.created_at desc;
end $$;

create or replace function public.enregistrer_profil_personnel(p_nom text,p_prenom text,p_lycee text,p_niveau text,p_classe text,p_filiere text,p_role text,p_discipline text,p_fonction text,p_enfant_informations text)
returns boolean language plpgsql security definer set search_path='public' as $$
declare uid uuid; r text;
begin
 uid:=auth.uid(); if uid is null then raise exception 'Utilisateur non authentifié'; end if;
 r:=lower(trim(coalesce(p_role,'eleve')));
 if r not in('eleve','enseignant','professeur','parent','personnel') then raise exception 'Profil invalide'; end if;
 if trim(coalesce(p_nom,''))='' then raise exception 'Nom obligatoire'; end if;
 if trim(coalesce(p_prenom,''))='' then raise exception 'Prénom obligatoire'; end if;
 if trim(coalesce(p_lycee,''))='' then raise exception 'Établissement obligatoire'; end if;
 if r='eleve' and trim(coalesce(p_niveau,''))='' then raise exception 'Niveau obligatoire'; end if;
 if r='eleve' and trim(coalesce(p_classe,''))='' then raise exception 'Classe obligatoire'; end if;
 if r in('enseignant','professeur') and trim(coalesce(p_discipline,''))='' then raise exception 'Discipline obligatoire'; end if;
 if r='parent' and trim(coalesce(p_enfant_informations,''))='' then raise exception 'Informations enfant obligatoires'; end if;
 if r='personnel' and trim(coalesce(p_fonction,''))='' then raise exception 'Fonction obligatoire'; end if;
 insert into public."Profils"(id,email,nom,prenom,lycee,niveau,classe,filiere,role,discipline,fonction,enfant_informations,updated_at)
 values(uid,(select email from auth.users where id=uid),trim(p_nom),trim(p_prenom),trim(p_lycee),nullif(trim(coalesce(p_niveau,'')),''),nullif(trim(coalesce(p_classe,'')),''),nullif(trim(coalesce(p_filiere,'')),''),r,nullif(trim(coalesce(p_discipline,'')),''),nullif(trim(coalesce(p_fonction,'')),''),nullif(trim(coalesce(p_enfant_informations,'')),''),now())
 on conflict(id) do update set email=excluded.email,nom=excluded.nom,prenom=excluded.prenom,lycee=excluded.lycee,niveau=excluded.niveau,classe=excluded.classe,filiere=excluded.filiere,role=excluded.role,discipline=excluded.discipline,fonction=excluded.fonction,enfant_informations=excluded.enfant_informations,updated_at=now();
 return true;
end $$;
