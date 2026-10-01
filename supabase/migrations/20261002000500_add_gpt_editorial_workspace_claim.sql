-- Isolate GPT ownership from Section D and keep the task in the GPT workspace until canonical ingestion.
create or replace function public.aurora_claim_gpt_editorial_task(p_job_id bigint, p_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.aurora_content_jobs%rowtype;
  w jsonb;
  current_ai jsonb;
  next_ai jsonb;
  v_run text := nullif(trim(coalesce(p_run_id,'')),'');
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;
  if v_run is null then raise exception 'Identifiant de traitement GPT requis'; end if;
  select * into j from public.aurora_content_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.'); end if;
  w:=coalesce(j.metadata->'workflow','{}'::jsonb);
  current_ai:=coalesce(w->'ai_treatment','{}'::jsonb);
  if j.generated_document_id is not null then return jsonb_build_object('ok',false,'status','already_ingested','error','Cette tâche est déjà dans Documents en attente.'); end if;
  if coalesce(w->>'stage','') not in ('redaction','production_en_cours') then return jsonb_build_object('ok',false,'status','blocked','error','La tâche n’est pas disponible dans la Section D.'); end if;
  if coalesce(w->'admin_validation'->>'status','') <> 'validated' or coalesce(w->>'proposal_status','') <> 'validated_for_editing' then return jsonb_build_object('ok',false,'status','blocked','error','Validation administrative CX absente ou incomplète.'); end if;
  if current_ai->>'status'='processing' then return jsonb_build_object('ok',false,'status','already_processing','provider',current_ai->>'provider','run_id',current_ai->>'run_id','error','Cette tâche est déjà prise par un éditeur.'); end if;
  next_ai:=jsonb_build_object('run_id',v_run,'provider','gpt','status','processing','progress',3,'stage','manual_editor_workspace','step','editorial_editing','label','Traitement dans l’espace GPT','started_at',now(),'updated_at',now(),'finished_at',null,'error',null,'attempt',1);
  update public.aurora_content_jobs
  set metadata=jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb),'{workflow,ai_treatment}',next_ai,true),'{workflow,stage}',to_jsonb('production_en_cours'::text),true), updated_at=now()
  where id=p_job_id;
  return jsonb_build_object('ok',true,'status','processing','provider','gpt','run_id',v_run,'progress',3);
end;
$$;
revoke all on function public.aurora_claim_gpt_editorial_task(bigint,text) from public;
grant execute on function public.aurora_claim_gpt_editorial_task(bigint,text) to authenticated;