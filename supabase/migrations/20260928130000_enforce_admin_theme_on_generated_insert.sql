-- Garde-fou de couleur : une sélection administrative enregistrée sur un
-- job Content Factory doit être conservée lors de la création du document.
CREATE OR REPLACE FUNCTION private.aurora_enforce_admin_theme_on_generated_document_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job_metadata jsonb;
  v_source text;
  v_job_color text;
  v_metadata jsonb;
  v_design jsonb;
begin
  if new.job_id is null then
    return new;
  end if;

  select metadata
    into v_job_metadata
    from public.aurora_content_jobs
   where id = new.job_id;

  v_source := lower(trim(coalesce(v_job_metadata->>'theme_color_source', '')));
  v_job_color := nullif(trim(coalesce(v_job_metadata->>'theme_color', '')), '');

  if v_source = 'admin'
     and length(v_job_color) = 7
     and v_job_color ~ '^#[0-9A-Fa-f]{6}' then
    v_job_color := upper(v_job_color);
    new.theme_color := v_job_color;

    v_metadata := coalesce(new.metadata, '{}'::jsonb);
    v_design := case
      when jsonb_typeof(v_metadata->'aurore_design') = 'object'
      then v_metadata->'aurore_design'
      else '{}'::jsonb
    end;

    new.metadata := v_metadata
      || jsonb_build_object(
        'theme_color', v_job_color,
        'aurore_design', v_design
          || jsonb_build_object(
            'theme_color', v_job_color,
            'version', 1
          )
      );
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS aurora_generated_documents_admin_theme_authority
  ON public.aurora_generated_documents;

CREATE TRIGGER aurora_generated_documents_admin_theme_authority
BEFORE INSERT ON public.aurora_generated_documents
FOR EACH ROW
EXECUTE FUNCTION private.aurora_enforce_admin_theme_on_generated_document_insert();
