CREATE OR REPLACE FUNCTION public.aurora_enforce_document_word_volume()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  words integer;
  is_course boolean := lower(coalesce(new.document_type,'')) like '%cours%'
    and lower(coalesce(new.document_type,'')) not like '%exercice%';
  is_exercise boolean := lower(coalesce(new.document_type,'')) like '%exercice%';
  is_short_course boolean := is_course
    and coalesce((new.content_json #>> '{course_profile,short_format}')::boolean,false);
begin
  words := public.aurora_count_editorial_words(new.content_json, new.document_type);

  if (is_course or is_exercise) and not is_short_course and words < 3000 then
    raise exception 'AURORA_WORD_VOLUME_GATE: document insuffisant (% mots utiles; minimum 3000).', words;
  end if;

  return new;
end;
$function$


CREATE OR REPLACE FUNCTION public.aurora_enforce_course_quality()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  is_course boolean := lower(coalesce(new.document_type,'')) like '%cours%'
    and lower(coalesce(new.document_type,'')) not like '%exercice%';
  is_math boolean := lower(coalesce(new.subject,'')) like '%math%';
  short_format boolean := coalesce((new.content_json #>> '{course_profile,short_format}')::boolean,false);
  no_visuals boolean := coalesce((new.content_json #>> '{course_profile,no_visuals}')::boolean,false);
  reason text;
  section jsonb;
  item_text text;
  decision jsonb;
  words integer := 0;
  visuals integer := 0;
  decisions integer := 0;
  builds integer := 0;
begin
  if not is_course then
    return new;
  end if;

  if jsonb_typeof(coalesce(new.content_json,'{}'::jsonb)) <> 'object' then
    raise exception 'COURSE_QUALITY_GATE: content_json doit être un objet JSON.';
  end if;

  if trim(coalesce(new.content_json->>'title',''))='' then
    raise exception 'COURSE_QUALITY_GATE: content_json.title obligatoire.';
  end if;

  if trim(coalesce(new.content_json->>'title','')) <> trim(coalesce(new.title,'')) then
    raise exception 'COURSE_QUALITY_GATE: content_json.title doit correspondre au titre de la ligne.';
  end if;

  if length(trim(coalesce(new.content_json->>'introduction',''))) < 40 then
    raise exception 'COURSE_QUALITY_GATE: introduction pédagogique obligatoire.';
  end if;

  if jsonb_typeof(new.content_json->'sections') <> 'array'
     or jsonb_array_length(new.content_json->'sections') < 1 then
    raise exception 'COURSE_QUALITY_GATE: sections obligatoires.';
  end if;

  if short_format then
    reason := trim(coalesce(new.content_json #>> '{course_profile,short_format_reason}',''));
    if length(reason)<20 then
      raise exception 'COURSE_QUALITY_GATE: format court non justifié.';
    end if;
  else
    words := cardinality(
      regexp_split_to_array(
        regexp_replace(trim(coalesce(new.content_json->>'introduction','')),'[[:space:]]+',' ','g'),
        '[[:space:]]+'
      )
    );

    for section in select value from jsonb_array_elements(new.content_json->'sections') loop
      for item_text in select value from jsonb_array_elements_text(coalesce(section->'content','[]'::jsonb)) loop
        if trim(item_text)<>'' then
          words := words + cardinality(
            regexp_split_to_array(
              regexp_replace(trim(item_text),'[[:space:]]+',' ','g'),
              '[[:space:]]+'
            )
          );
        end if;
      end loop;
    end loop;

    if words < 3000 then
      raise exception 'COURSE_QUALITY_GATE: cours standard insuffisant (% mots utiles; minimum 3000).', words;
    end if;
  end if;

  if no_visuals then
    for section in select value from jsonb_array_elements(new.content_json->'sections') loop
      visuals := visuals + jsonb_array_length(coalesce(section->'visuals','[]'::jsonb));
    end loop;
    if visuals > 0 then
      raise exception 'COURSE_QUALITY_GATE: course_profile.no_visuals=true interdit tout visuel documentaire.';
    end if;
  elsif not is_math then
    if jsonb_typeof(new.content_json->'visual_plan') <> 'object'
       or new.content_json->'visual_plan'->>'schema_version' <> 'documentary-visual-plan-1'
       or jsonb_typeof(new.content_json->'visual_plan'->'decisions') <> 'array' then
      raise exception 'COURSE_QUALITY_GATE: visual_plan Wikimedia complet obligatoire.';
    end if;

    decisions := jsonb_array_length(new.content_json->'visual_plan'->'decisions');

    if decisions<>jsonb_array_length(new.content_json->'sections') then
      raise exception 'COURSE_QUALITY_GATE: une décision visuelle est obligatoire pour chaque section.';
    end if;

    for section in select value from jsonb_array_elements(new.content_json->'sections') loop
      visuals := visuals + jsonb_array_length(coalesce(section->'visuals','[]'::jsonb));
    end loop;

    if visuals<1 or visuals>8 then
      raise exception 'COURSE_QUALITY_GATE: un cours documentaire doit contenir entre 1 et 8 visuels Wikimedia.';
    end if;

    for decision in select value from jsonb_array_elements(new.content_json->'visual_plan'->'decisions') loop
      if lower(coalesce(decision->>'decision',''))='build' then
        builds:=builds+1;
        if jsonb_typeof(decision->'visual_ids')<>'array'
           or jsonb_array_length(decision->'visual_ids')<1 then
          raise exception 'COURSE_QUALITY_GATE: décision build sans visual_ids.';
        end if;
      elsif lower(coalesce(decision->>'decision',''))='not_needed' then
        if length(trim(coalesce(decision->>'rationale','')))<8 then
          raise exception 'COURSE_QUALITY_GATE: rationale obligatoire pour not_needed.';
        end if;
      else
        raise exception 'COURSE_QUALITY_GATE: décision visuelle invalide.';
      end if;
    end loop;

    if builds<1 then
      raise exception 'COURSE_QUALITY_GATE: au moins une section doit être illustrée.';
    end if;
  end if;

  return new;
end;
$function$


CREATE OR REPLACE FUNCTION public.aurora_begin_editorial_ai_treatment(p_job_id bigint, p_provider text, p_run_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare j public.aurora_content_jobs%rowtype; w jsonb; current_ai jsonb; history jsonb; next_ai jsonb;
begin
 if lower(trim(coalesce(p_provider,''))) not in ('grok','claude') then return jsonb_build_object('ok',false,'status','blocked','error','Moteur IA non supporté.'); end if;
 select * into j from public.aurora_content_jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.'); end if;
 w:=coalesce(j.metadata->'workflow','{}'::jsonb); current_ai:=coalesce(w->'ai_treatment','{}'::jsonb);
 if j.generated_document_id is not null then return jsonb_build_object('ok',false,'status','already_ingested','generated_document_id',j.generated_document_id,'error','Cette tâche possède déjà un generated_document_id.'); end if;
 if coalesce(w->>'stage','') not in ('redaction','production_en_cours') then return jsonb_build_object('ok',false,'status','blocked','error','La tâche n’est pas dans la Section D active.'); end if;
 if coalesce(w->'admin_validation'->>'status','') <> 'validated' or coalesce(w->>'proposal_status','') <> 'validated_for_editing' then return jsonb_build_object('ok',false,'status','blocked','error','Validation administrative CX absente ou incomplète.'); end if;
 if current_ai->>'status'='processing' then return jsonb_build_object('ok',false,'status','already_processing','run_id',current_ai->>'run_id','provider',current_ai->>'provider','progress',coalesce((current_ai->>'progress')::int,0)); end if;
 history:=case when jsonb_typeof(current_ai->'history')='array' then current_ai->'history' else '[]'::jsonb end;
 if current_ai->>'run_id' is not null then history:=history||jsonb_build_array(jsonb_build_object('run_id',current_ai->>'run_id','provider',current_ai->>'provider','status',coalesce(current_ai->>'status','unknown'),'progress',coalesce(current_ai->'progress','0'::jsonb),'stage',coalesce(current_ai->>'stage',''),'error',current_ai->'error','finished_at',current_ai->'finished_at')); end if;
 if jsonb_array_length(history)>12 then history:=(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(history) with ordinality where ordinality<=12); end if;
 next_ai:=jsonb_build_object('run_id',p_run_id,'provider',lower(trim(p_provider)),'status','processing','progress',3,'stage','preparation','label','Préparation du dossier D','started_at',now(),'updated_at',now(),'finished_at',null,'error',null,'history',history);
 update public.aurora_content_jobs set metadata=jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb),'{workflow,ai_treatment}',next_ai,true),'{workflow,stage}',to_jsonb('production_en_cours'::text),true) where id=p_job_id;
 return jsonb_build_object('ok',true,'status','started','run_id',p_run_id,'provider',lower(trim(p_provider)),'progress',3);
end;$function$


CREATE OR REPLACE FUNCTION public.aurora_patch_editorial_ai_treatment(p_job_id bigint, p_run_id text, p_patch jsonb, p_stage text DEFAULT NULL::text, p_production_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare j public.aurora_content_jobs%rowtype; w jsonb; current_ai jsonb; next_ai jsonb; next_meta jsonb;
begin
 select * into j from public.aurora_content_jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('ok',false,'status','not_found','error','Tâche introuvable.'); end if;
 w:=coalesce(j.metadata->'workflow','{}'::jsonb); current_ai:=coalesce(w->'ai_treatment','{}'::jsonb);
 if coalesce(current_ai->>'run_id','')<>coalesce(p_run_id,'') then return jsonb_build_object('ok',false,'status','stale_run','error','Ce traitement n’est plus le traitement actif.'); end if;
 next_ai:=current_ai||coalesce(p_patch,'{}'::jsonb); next_ai:=jsonb_set(next_ai,'{updated_at}',to_jsonb(now()),true);
 next_meta:=jsonb_set(coalesce(j.metadata,'{}'::jsonb),'{workflow,ai_treatment}',next_ai,true);
 if p_stage is not null then next_meta:=jsonb_set(next_meta,'{workflow,stage}',to_jsonb(p_stage),true); end if;
 if p_production_status is not null then next_meta:=jsonb_set(next_meta,'{workflow,production_status}',to_jsonb(p_production_status),true); end if;
 update public.aurora_content_jobs set metadata=next_meta where id=p_job_id;
 return jsonb_build_object('ok',true,'status','updated','ai_treatment',next_ai);
end;$function$


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
 update public.aurora_content_jobs set generated_document_id=p_generated_document_id,metadata=next_meta where id=p_job_id;
 return jsonb_build_object('ok',true,'status','completed','generated_document_id',p_generated_document_id);
end;$function$


revoke all on function public.aurora_begin_editorial_ai_treatment(bigint,text,text) from public, anon, authenticated;
revoke all on function public.aurora_patch_editorial_ai_treatment(bigint,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.aurora_finalize_editorial_ai_treatment(bigint,text,bigint,text) from public, anon, authenticated;
grant execute on function public.aurora_begin_editorial_ai_treatment(bigint,text,text) to service_role;
grant execute on function public.aurora_patch_editorial_ai_treatment(bigint,text,jsonb,text,text) to service_role;
grant execute on function public.aurora_finalize_editorial_ai_treatment(bigint,text,bigint,text) to service_role;
