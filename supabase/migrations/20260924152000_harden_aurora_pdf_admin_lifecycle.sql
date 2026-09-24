-- Aurore: harden the PDF production attempt lifecycle.
create or replace function public.aurora_start_pdf_production_attempt(p_generated_document_id bigint)
returns public.aurora_generated_document_production_attempts
language plpgsql
security definer
set search_path to public, private
as $function$
declare
  v_doc public.aurora_generated_documents;
  v_attempt public.aurora_generated_document_production_attempts;
  v_next integer;
  v_meta jsonb;
  v_now timestamptz := now();
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;
  select * into v_doc from public.aurora_generated_documents
  where id=p_generated_document_id for update;
  if v_doc.id is null then raise exception 'Document généré introuvable'; end if;
  if v_doc.status='published' then raise exception 'Production impossible : le document est déjà publié'; end if;
  if coalesce((v_doc.metadata->>'admin_deleted')::boolean,false) then
    raise exception 'Production impossible : le document a été retiré du circuit';
  end if;
  select * into v_attempt
  from public.aurora_generated_document_production_attempts
  where generated_document_id=p_generated_document_id and status in ('queued','processing')
  order by attempt_no desc limit 1;
  if v_attempt.id is not null then return v_attempt; end if;
  select coalesce(max(attempt_no),0)+1 into v_next
  from public.aurora_generated_document_production_attempts
  where generated_document_id=p_generated_document_id;
  insert into public.aurora_generated_document_production_attempts(
    generated_document_id,attempt_no,status,metadata
  ) values (
    p_generated_document_id,v_next,'queued',
    jsonb_build_object('started_by','admin','source','Aurore Production & validation PDF','created_at',v_now)
  ) returning * into v_attempt;
  v_meta:=coalesce(v_doc.metadata,'{}'::jsonb)||jsonb_build_object(
    'production_status','queued','production_attempt_id',v_attempt.id,
    'production_attempt_no',v_next,'production_attempt_started_at',v_now,
    'production_status_updated_at',v_now
  );
  update public.aurora_generated_documents set metadata=v_meta,updated_at=v_now
  where id=p_generated_document_id;
  return v_attempt;
end;
$function$;
revoke all on function public.aurora_start_pdf_production_attempt(bigint) from public;
grant execute on function public.aurora_start_pdf_production_attempt(bigint) to authenticated;

create or replace function public.aurora_archive_generated_document(p_generated_document_id bigint)
returns public.aurora_generated_documents
language plpgsql
security definer
set search_path to public, private
as $function$
declare
  v_doc public.aurora_generated_documents;
  v_meta jsonb;
  v_job public.aurora_content_jobs;
  v_now timestamptz:=now();
begin
  if not private.is_aurora_admin() then raise exception 'Accès administrateur requis'; end if;
  select * into v_doc from public.aurora_generated_documents
  where id=p_generated_document_id for update;
  if v_doc.id is null then raise exception 'Document généré introuvable'; end if;
  if v_doc.status='published' or v_doc.published_document_id is not null then
    raise exception 'Suppression impossible : le document a déjà été publié';
  end if;
  v_meta:=coalesce(v_doc.metadata,'{}'::jsonb);
  if v_meta->>'lualatex_status' in ('queued','processing')
     or v_meta->>'production_status' in ('queued','processing') then
    raise exception 'Suppression impossible pendant une production. Annule d’abord la génération.';
  end if;
  v_meta:=v_meta||jsonb_build_object(
    'admin_deleted',true,'admin_deleted_at',v_now,
    'admin_deleted_from_status',v_doc.status,'admin_deleted_by','admin'
  );
  update public.aurora_generated_documents set
    status='rejected',
    validation_notes='Retiré du circuit de production par l’administration.',
    metadata=v_meta,updated_at=v_now
  where id=p_generated_document_id returning * into v_doc;
  select * into v_job from public.aurora_content_jobs
  where generated_document_id=p_generated_document_id order by updated_at desc limit 1 for update;
  if v_job.id is not null then
    update public.aurora_content_jobs set
      status='rejected',error_message=null,
      metadata:=coalesce(v_job.metadata,'{}'::jsonb)||jsonb_build_object(
        'admin_deleted',true,'admin_deleted_at',v_now,
        'generation_stage','Retiré du circuit de production par l’administration'
      ),
      updated_at=v_now
    where id=v_job.id;
  end if;
  return v_doc;
end;
$function$;
revoke all on function public.aurora_archive_generated_document(bigint) from public;
grant execute on function public.aurora_archive_generated_document(bigint) to authenticated;