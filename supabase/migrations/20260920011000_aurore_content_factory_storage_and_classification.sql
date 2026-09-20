create or replace function public.aurora_create_content_job(
  p_title text,
  p_subject text default null,
  p_level text default null,
  p_class_name text default null,
  p_document_type text default 'fiche de révision',
  p_prompt text default null,
  p_instructions jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_id bigint;
  v_category text;
  v_instructions jsonb;
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
      'resource_type', nullif(trim(coalesce(p_document_type,'')), '')
    )
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.aurora_publish_generated_document(
  p_generated_document_id bigint,
  p_notes text default null
)
returns public.aurora_generated_documents
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_doc public.aurora_generated_documents;
  v_id bigint;
  v_pub public."Document";
  v_job public.aurora_content_jobs;
  v_category text;
  v_filiere text;
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select * into v_doc
  from public.aurora_generated_documents
  where id=p_generated_document_id
  for update;

  if v_doc.id is null then
    raise exception 'Document généré introuvable';
  end if;

  if v_doc.status not in ('approved','review') then
    raise exception 'Publication impossible depuis le statut %',v_doc.status;
  end if;

  if v_doc.pdf_url is null or length(trim(v_doc.pdf_url))=0 then
    raise exception 'Le PDF doit être généré avant publication';
  end if;

  if v_doc.published_document_id is not null then
    update public.aurora_generated_documents
    set status='published',
        validation_notes=coalesce(p_notes,validation_notes),
        updated_at=now()
    where id=v_doc.id
    returning * into v_doc;
    return v_doc;
  end if;

  select * into v_job
  from public.aurora_content_jobs
  where id=v_doc.job_id;

  v_category := coalesce(
    nullif(trim(coalesce(v_job.instructions->>'category','')), ''),
    nullif(trim(coalesce(v_job.metadata->>'category','')), ''),
    case when lower(coalesce(v_doc.document_type,'')) in ('devoir','exercice','devoirs')
      then 'Devoirs' else 'Documents' end
  );

  if v_category not in ('Documents','Devoirs') then
    v_category := 'Documents';
  end if;

  v_filiere := nullif(trim(coalesce(
    v_job.instructions->>'filiere',
    v_job.metadata->>'filiere',
    ''
  )), '');

  insert into public."Document" (
    "Titre","Niveau","Classe","Filiere","Matière","Catégorie",
    "Auteur","Fichier_url","Publie","Source","Droits_confirmes",
    "Genre","Telechargement_autorise","Mis_en_avant"
  ) values (
    v_doc.title,
    coalesce(v_doc.level,'Culture générale'),
    v_doc.class_name,
    v_filiere,
    v_doc.subject,
    v_category,
    'Aurore',
    v_doc.pdf_url,
    true,
    'Aurore — Content Factory',
    true,
    null,
    true,
    false
  )
  returning * into v_pub;

  v_id := v_pub.id;

  update public.aurora_generated_documents
  set status='published',
      published_document_id=v_id,
      validation_notes=coalesce(p_notes,validation_notes),
      updated_at=now()
  where id=v_doc.id
  returning * into v_doc;

  update public.aurora_content_jobs
  set status='published',
      updated_at=now()
  where id=v_doc.job_id;

  return v_doc;
end;
$function$;
