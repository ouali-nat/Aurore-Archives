CREATE OR REPLACE FUNCTION public.aurora_persist_d_ai_editorial_content(p_job_id bigint, p_run_id text, p_content_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  j public.aurora_content_jobs%rowtype;
  w jsonb;
  ai jsonb;
  meta jsonb;
begin
  select * into j
  from public.aurora_content_jobs
  where id=p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.');
  end if;

  w:=coalesce(j.metadata->'workflow','{}'::jsonb);
  ai:=coalesce(w->'ai_treatment','{}'::jsonb);

  if coalesce(ai->>'run_id','') <> coalesce(p_run_id,'') then
    return jsonb_build_object('ok',false,'status','stale_run','error','Ce traitement n’est plus le traitement actif.');
  end if;

  if jsonb_typeof(p_content_json)<>'object' then
    return jsonb_build_object('ok',false,'status','blocked','error','Le contenu éditorial doit être un objet JSON.');
  end if;

  if j.generated_document_id is not null then
    return jsonb_build_object('ok',false,'status','already_ingested','generated_document_id',j.generated_document_id,
      'error','Cette tâche possède déjà un document ingéré.');
  end if;

  meta:=jsonb_set(
    coalesce(j.metadata,'{}'::jsonb),
    '{workflow,editorial_content}',
    p_content_json || jsonb_build_object('updated_at',now(),'source','section_D_multimodel','ai_run_id',p_run_id,'ai_provider',ai->>'provider'),
    true
  );

  meta:=jsonb_set(
    meta,
    '{workflow,ai_treatment}',
    ai || jsonb_build_object('editorial_content_persisted_at',now()),
    true
  );

  update public.aurora_content_jobs
  set metadata=meta
  where id=p_job_id;

  return jsonb_build_object('ok',true,'status','persisted','job_id',p_job_id);
end;
$function$


CREATE OR REPLACE FUNCTION public.aurora_finalize_editorial_ai_treatment(p_job_id bigint, p_run_id text, p_generated_document_id bigint, p_ingest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare j public.aurora_content_jobs%rowtype; w jsonb; current_ai jsonb; next_ai jsonb; next_meta jsonb;
begin
 select * into j from public.aurora_content_jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.'); end if;
 w:=coalesce(j.metadata->'workflow','{}'::jsonb); current_ai:=coalesce(w->'ai_treatment','{}'::jsonb);
 if coalesce(current_ai->>'run_id','')<>coalesce(p_run_id,'') then return jsonb_build_object('ok',false,'status','stale_run','error','Le traitement actif a changé avant la finalisation.'); end if;
 next_ai:=current_ai||jsonb_build_object('status','completed','progress',100,'stage','documents_en_attente','label','Document transféré vers Documents en attente','updated_at',now(),'finished_at',now(),'error',null,'generated_document_id',p_generated_document_id,'ingest_id',p_ingest_id);
 next_meta:=jsonb_set(coalesce(j.metadata,'{}'::jsonb),'{workflow,ai_treatment}',next_ai,true);
 next_meta:=jsonb_set(next_meta,'{workflow,stage}',to_jsonb('production_terminee'::text),true);
 next_meta:=jsonb_set(next_meta,'{workflow,production_status}',to_jsonb('editorial_completed'::text),true);
 next_meta:=jsonb_set(next_meta,'{workflow,production_completed_at}',to_jsonb(now()),true);
 next_meta:=jsonb_set(next_meta,'{workflow,generated_document_id}',to_jsonb(p_generated_document_id),true);
 next_meta:=jsonb_set(next_meta,'{workflow,pending_admin_surface}',to_jsonb('documents_en_attente'::text),true);
 next_meta:=jsonb_set(next_meta,'{workflow,editorial_ingest_id}',to_jsonb(p_ingest_id),true);
 next_meta:=jsonb_set(next_meta,'{workflow,auto_pdf_launch}',to_jsonb(false),true);
 next_meta:=jsonb_set(next_meta,'{workflow,manual_pdf_launch_required}',to_jsonb(true),true);
 if coalesce(w->>'revision_status','')='new_production' then
   next_meta:=jsonb_set(next_meta,'{workflow,revision_status}',to_jsonb('completed'::text),true);
 end if;
 update public.aurora_content_jobs
 set generated_document_id=p_generated_document_id,metadata=next_meta
 where id=p_job_id;
 return jsonb_build_object('ok',true,'status','completed','generated_document_id',p_generated_document_id);
end;$function$


revoke all on function public.aurora_persist_d_ai_editorial_content(bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.aurora_persist_d_ai_editorial_content(bigint,text,jsonb) to service_role;
