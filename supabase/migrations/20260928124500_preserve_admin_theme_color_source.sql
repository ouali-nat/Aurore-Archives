-- Source de vérité pour la couleur administrative du document.
-- Une couleur choisie explicitement dans le sas Content Factory ne doit pas
-- être écrasée par une couleur portée par un payload d’ingestion éditoriale.
CREATE OR REPLACE FUNCTION public.aurora_ingest_editorial_document(p_ingest_id text, p_created_by uuid, p_title text, p_subject text DEFAULT NULL::text, p_level text DEFAULT NULL::text, p_class_name text DEFAULT NULL::text, p_document_type text DEFAULT 'cours'::text, p_prompt text DEFAULT NULL::text, p_content_json jsonb DEFAULT '{}'::jsonb, p_instructions jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_domaine text DEFAULT NULL::text, p_formation text DEFAULT NULL::text, p_specialite text DEFAULT NULL::text, p_annee text DEFAULT NULL::text, p_semestre text DEFAULT NULL::text, p_filiere text DEFAULT NULL::text, p_matiere text DEFAULT NULL::text, p_theme_color text DEFAULT '#C85C0D'::text, p_job_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job_id bigint;
  v_doc_id bigint;
  v_existing public.aurora_generated_documents;
  v_job public.aurora_content_jobs;
  v_content jsonb := coalesce(p_content_json, '{}'::jsonb);
  v_job_metadata jsonb := '{}'::jsonb;
  v_sections jsonb;
  v_visual_count int := 0;
  v_graph_count int := 0;
  v_exercise_count int := 0;
  v_correction_count int := 0;
  v_idx int;
  v_section jsonb;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_instructions jsonb := coalesce(p_instructions, '{}'::jsonb);
  v_color text := coalesce(nullif(trim(p_theme_color), ''), '#C85C0D');
  v_job_theme_color text;
  v_job_theme_source text;
  v_target_created_by uuid;
  v_title text;
  v_subject text;
  v_level text;
  v_class_name text;
  v_document_type text;
  v_prompt text;
  v_domaine text;
  v_formation text;
  v_specialite text;
  v_annee text;
  v_semestre text;
  v_filiere text;
  v_matiere text;
begin
  if p_job_id is null and p_created_by is null then
    raise exception 'Ingestion éditoriale sans rattachement : job_id ou created_by obligatoire';
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user <> 'service_role' then
    raise exception 'Accès éditeur interne requis';
  end if;

  if nullif(trim(coalesce(p_ingest_id, '')), '') is null
     or length(trim(p_ingest_id)) > 120 then
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
    if jsonb_typeof(v_section) <> 'object'
       or coalesce(length(trim(v_section->>'title')), 0) = 0 then
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
        select 1
        from jsonb_array_elements(v_section->'visuals') x
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

  if v_graph_count > 24 then
    raise exception 'Maximum 24 graphiques/constructions par document';
  end if;

  if jsonb_typeof(v_content->'corrections') = 'array' then
    v_correction_count := jsonb_array_length(v_content->'corrections');
  end if;

  select *
    into v_existing
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

  if p_job_id is not null then
    select *
      into v_job
      from public.aurora_content_jobs
     where id = p_job_id
     for update;

    if v_job.id is null then
      raise exception 'Demande Content Factory introuvable';
    end if;

    -- Une couleur explicitement choisie par l’administration devient
    -- prioritaire sur la couleur éventuellement envoyée par l’ingestion.
    -- Cela évite qu’un payload éditorial tardif rétablisse une ancienne
    -- couleur après le choix effectué dans le sas Content Factory.
    v_job_theme_color := nullif(trim(coalesce(v_job.metadata->>'theme_color', '')), '');
    v_job_theme_source := lower(trim(coalesce(v_job.metadata->>'theme_color_source', '')));
    if v_job_theme_source = 'admin'
       and v_job_theme_color ~ '^#[0-9A-Fa-f]{6}
      select * into v_existing
        from public.aurora_generated_documents
       where id = v_job.generated_document_id;

      if v_existing.id is not null then
        return jsonb_build_object(
          'ok', true,
          'duplicate', true,
          'generated_document_id', v_existing.id,
          'job_id', v_existing.job_id,
          'status', v_existing.status,
          'version', v_existing.version,
          'attached_to_existing_job', true
        );
      end if;
    end if;

    if v_job.status not in ('draft','queued','processing','review') then
      raise exception 'Impossible de rattacher une production au job % depuis le statut %', p_job_id, v_job.status;
    end if;

    v_job_id := v_job.id;
    v_target_created_by := coalesce(v_job.created_by, p_created_by);
    v_title := trim(coalesce(nullif(trim(p_title), ''), v_job.title));
    v_subject := nullif(trim(coalesce(nullif(trim(p_subject), ''), v_job.subject, '')), '');
    v_level := nullif(trim(coalesce(nullif(trim(p_level), ''), v_job.level, '')), '');
    v_class_name := nullif(trim(coalesce(nullif(trim(p_class_name), ''), v_job.class_name, '')), '');
    v_document_type := nullif(trim(coalesce(nullif(trim(p_document_type), ''), v_job.document_type, 'cours')), '');
    v_prompt := nullif(trim(coalesce(nullif(trim(p_prompt), ''), v_job.prompt, '')), '');
    v_domaine := nullif(trim(coalesce(p_domaine, v_job.domaine, '')), '');
    v_formation := nullif(trim(coalesce(p_formation, v_job.formation, '')), '');
    v_specialite := nullif(trim(coalesce(p_specialite, v_job.specialite, '')), '');
    v_annee := nullif(trim(coalesce(p_annee, v_job.annee, '')), '');
    v_semestre := nullif(trim(coalesce(p_semestre, v_job.semestre, '')), '');
    v_filiere := nullif(trim(coalesce(p_filiere, v_job.filiere, '')), '');
    v_matiere := nullif(trim(coalesce(p_matiere, v_subject, v_job.subject, '')), '');

    v_job_metadata := coalesce(v_job.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'origin', 'gpt_editorial_ingest',
        'producer', 'ChatGPT',
        'ingest_id', trim(p_ingest_id),
        'editorial_engine', 'ChatGPT',
        'content_created_by_editor', true,
        'human_review_required', true,
        'manual_publication_only', true,
        'category', coalesce(nullif(trim(v_instructions->>'category'), ''), nullif(trim(v_job.metadata->>'category'), ''), 'Documents'),
        'domaine', v_domaine,
        'formation', v_formation,
        'specialite', v_specialite,
        'annee', v_annee,
        'semestre', v_semestre,
        'filiere', v_filiere,
        'matiere', v_matiere,
        'theme_color', v_color,
        'editorial_status', 'completed',
        'renderer_status', 'pending',
        'workflow_contract', 'aurora-content-factory-v1',
        'workflow_initial_stage', 'content_factory',
        'workflow_current_stage', 'editorial_review',
        'pending_admin_surface', 'documents_en_attente',
        'pdf_launch_mode', 'manual',
        'manual_pdf_launch_required', true,
        'auto_pdf_launch', false
      );

    v_metadata := v_metadata
      || jsonb_build_object(
        'pipeline', 'ChatGPT editor -> Aurore renderer',
        'schema_version', 'aurora-editorial-1',
        'ingest_id', trim(p_ingest_id),
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
        'aurore_design', coalesce(v_metadata->'aurore_design', jsonb_build_object('theme_color', v_color)),
        'content_job_id', v_job_id,
        'attached_existing_job', true
      );

    insert into public.aurora_generated_documents (
      job_id, created_by, title, subject, level, class_name, document_type,
      source_format, source_content, content_json, pdf_path, pdf_url, version,
      status, validation_notes, published_document_id, metadata,
      domaine, formation, specialite, annee, semestre, filiere, matiere,
      theme_color, ingest_id
    ) values (
      v_job_id,
      v_target_created_by,
      v_title,
      v_subject,
      v_level,
      v_class_name,
      v_document_type,
      'structured',
      null,
      v_content,
      null,
      null,
      1,
      'review',
      'Contenu éditorial rattaché à la demande Content Factory existante. Contrôle humain requis avant publication.',
      null,
      v_metadata,
      v_domaine,
      v_formation,
      v_specialite,
      v_annee,
      v_semestre,
      v_filiere,
      v_matiere,
      v_color,
      trim(p_ingest_id)
    )
    returning id into v_doc_id;

    update public.aurora_content_jobs
       set title = coalesce(v_job.title, v_title),
           subject = coalesce(v_job.subject, v_subject),
           level = coalesce(v_job.level, v_level),
           class_name = coalesce(v_job.class_name, v_class_name),
           document_type = coalesce(v_job.document_type, v_document_type),
           prompt = coalesce(v_job.prompt, v_prompt),
           metadata = v_job_metadata,
           generated_document_id = v_doc_id,
           status = 'review',
           error_message = null,
           updated_at = now()
     where id = v_job_id;

    return jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'generated_document_id', v_doc_id,
      'job_id', v_job_id,
      'status', 'review',
      'version', 1,
      'attached_to_existing_job', true
    );
  end if;

  v_job_metadata := jsonb_build_object(
    'origin', 'gpt_editorial_ingest',
    'producer', 'ChatGPT',
    'ingest_id', trim(p_ingest_id),
    'editorial_engine', 'ChatGPT',
    'content_created_by_editor', true,
    'human_review_required', true,
    'manual_publication_only', true,
    'category', coalesce(nullif(trim(v_instructions->>'category'), ''), 'Documents'),
    'domaine', nullif(trim(coalesce(p_domaine, '')), ''),
    'formation', nullif(trim(coalesce(p_formation, '')), ''),
    'specialite', nullif(trim(coalesce(p_specialite, '')), ''),
    'annee', nullif(trim(coalesce(p_annee, '')), ''),
    'semestre', nullif(trim(coalesce(p_semestre, '')), ''),
    'filiere', nullif(trim(coalesce(p_filiere, '')), ''),
    'theme_color', v_color,
    'editorial_status', 'completed',
    'renderer_status', 'pending',
    'workflow_contract', 'aurora-content-factory-v1',
    'workflow_initial_stage', 'content_factory',
    'workflow_current_stage', 'editorial_review',
    'pending_admin_surface', 'documents_en_attente',
    'pdf_launch_mode', 'manual',
    'manual_pdf_launch_required', true,
    'auto_pdf_launch', false
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
    v_job_metadata,
    nullif(trim(coalesce(p_domaine, '')), ''),
    nullif(trim(coalesce(p_formation, '')), ''),
    nullif(trim(coalesce(p_specialite, '')), ''),
    nullif(trim(coalesce(p_annee, '')), ''),
    nullif(trim(coalesce(p_semestre, '')), ''),
    nullif(trim(coalesce(p_filiere, '')), '')
  )
  returning * into v_job;

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
  )
  returning id into v_doc_id;

  update public.aurora_content_jobs
     set generated_document_id = v_doc_id,
         status = 'review',
         error_message = null,
         updated_at = now()
   where id = v_job_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'generated_document_id', v_doc_id,
    'job_id', v_job_id,
    'status', 'review',
    'version', 1
  );
