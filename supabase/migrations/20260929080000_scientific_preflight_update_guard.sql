-- Aurore Archives — protection des mises à jour techniques des documents scientifiques.
-- Le préflight 400 reste un hard gate à l'insertion et lors d'une modification
-- du contenu éditorial, mais ne bloque pas les seules mises à jour PDF/metadata.

create or replace function public.aurora_enforce_scientific_content_contract()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $function$
declare
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_report jsonb;
begin
  if v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.content_json is not distinct from old.content_json
     and new.subject is not distinct from old.subject
     and new.document_type is not distinct from old.document_type
     and new.matiere is not distinct from old.matiere then
    return new;
  end if;

  v_report := public.aurora_scientific_preflight(new.matiere,new.document_type,new.content_json);

  if v_report->>'status' <> 'pass' then
    raise exception 'Préflight scientifique Aurore bloqué : %',coalesce(v_report->>'failures','[]');
  end if;

  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'scientific_preflight',v_report || jsonb_build_object('checked_at',now())
    );

  return new;
end;
$function$;
