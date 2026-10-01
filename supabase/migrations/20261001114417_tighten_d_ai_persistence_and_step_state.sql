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
  select * into j from public.aurora_content_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.'); end if;
  w:=coalesce(j.metadata->'workflow','{}'::jsonb);
  ai:=coalesce(w->'ai_treatment','{}'::jsonb);
  if coalesce(ai->>'run_id','') <> coalesce(p_run_id,'') then
    return jsonb_build_object('ok',false,'status','stale_run','error','Ce traitement n’est plus le traitement actif.');
  end if;
  if jsonb_typeof(p_content_json)<>'object' then
    return jsonb_build_object('ok',false,'status','blocked','error','Le contenu éditorial doit être un objet JSON.');
  end if;
  if j.generated_document_id is not null then
    return jsonb_build_object('ok',false,'status','already_ingested','generated_document_id',j.generated_document_id,'error','Cette tâche possède déjà un document ingéré.');
  end if;

  meta:=jsonb_set(coalesce(j.metadata,'{}'::jsonb),'{workflow,editorial_content}',p_content_json,true);
  meta:=jsonb_set(meta,'{workflow,ai_treatment}',ai||jsonb_build_object(
    'editorial_content_persisted_at',now(),
    'editorial_content_checksum',encode(digest(p_content_json::text,'sha256'),'hex')
  ),true);

  update public.aurora_content_jobs set metadata=meta where id=p_job_id;
  return jsonb_build_object('ok',true,'status','persisted','job_id',p_job_id);
end;
$function$


revoke all on function public.aurora_persist_d_ai_editorial_content(bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.aurora_persist_d_ai_editorial_content(bigint,text,jsonb) to service_role;
