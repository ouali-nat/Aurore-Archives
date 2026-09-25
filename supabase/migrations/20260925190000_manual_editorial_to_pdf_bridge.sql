-- Aurore: séparation stricte du sas éditorial et du lancement PDF.
-- Le contenu est injecté explicitement par ChatGPT -> aurora-gpt-ingest.
-- La production LuaLaTeX est lancée explicitement par l'administration via
-- aurora-lualatex-request. Les anciens triggers "auto wake" restent présents
-- pour compatibilité structurelle, mais deviennent sans effet.

create or replace function public.aurora_content_jobs_auto_wake()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  return new;
end;
$function$;

create or replace function public.aurore_lualatex_auto_wake()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  return new;
end;
$function$;
