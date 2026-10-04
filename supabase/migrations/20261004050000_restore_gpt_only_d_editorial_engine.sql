-- D must use the canonical GPT/ChatGPT editorial engine only.
create or replace function public.aurora_begin_editorial_ai_treatment(p_job_id bigint, p_provider text, p_run_id text)
returns jsonb language plpgsql set search_path to 'public','pg_temp' as $function$
declare j public.aurora_content_jobs%rowtype; w jsonb; current_ai jsonb; history jsonb; next_ai jsonb; is_stale boolean:=false; normalized_provider text:=lower(trim(coalesce(p_provider,'')));
begin
 if normalized_provider <> 'gpt' then return jsonb_build_object('ok',false,'status','blocked','error','Section D utilise exclusivement le moteur GPT/ChatGPT.'); end if;
 select * into j from public.aurora_content_jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.'); end if;
 w:=coalesce(j.metadata->'workflow','{}'::jsonb); current_ai:=coalesce(w->'ai_treatment','{}'::jsonb);
 if j.generated_document_id is not null then return jsonb_build_object('ok',false,'status','already_ingested','generated_document_id',j.generated_document_id,'error','Cette tâche possède déjà un generated_document_id.'); end if;
 if coalesce(w->>'stage','') not in ('redaction','production_en_cours') then return jsonb_build_object('ok',false,'status','blocked','error','La tâche n’est pas dans la Section D active.'); end if;
 if coalesce(w->'admin_validation'->>'status','') <> 'validated' or coalesce(w->>'proposal_status','') <> 'validated_for_editing' then return jsonb_build_object('ok',false,'status','blocked','error','Validation administrative CX absente ou incomplète.'); end if;
 if current_ai->>'status'='processing' then begin is_stale:=coalesce((now()-(current_ai->>'updated_at')::timestamptz)>interval '12 minutes',false); exception when others then is_stale:=false; end;
   if not is_stale then return jsonb_build_object('ok',false,'status','already_processing','run_id',current_ai->>'run_id','provider',current_ai->>'provider','progress',coalesce((current_ai->>'progress')::int,0)); end if;
 end if;
 history:=case when jsonb_typeof(current_ai->'history')='array' then current_ai->'history' else '[]'::jsonb end;
 if current_ai->>'run_id' is not null then history:=history||jsonb_build_array(jsonb_build_object('run_id',current_ai->>'run_id','provider',current_ai->>'provider','status',case when is_stale then 'stale_recovered' else coalesce(current_ai->>'status','unknown') end,'progress',coalesce(current_ai->'progress','0'::jsonb),'stage',coalesce(current_ai->>'stage',''),'step',coalesce(current_ai->>'step',''),'error',current_ai->'error','finished_at',current_ai->'finished_at','recovered_at',case when is_stale then to_jsonb(now()) else null end)); end if;
 if jsonb_array_length(history)>12 then history:=(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(history) with ordinality where ordinality<=12); end if;
 next_ai:=jsonb_build_object('run_id',p_run_id,'provider','gpt','status','processing','progress',3,'stage','preparation','step','generate','label','Préparation du dossier D avec ChatGPT','started_at',now(),'updated_at',now(),'finished_at',null,'error',null,'attempt',1,'history',history);
 update public.aurora_content_jobs set metadata=jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb),'{workflow,ai_treatment}',next_ai,true),'{workflow,stage}',to_jsonb('production_en_cours'::text),true) where id=p_job_id;
 return jsonb_build_object('ok',true,'status','started','run_id',p_run_id,'provider','gpt','progress',3,'recovered_stale',is_stale);
end;$function$;