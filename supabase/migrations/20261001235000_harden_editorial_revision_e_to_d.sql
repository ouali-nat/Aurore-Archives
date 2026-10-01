-- Harden Section E -> D handoff: archive the old revision source and create a clean D job.
create or replace function public.aurora_create_new_d_production_from_revision(
  p_generated_document_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_doc public.aurora_generated_documents;
  v_job public.aurora_content_jobs;
  v_new_job public.aurora_content_jobs;
  v_meta jsonb;
  v_workflow jsonb;
  v_new_workflow jsonb;
  v_revision_no integer;
  v_now timestamptz := now();
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select * into v_doc
  from public.aurora_generated_documents
  where id = p_generated_document_id
  for update;

  if v_doc.id is null then raise exception 'Document généré introuvable'; end if;
  if v_doc.job_id is null then raise exception 'Révision impossible : job éditorial absent'; end if;
  if v_doc.status = 'published' then raise exception 'Révision impossible : document publié'; end if;

  select * into v_job
  from public.aurora_content_jobs
  where id = v_doc.job_id
  for update;

  if v_job.id is null then raise exception 'Tâche éditoriale introuvable'; end if;

  v_workflow := coalesce(v_job.metadata->'workflow','{}'::jsonb);

  if coalesce((v_workflow->>'revision_requested')::boolean,false) is not true
     and coalesce((v_doc.metadata->'revision'->>'requested')::boolean,false) is not true then
    raise exception 'Ce document ne possède pas de demande de révision active';
  end if;

  if coalesce(v_workflow->>'revision_status','') = 'handed_off'
     or nullif(v_workflow->>'revision_new_job_id','') is not null
     or coalesce(v_doc.metadata->'revision'->>'status','') = 'handed_off' then
    raise exception 'Cette demande de révision a déjà été transmise à une nouvelle production D';
  end if;

  v_revision_no := coalesce((v_workflow->>'revision_no')::integer,0) + 1;

  -- Same production contract as CX -> D: fresh editorial production,
  -- no inherited final content, no generated PDF, and a new job identity.
  v_new_workflow := v_workflow
    - 'editorial_content'
    - 'scientific_latex_density'
    - 'geogebra_preflight'
    - 'scientific_preflight'
    - 'revision_requested'
    - 'revision_handed_off_at'
    - 'revision_new_job_id'
    || jsonb_build_object(
      'stage','redaction',
      'revision_requested',false,
      'revision_status','new_production',
      'revision_no',v_revision_no,
      'revision_source_generated_document_id',v_doc.id,
      'revision_source_job_id',v_job.id,
      'revision_source_version',coalesce(v_doc.version,1),
      'revision_parent_generated_document_id',v_doc.id,
      'revision_parent_job_id',v_job.id,
      'production_status','ready_for_editing',
      'production_started_at',null,
      'production_completed_at',null,
      'generated_document_id',null,
      'pending_admin_surface','d_production',
      'editor_ready',true,
      'chatgpt_editable',true,
      'proposal_status','validated_for_editing',
      'manual_pdf_launch_required',true,
      'auto_pdf_launch',false,
      'revision_created_at',v_now,
      'updated_at',v_now
    );

  insert into public.aurora_content_jobs (
    created_by,status,title,subject,level,class_name,document_type,source_format,
    prompt,instructions,source_document_ids,generated_document_id,error_message,metadata,
    domaine,formation,specialite,annee,semestre,filiere
  )
  values (
    v_job.created_by,
    'draft',
    v_job.title,
    v_job.subject,
    v_job.level,
    v_job.class_name,
    v_job.document_type,
    v_job.source_format,
    v_job.prompt,
    coalesce(v_job.instructions,'{}'::jsonb)
      || jsonb_build_object(
        'revision_source',
        jsonb_build_object(
          'generated_document_id',v_doc.id,
          'job_id',v_job.id,
          'version',coalesce(v_doc.version,1),
          'reason',coalesce(v_doc.metadata->'revision'->>'reason',v_workflow->>'revision_reason')
        )
      ),
    v_job.source_document_ids,
    null,
    null,
    coalesce(v_job.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'manual_publication_only',true,
        'pdf_launch_mode','manual',
        'manual_pdf_launch_required',true,
        'auto_pdf_launch',false,
        'workflow',v_new_workflow
      ),
    v_job.domaine,
    v_job.formation,
    v_job.specialite,
    v_job.annee,
    v_job.semestre,
    v_job.filiere
  )
  returning * into v_new_job;

  -- The old E source is history only. It must never remain an active D card.
  update public.aurora_content_jobs
  set status = 'rejected',
      metadata = coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object(
          'workflow',
          v_workflow
            || jsonb_build_object(
              'stage','revision_archive',
              'revision_requested',false,
              'revision_status','handed_off',
              'revision_no',v_revision_no,
              'revision_handed_off_at',v_now,
              'revision_new_job_id',v_new_job.id,
              'revision_source_generated_document_id',v_doc.id,
              'revision_source_version',coalesce(v_doc.version,1),
              'production_status','historical_revision_source',
              'pending_admin_surface','revision_history',
              'updated_at',v_now
            ),
          'admin_archived_from_active_editorial_circuit',true,
          'admin_archived_at',v_now
        ),
      updated_at = v_now
  where id = v_job.id;

  v_meta := coalesce(v_doc.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'revision_requested',false,
      'revision',
        coalesce(v_doc.metadata->'revision','{}'::jsonb)
        || jsonb_build_object(
          'requested',false,
          'status','handed_off',
          'handed_off_at',v_now,
          'new_job_id',v_new_job.id,
          'new_production_job_id',v_new_job.id,
          'source_generated_document_id',v_doc.id,
          'source_version',coalesce(v_doc.version,1)
        ),
      'revision_history',
        coalesce(v_doc.metadata->'revision_history','[]'::jsonb)
        || jsonb_build_array(
          jsonb_build_object(
            'event','handed_off_to_new_d_production',
            'at',v_now,
            'source_generated_document_id',v_doc.id,
            'source_job_id',v_job.id,
            'new_job_id',v_new_job.id,
            'source_version',coalesce(v_doc.version,1)
          )
        ),
      'production_status','historical_revision_source',
      'production_status_updated_at',v_now,
      'admin_archived_from_active_editorial_circuit',true,
      'admin_archived_at',v_now
    );

  update public.aurora_generated_documents
  set status = 'rejected',
      validation_notes = 'Source de révision archivé : nouvelle production D créée séparément.',
      metadata = v_meta,
      updated_at = v_now
  where id = v_doc.id;

  return jsonb_build_object(
    'ok',true,
    'source_generated_document_id',v_doc.id,
    'source_job_id',v_job.id,
    'new_job_id',v_new_job.id,
    'new_stage','redaction',
    'new_status','draft',
    'revision_no',v_revision_no,
    'old_document_preserved',true,
    'old_document_archived',true,
    'pdf_launch','manual'
  );
end;
$$;

comment on function public.aurora_create_new_d_production_from_revision(bigint)
is 'Section E -> D : crée une tâche D neuve comme CX -> D, avec generated_document_id nul et status draft ; archive le document/job source afin qu il ne reste jamais actif dans D.';
