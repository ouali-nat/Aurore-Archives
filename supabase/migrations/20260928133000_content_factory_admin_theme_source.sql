-- Capture the administrator's Content Factory theme at job creation time.
-- The selected color is stored both as the ordinary theme and as the
-- protected admin value so later editorial ingestion cannot replace it.
CREATE OR REPLACE FUNCTION public.aurora_create_content_job(
  p_title text,
  p_subject text DEFAULT NULL::text,
  p_level text DEFAULT NULL::text,
  p_class_name text DEFAULT NULL::text,
  p_document_type text DEFAULT 'fiche de révision'::text,
  p_prompt text DEFAULT NULL::text,
  p_instructions jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_id bigint;
  v_category text;
  v_instructions jsonb;
  v_theme_color text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  if nullif(trim(coalesce(p_title,'')), '') is null then
    raise exception 'Le titre est obligatoire';
  end if;

  v_instructions := coalesce(p_instructions,'{}'::jsonb);
  v_category := nullif(trim(coalesce(v_instructions->>'category','')), '');

  if v_category is not null
     and v_category not in ('Documents','Devoirs','Fiches cours','Devoir','Exercice') then
    raise exception 'Catégorie Content Factory invalide';
  end if;

  if v_category is null then
    v_category := case
      when lower(trim(coalesce(p_document_type,''))) in ('devoir','exercice','devoirs')
        then 'Devoirs'
      else 'Documents'
    end;
  end if;

  v_theme_color := coalesce(
    nullif(trim(coalesce(v_instructions->>'theme_color','')), ''),
    '#C85C0D'
  );

  if v_theme_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'theme_color doit être #RRGGBB';
  end if;

  v_theme_color := upper(v_theme_color);

  insert into public.aurora_content_jobs (
    id, created_by, status, title, subject, level, class_name,
    document_type, source_format, prompt, instructions, source_document_ids, metadata
  ) values (
    nextval('public.aurora_content_jobs_id_seq'),
    auth.uid(),
    'queued',
    trim(p_title),
    nullif(trim(coalesce(p_subject,'')), ''),
    nullif(trim(coalesce(p_level,'')), ''),
    nullif(trim(coalesce(p_class_name,'')), ''),
    nullif(trim(coalesce(p_document_type,'')), ''),
    'structured',
    nullif(trim(coalesce(p_prompt,'')), ''),
    v_instructions,
    '{}',
    jsonb_build_object(
      'origin', coalesce(nullif(trim(coalesce(v_instructions->>'origin','')), ''), 'aurore'),
      'category', v_category,
      'filiere', nullif(trim(coalesce(v_instructions->>'filiere','')), ''),
      'resource_type', nullif(trim(coalesce(p_document_type,'')), ''),
      'theme_color', v_theme_color,
      'admin_theme_color', v_theme_color,
      'theme_color_source', 'admin',
      'theme_color_selected_at', now(),
      'aurore_design', jsonb_build_object(
        'theme_color', v_theme_color,
        'version', 1
      ),
      'manual_publication_only', true
    )
  )
  returning id into v_id;

  return v_id;
end;
$function$;
