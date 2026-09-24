-- Aurore: keep a real cancellation signal while a renderer is still active.
create or replace function public.aurora_cancel_pdf_generation(p_generated_document_id bigint)
returns public.aurora_generated_documents
language plpgsql
security definer
set search_path to public, private
as $function$
declare
  v_doc public.aurora_generated_documents;
  v_metadata jsonb;
  v_job public.aurora_content_jobs;
  v_job_metadata jsonb;
  v_now timestamptz:=now();
  v_attempt_id bigint;
  v_lualatex_status text;
  v_cancel_signal boolean;
begin
  if not private.is_aurora_admin() then raise exception 'Accès administrateur requis'; end if;
  select * into v_doc from public.aurora_generated_documents
  where id=p_generated_document_id for update;
  if v_doc.id is null then raise exception 'Document généré introuvable'; end if;
  v_metadata:=coalesce(v_doc.metadata,'{}'::jsonb);
  v_lualatex_status:=coalesce(v_metadata->>'lualatex_status','');
  if v_lualatex_status not in ('queued','processing','failed','cancelled') then
    raise exception 'Aucune génération PDF annulable pour le document %',p_generated_document_id;
  end if;
  v_cancel_signal:=(v_lualatex_status='processing');
  v_attempt_id:=nullif(v_metadata->>'production_attempt_id','')::bigint;
  v_metadata:=v_metadata||jsonb_build_object(
    'lualatex_cancel_requested',v_cancel_signal,
    'lualatex_cancel_requested_at',v_now,
    'lualatex_requested',false,
    'lualatex_retry_at',null,
    'lualatex_status','cancelled',
    'lualatex_stage','Production PDF annulée — document conservé et relançable',
    'lualatex_last_error',null,
    'lualatex_cancelled_at',v_now,
    'human_review_required',false,
    'production_status','cancelled',
    'production_status_updated_at',v_now
  );
  update public.aurora_generated_documents
  set status='generated',metadata=v_metadata,updated_at=v_now
  where id=p_generated_document_id returning * into v_doc;
  if v_attempt_id is not null then
    update public.aurora_generated_document_production_attempts set
      status='cancelled',
      finished_at=case when not v_cancel_signal then v_now else finished_at end,
      pdf_path=v_doc.pdf_path,pdf_url=v_doc.pdf_url,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'cancel_requested_at',v_now,'renderer_may_still_be_stopping',v_cancel_signal
      )
    where id=v_attempt_id;
  end if;
  select * into v_job from public.aurora_content_jobs
  where generated_document_id=p_generated_document_id order by updated_at desc limit 1 for update;
  if v_job.id is not null then
    v_job_metadata:=coalesce(v_job.metadata,'{}'::jsonb)||jsonb_build_object(
      'generation_cancel_requested',v_cancel_signal,
      'generation_cancel_requested_at',v_now,
      'generation_cancelled',true,
      'generation_cancelled_at',v_now,
      'generation_stage','Production PDF annulée — document conservé et relançable',
      'generation_last_error',null
    );
    update public.aurora_content_jobs set
      status='review',generated_document_id=p_generated_document_id,
      error_message=null,metadata=v_job_metadata,updated_at=v_now
    where id=v_job.id;
  end if;
  return v_doc;
end;
$function$;
revoke all on function public.aurora_cancel_pdf_generation(bigint) from public;
grant execute on function public.aurora_cancel_pdf_generation(bigint) to authenticated;