end;
$function$; then
      v_color := upper(v_job_theme_color);
    end if;

    if v_job.generated_document_id is not null then
      select * into v_existing
        from public.aurora_generated_documents
       where id = v_job.generated_document_id;

      if v_existing.id is not null then
        return jsonb_build_object(
          'ok', true,
          'duplicate', true,
          'generated_document_id', v_existing.id,
          'job_id', v_existing.job_id,
          'status', v_existing.status,
          'version', v_existing.version,
          'attached_to_existing_job', true
        );
      end if;
    end if;

    if v_job.status not in ('draft','queued','processing','review') then
      raise exception 'Impossible de rattacher une production au job % depuis le statut %', p_job_id, v_job.status;
    end if;

    v_job_id := v_job.id;
    v_target_created_by := coalesce(v_job.created_by, p_created_by);
    v_title := trim(coalesce(nullif(trim(p_title), ''), v_job.title));
    v_subject := nullif(trim(coalesce(nullif(trim(p_subject), ''), v_job.subject, '')), '');
    v_level := nullif(trim(coalesce(nullif(trim(p_level), ''), v_job.level, '')), '');
    v_class_name := nullif(trim(coalesce(nullif(trim(p_class_name), ''), v_job.class_name, '')), '');
    v_document_type := nullif(trim(coalesce(nullif(trim(p_document_type), ''), v_job.document_type, 'cours')), '');
    v_prompt := nullif(trim(coalesce(nullif(trim(p_prompt), ''), v_job.prompt, '')), '');
    v_domaine := nullif(trim(coalesce(p_domaine, v_job.domaine, '')), '');
    v_formation := nullif(trim(coalesce(p_formation, v_job.formation, '')), '');
    v_specialite := nullif(trim(coalesce(p_specialite, v_job.specialite, '')), '');
    v_annee := nullif(trim(coalesce(p_annee, v_job.annee, '')), '');
    v_semestre := nullif(trim(coalesce(p_semestre, v_job.semestre, '')), '');
    v_filiere := nullif(trim(coalesce(p_filiere, v_job.filiere, '')), '');
    v_matiere := nullif(trim(coalesce(p_matiere, v_subject, v_job.subject, '')), '');

    v_job_metadata := coalesce(v_job.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'origin', 'gpt_editorial_ingest',
        'producer', 'ChatGPT',
        'ingest_id', trim(p_ingest_id),
        'editorial_engine', 'ChatGPT',
        'content_created_by_editor', true,
        'human_review_required', true,
        'manual_publication_only', true,
        'category', coalesce(nullif(trim(v_instructions->>'category'), ''), nullif(trim(v_job.metadata->>'category'), ''), 'Documents'),
        'domaine', v_domaine,
        'formation', v_formation,
        'specialite', v_specialite,
        'annee', v_annee,
        'semestre', v_semestre,
        'filiere', v_filiere,
        'matiere', v_matiere,
        'theme_color', v_color,
        'editorial_status', 'completed',
        'renderer_status', 'pending',
        'workflow_contract', 'aurora-content-factory-v1',
        'workflow_initial_stage', 'content_factory',
        'workflow_current_stage', 'editorial_review',
        'pending_admin_surface', 'documents_en_attente',
        'pdf_launch_mode', 'manual',
        'manual_pdf_launch_required', true,
        'auto_pdf_launch', false
      );

    v_metadata := v_metadata
      || jsonb_build_object(
        'pipeline', 'ChatGPT editor -> Aurore renderer',
        'schema_version', 'aurora-editorial-1',
        'ingest_id', trim(p_ingest_id),
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
        'aurore_design', coalesce(v_metadata->'aurore_design', jsonb_build_object('theme_color', v_color)),
        'content_job_id', v_job_id,
        'attached_existing_job', true
      );

    insert into public.aurora_generated_documents (
      job_id, created_by, title, subject, level, class_name, document_type,
      source_format, source_content, content_json, pdf_path, pdf_url, version,
      status, validation_notes, published_document_id, metadata,
      domaine, formation, specialite, annee, semestre, filiere, matiere,
      theme_color, ingest_id
    ) values (
      v_job_id,
      v_target_created_by,
      v_title,
      v_subject,
      v_level,
      v_class_name,
      v_document_type,
      'structured',
      null,
      v_content,
      null,
      null,
      1,
      'review',
      'Contenu éditorial rattaché à la demande Content Factory existante. Contrôle humain requis avant publication.',
      null,
      v_metadata,
      v_domaine,
      v_formation,
      v_specialite,
      v_annee,
      v_semestre,
      v_filiere,
      v_matiere,
      v_color,
      trim(p_ingest_id)
    )
    returning id into v_doc_id;

    update public.aurora_content_jobs
       set title = coalesce(v_job.title, v_title),
           subject = coalesce(v_job.subject, v_subject),
           level = coalesce(v_job.level, v_level),
           class_name = coalesce(v_job.class_name, v_class_name),
           document_type = coalesce(v_job.document_type, v_document_type),
           prompt = coalesce(v_job.prompt, v_prompt),
           metadata = v_job_metadata,
           generated_document_id = v_doc_id,
           status = 'review',
           error_message = null,
           updated_at = now()
     where id = v_job_id;

    return jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'generated_document_id', v_doc_id,
      'job_id', v_job_id,
      'status', 'review',
      'version', 1,
      'attached_to_existing_job', true
    );
  end if;

  v_job_metadata := jsonb_build_object(
    'origin', 'gpt_editorial_ingest',
    'producer', 'ChatGPT',
    'ingest_id', trim(p_ingest_id),
    'editorial_engine', 'ChatGPT',
    'content_created_by_editor', true,
    'human_review_required', true,
    'manual_publication_only', true,
    'category', coalesce(nullif(trim(v_instructions->>'category'), ''), 'Documents'),
    'domaine', nullif(trim(coalesce(p_domaine, '')), ''),
    'formation', nullif(trim(coalesce(p_formation, '')), ''),
    'specialite', nullif(trim(coalesce(p_specialite, '')), ''),
    'annee', nullif(trim(coalesce(p_annee, '')), ''),
    'semestre', nullif(trim(coalesce(p_semestre, '')), ''),
    'filiere', nullif(trim(coalesce(p_filiere, '')), ''),
    'theme_color', v_color,
    'editorial_status', 'completed',
    'renderer_status', 'pending',
    'workflow_contract', 'aurora-content-factory-v1',
    'workflow_initial_stage', 'content_factory',
    'workflow_current_stage', 'editorial_review',
    'pending_admin_surface', 'documents_en_attente',
    'pdf_launch_mode', 'manual',
    'manual_pdf_launch_required', true,
    'auto_pdf_launch', false
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
    v_job_metadata,
    nullif(trim(coalesce(p_domaine, '')), ''),
    nullif(trim(coalesce(p_formation, '')), ''),
    nullif(trim(coalesce(p_specialite, '')), ''),
    nullif(trim(coalesce(p_annee, '')), ''),
    nullif(trim(coalesce(p_semestre, '')), ''),
    nullif(trim(coalesce(p_filiere, '')), '')
  )
  returning * into v_job;

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
  )
  returning id into v_doc_id;

  update public.aurora_content_jobs
     set generated_document_id = v_doc_id,
         status = 'review',
         error_message = null,
         updated_at = now()
   where id = v_job_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'generated_document_id', v_doc_id,
    'job_id', v_job_id,
    'status', 'review',
    'version', 1
  );
end;
$function$;
