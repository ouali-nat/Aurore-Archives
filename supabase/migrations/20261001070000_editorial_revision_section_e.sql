-- Section E : documents à réviser
-- Un document existant peut être remis dans le circuit éditorial sans
-- supprimer son historique ni lancer automatiquement un nouveau PDF.
create or replace function public.aurora_request_editorial_revision(
  p_generated_document_id bigint,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_doc public.aurora_generated_documents;
  v_job public.aurora_content_jobs;
  v_meta jsonb;
  v_workflow jsonb;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select * into v_doc
  from public.aurora_generated_documents
  where id = p_generated_document_id
  for update;

  if v_doc.id is null then
    raise exception 'Document généré introuvable';
  end if;

  if v_doc.status = 'published' then
    raise exception 'Révision impossible : le document est déjà publié';
  end if;

  if coalesce((v_doc.metadata->>'admin_deleted')::boolean,false) then
    raise exception 'Révision impossible : le document a été retiré du circuit';
  end if;

  if coalesce((v_doc.metadata->'revision'->>'requested')::boolean,false) then
    return jsonb_build_object(
      'ok',true,
      'already_requested',true,
      'generated_document_id',v_doc.id,
      'job_id',v_doc.job_id
    );
  end if;

  if v_doc.job_id is null then
    raise exception 'Révision impossible : aucun job éditorial associé';
  end if;

  select * into v_job
  from public.aurora_content_jobs
  where id = v_doc.job_id
  for update;

  if v_job.id is null then
    raise exception 'Révision impossible : tâche éditoriale introuvable';
  end if;

  v_workflow := coalesce(v_job.metadata->'workflow','{}'::jsonb);

  v_meta := coalesce(v_doc.metadata,'{}'::jsonb) ||
    jsonb_build_object(
      'revision', jsonb_build_object(
        'requested', true,
        'requested_at', v_now,
        'requested_by', 'admin',
        'reason', v_reason,
        'source_generated_document_id', v_doc.id,
        'source_job_id', v_job.id,
        'source_version', coalesce(v_doc.version,1)
      ),
      'revision_requested', true,
      'revision_requested_at', v_now,
      'revision_reason', v_reason
    );

  update public.aurora_generated_documents
  set metadata=v_meta, updated_at=v_now
  where id=v_doc.id;

  update public.aurora_content_jobs
  set metadata = coalesce(v_job.metadata,'{}'::jsonb) || jsonb_build_object(
        'manual_publication_only',true,
        'pdf_launch_mode','manual',
        'manual_pdf_launch_required',true,
        'auto_pdf_launch',false,
        'workflow', v_workflow || jsonb_build_object(
          'revision_requested',true,
          'revision_requested_at',v_now,
          'revision_reason',v_reason,
          'revision_source_generated_document_id',v_doc.id,
          'revision_source_version',coalesce(v_doc.version,1),
          'revision_status','requested',
          'revision_previous_stage',coalesce(v_workflow->>'stage','production_terminee'),
          'updated_at',v_now
        )
      ),
      status='review',
      updated_at=v_now
  where id=v_job.id;

  return jsonb_build_object(
    'ok',true,
    'already_requested',false,
    'generated_document_id',v_doc.id,
    'job_id',v_job.id,
    'revision_requested_at',v_now
  );
end;
$$;

create or replace function public.aurora_list_editorial_revision_documents()
returns table(
  generated_document_id bigint,
  job_id bigint,
  title text,
  subject text,
  level text,
  class_name text,
  document_type text,
  status text,
  version integer,
  pdf_url text,
  pdf_path text,
  updated_at timestamptz,
  metadata jsonb,
  workflow jsonb,
  revision_reason text,
  revision_requested_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  return query
  select
    d.id, d.job_id, d.title, d.subject, d.level, d.class_name,
    d.document_type, d.status, d.version, d.pdf_url, d.pdf_path,
    d.updated_at, d.metadata,
    coalesce(j.metadata->'workflow','{}'::jsonb),
    nullif(coalesce(d.metadata->'revision'->>'reason',j.metadata->'workflow'->>'revision_reason'),''),
    coalesce(
      nullif(d.metadata->'revision'->>'requested_at','')::timestamptz,
      nullif(j.metadata->'workflow'->>'revision_requested_at','')::timestamptz
    )
  from public.aurora_generated_documents d
  join public.aurora_content_jobs j on j.id=d.job_id
  where coalesce((d.metadata->'revision'->>'requested')::boolean,false)=true
     or coalesce((j.metadata->'workflow'->>'revision_requested')::boolean,false)=true
  order by coalesce(
    nullif(d.metadata->'revision'->>'requested_at','')::timestamptz,
    nullif(j.metadata->'workflow'->>'revision_requested_at','')::timestamptz,
    d.updated_at
  ) desc;
end;
$$;

create or replace function public.aurora_begin_editorial_revision(
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
  v_meta jsonb;
  v_job_meta jsonb;
  v_workflow jsonb;
  v_now timestamptz := now();
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select * into v_doc
  from public.aurora_generated_documents
  where id=p_generated_document_id
  for update;

  if v_doc.id is null then raise exception 'Document généré introuvable'; end if;
  if v_doc.status='published' then raise exception 'Révision impossible : document publié'; end if;
  if v_doc.job_id is null then raise exception 'Révision impossible : job éditorial absent'; end if;

  select * into v_job from public.aurora_content_jobs where id=v_doc.job_id for update;
  if v_job.id is null then raise exception 'Tâche éditoriale introuvable'; end if;

  v_job_meta:=coalesce(v_job.metadata,'{}'::jsonb);
  v_workflow:=coalesce(v_job_meta->'workflow','{}'::jsonb);

  if coalesce((v_workflow->>'revision_requested')::boolean,false) is not true
     and coalesce((v_doc.metadata->'revision'->>'requested')::boolean,false) is not true then
    raise exception 'Ce document ne possède pas de demande de révision active';
  end if;

  v_workflow := v_workflow || jsonb_build_object(
    'stage','redaction',
    'revision_requested',false,
    'revision_status','in_progress',
    'revision_started_at',v_now,
    'revision_source_generated_document_id',v_doc.id,
    'revision_source_version',coalesce(v_doc.version,1),
    'production_status','revision_in_progress',
    'manual_pdf_launch_required',true,
    'auto_pdf_launch',false,
    'updated_at',v_now
  );

  v_job_meta := v_job_meta || jsonb_build_object(
    'manual_publication_only',true,
    'pdf_launch_mode','manual',
    'manual_pdf_launch_required',true,
    'auto_pdf_launch',false,
    'workflow',v_workflow
  );

  update public.aurora_content_jobs
  set metadata=v_job_meta,status='review',updated_at=v_now
  where id=v_job.id;

  v_meta:=coalesce(v_doc.metadata,'{}'::jsonb) || jsonb_build_object(
    'revision_requested',false,
    'revision',coalesce(v_doc.metadata->'revision','{}'::jsonb) || jsonb_build_object(
      'requested',false,
      'started_at',v_now,
      'status','in_progress'
    ),
    'production_status','revision_in_progress',
    'production_status_updated_at',v_now
  );

  update public.aurora_generated_documents
  set metadata=v_meta,updated_at=v_now
  where id=v_doc.id;

  return jsonb_build_object(
    'ok',true,
    'generated_document_id',v_doc.id,
    'job_id',v_job.id,
    'stage','redaction'
  );
end;
$$;

comment on function public.aurora_request_editorial_revision(bigint,text)
is 'Section E : demande admin de révision d''un document produit. Conserve l''historique, ne lance aucun PDF et prépare une reprise contrôlée par D.';

comment on function public.aurora_list_editorial_revision_documents()
is 'Section E : liste administrative des documents dont une révision éditoriale est demandée.';

comment on function public.aurora_begin_editorial_revision(bigint)
is 'Section E→D : consomme explicitement une demande de révision et replace le job en redaction. Aucun PDF n''est lancé.';
