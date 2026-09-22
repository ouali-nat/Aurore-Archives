create or replace function public.aurora_ingest_editorial_document(
  p_ingest_id text,
  p_created_by uuid,
  p_title text,
  p_subject text default null,
  p_level text default null,
  p_class_name text default null,
  p_document_type text default 'cours',
  p_prompt text default null,
  p_content_json jsonb default '{}'::jsonb,
  p_instructions jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_domaine text default null,
  p_formation text default null,
  p_specialite text default null,
  p_annee text default null,
  p_semestre text default null,
  p_filiere text default null,
  p_matiere text default null,
  p_theme_color text default '#C85C0D'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_job_id bigint;
  v_doc_id bigint;
  v_existing public.aurora_generated_documents;
  v_job public.aurora_content_jobs;
  v_content jsonb := coalesce(p_content_json, '{}'::jsonb);
  v_visual_count int := 0;
  v_graph_count int := 0;
  v_exercise_count int := 0;
  v_correction_count int := 0;
  v_idx int;
  v_section jsonb;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_instructions jsonb := coalesce(p_instructions, '{}'::jsonb);
  v_color text := coalesce(nullif(trim(p_theme_color), ''), '#C85C0D');
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Accès éditeur interne requis';
  end if;

  if nullif(trim(coalesce(p_ingest_id, '')), '') is null or length(trim(p_ingest_id)) > 120 then
    raise exception 'ingest_id invalide';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Le titre est obligatoire';
  end if;
  if not v_content ? 'title'
     or jsonb_typeof(v_content->'sections') <> 'array'
     or jsonb_array_length(v_content->'sections') < 1
     or jsonb_array_length(v_content->'sections') > 30 then
    raise exception 'content_json invalide : title et 1 à 30 sections sont obligatoires';
  end if;
  if v_content->>'title' is null or length(trim(v_content->>'title')) = 0 then
    raise exception 'content_json.title est obligatoire';
  end if;
  if v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'theme_color doit être #RRGGBB';
  end if;

  for v_idx in 0..jsonb_array_length(v_content->'sections')-1 loop
    v_section := v_content->'sections'->v_idx;
    if jsonb_typeof(v_section) <> 'object' or coalesce(length(trim(v_section->>'title')), 0) = 0 then
      raise exception 'Section % invalide : title obligatoire', v_idx + 1;
    end if;
    if jsonb_typeof(v_section->'visuals') = 'array' then
      if jsonb_array_length(v_section->'visuals') > 3 then
        raise exception 'Section % : maximum 3 visuels', v_idx + 1;
      end if;
      v_visual_count := v_visual_count + jsonb_array_length(v_section->'visuals');
      if v_visual_count > 8 then
        raise exception 'Maximum 8 visuels documentaires par document';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_section->'visuals') x
        where coalesce(lower(x->>'type'), 'wikimedia') <> 'wikimedia'
      ) then
        raise exception 'Type de visuel non supporté dans la section %', v_idx + 1;
      end if;
    end if;
    if jsonb_typeof(v_section->'graphs') = 'array' then
      v_graph_count := v_graph_count + jsonb_array_length(v_section->'graphs');
    end if;
    if jsonb_typeof(v_section->'exercises') = 'array' then
      v_exercise_count := v_exercise_count + jsonb_array_length(v_section->'exercises');
    end if;
  end loop;

  if v_graph_count > 24 then raise exception 'Maximum 24 graphiques/constructions par document'; end if;
  if jsonb_typeof(v_content->'corrections') = 'array' then
    v_correction_count := jsonb_array_length(v_content->'corrections');
  end if;

  select * into v_existing
  from public.aurora_generated_documents
  where ingest_id = trim(p_ingest_id)
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'generated_document_id', v_existing.id,
      'job_id', v_existing.job_id,
      'status', v_existing.status,
      'version', v_existing.version
    );
  end if;

  v_metadata := v_metadata || jsonb_build_object(
    'pipeline', 'ChatGPT editor -> Aurore renderer',
    'schema_version', 'aurora-editorial-1',
    'editorial', jsonb_build_object(
      'role', 'editor',
      'engine', 'ChatGPT',
      'status', 'completed',
      'schema_version', 'aurora-editorial-1'
    ),
    'human_review_required', true,
    'manual_publication_only', true,
    'lualatex_requested', false,
    'lualatex_status', 'not_requested',
    'lualatex_progress', 0,
    'lualatex_stage', 'Contenu éditorial reçu — prêt pour rendu PDF',
    'qa', jsonb_build_object(
      'sections', jsonb_array_length(v_content->'sections'),
      'graphs', v_graph_count,
      'visuals', v_visual_count,
      'exercises', v_exercise_count,
      'corrections', v_correction_count
    ),
    'aurore_design', coalesce(v_metadata->'aurore_design', jsonb_build_object('theme_color', v_color))
  );

  insert into public.aurora_content_jobs (
    id, created_by, status, title, subject, level, class_name,
    document_type, source_format, prompt, instructions, source_document_ids, metadata,
    domaine, formation, specialite, annee, semestre, filiere
  ) values (
    nextval('public.aurora_content_jobs_id_seq'),
    p_created_by,
    'review',
    trim(p_title),
    nullif(trim(coalesce(p_subject, p_matiere)), ''),
    nullif(trim(coalesce(p_level, '')), ''),
    nullif(trim(coalesce(p_class_name, '')), ''),
    nullif(trim(coalesce(p_document_type, 'cours')), ''),
    'structured',
    nullif(trim(coalesce(p_prompt, '')), ''),
    v_instructions || jsonb_build_object(
      'origin', 'gpt_editorial_ingest',
      'producer', 'ChatGPT',
      'human_review_required', true,
      'lualatex_requested', false,
      'theme_color', v_color,
      'schema_version', 'aurora-editorial-1'
    ),
    '{}',
    v_metadata,
    nullif(trim(coalesce(p_domaine, '')), ''),
    nullif(trim(coalesce(p_formation, '')), ''),
    nullif(trim(coalesce(p_specialite, '')), ''),
    nullif(trim(coalesce(p_annee, '')), ''),
    nullif(trim(coalesce(p_semestre, '')), ''),
    nullif(trim(coalesce(p_filiere, '')), '')
  ) returning * into v_job;

  v_job_id := v_job.id;

  insert into public.aurora_generated_documents (
    job_id, created_by, title, subject, level, class_name, document_type,
    source_format, source_content, content_json, pdf_path, pdf_url, version,
    status, validation_notes, published_document_id, metadata,
    domaine, formation, specialite, annee, semestre, filiere, matiere,
    theme_color, ingest_id
  ) values (
    v_job_id,
    p_created_by,
    trim(p_title),
    nullif(trim(coalesce(p_subject, p_matiere)), ''),
    nullif(trim(coalesce(p_level, '')), ''),
    nullif(trim(coalesce(p_class_name, '')), ''),
    nullif(trim(coalesce(p_document_type, 'cours')), ''),
    'structured',
    null,
    v_content,
    null,
    null,
    1,
    'review',
    'Contenu éditorial validé par le pont ChatGPT. Contrôle humain requis avant publication.',
    null,
    v_metadata,
    nullif(trim(coalesce(p_domaine, '')), ''),
    nullif(trim(coalesce(p_formation, '')), ''),
    nullif(trim(coalesce(p_specialite, '')), ''),
    nullif(trim(coalesce(p_annee, '')), ''),
    nullif(trim(coalesce(p_semestre, '')), ''),
    nullif(trim(coalesce(p_filiere, '')), ''),
    nullif(trim(coalesce(p_matiere, p_subject)), ''),
    v_color,
    trim(p_ingest_id)
  ) returning id into v_doc_id;

  update public.aurora_content_jobs
     set generated_document_id = v_doc_id,
         status = 'review',
         error_message = null,
         updated_at = now()
   where id = v_job_id;

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'generated_document_id', v_doc_id,
    'job_id', v_job_id,
    'status', 'review', 'version', 1
  );
end;
$function$;

revoke all on function public.aurora_ingest_editorial_document(
  text, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb,
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.aurora_ingest_editorial_document(
  text, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb,
  text, text, text, text, text, text, text, text
) to service_role;
