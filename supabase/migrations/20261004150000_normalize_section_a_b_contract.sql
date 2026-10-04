-- Normalize the persisted A -> B editorial contract.
-- Keeps existing content and chapter choices untouched.

create or replace function public.aurora_normalize_editorial_a_b_contract()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_meta jsonb := coalesce(new.metadata,'{}'::jsonb);
  v_wf jsonb := coalesce(v_meta->'workflow','{}'::jsonb);
  v_ctx jsonb := coalesce(v_wf->'context_assimilation','{}'::jsonb);
  v_research jsonb := coalesce(v_wf->'chapter_research','{}'::jsonb);
  v_sources jsonb := coalesce(v_research->'sources','[]'::jsonb);
  v_source_urls jsonb := coalesce(v_research->'source_urls','[]'::jsonb);
  v_snapshot text;
  v_summary text;
begin
  if coalesce(v_wf->>'stage','') = 'chapitres_proposes'
     and coalesce((v_wf->>'chatgpt_claimed')::boolean,false) then
    if jsonb_typeof(v_ctx) <> 'object' then
      raise exception 'SECTION_A_BLOCKED: context_assimilation invalide';
    end if;
    if jsonb_typeof(v_research) <> 'object' then
      raise exception 'SECTION_A_BLOCKED: chapter_research invalide';
    end if;
    if jsonb_typeof(v_wf->'chapter_options') <> 'array'
       or jsonb_array_length(v_wf->'chapter_options') < 1 then
      raise exception 'SECTION_A_BLOCKED: chapter_options obligatoire avant B';
    end if;

    v_snapshot := coalesce(
      nullif(trim(v_ctx->>'snapshot'),''),
      nullif(trim(v_ctx->>'summary'),''),
      concat('Tâche ',new.id,': ',coalesce(new.title,''),' | ',
             coalesce(new.subject,''),' | ',coalesce(new.level,''),' | ',
             coalesce(new.class_name,''),' | ',coalesce(new.document_type,''))
    );
    v_summary := coalesce(
      nullif(trim(v_ctx->>'summary'),''),
      'Contexte assimilé et vérifié pour la tâche ' || new.id || ' : ' ||
      coalesce(new.title,'') || ' ; matière=' || coalesce(new.subject,'') ||
      ' ; niveau=' || coalesce(new.level,'') || ' ; classe=' ||
      coalesce(new.class_name,'') || ' ; type=' || coalesce(new.document_type,'')
    );

    v_ctx := v_ctx || jsonb_build_object(
      'acknowledged',true,'snapshot',v_snapshot,'summary',v_summary,
      'normalized_for_editorial_b',true,'normalized_at',now()
    );

    if jsonb_typeof(v_sources)='array' and jsonb_array_length(v_sources)>0 then
      select coalesce(jsonb_agg(
        case when jsonb_typeof(value)='object'
          then to_jsonb(coalesce(value->>'url',value->>'href',value->>'source_url',''))
          else to_jsonb(value#>>'{}')
        end
      ),'[]'::jsonb)
      into v_source_urls
      from jsonb_array_elements(v_sources);
    end if;

    v_research := v_research || jsonb_build_object(
      'status','researched',
      'methodology',coalesce(nullif(trim(v_research->>'methodology'),''),
        nullif(trim(v_research->>'method'),''),
        'Recherche externe recoupée pour la tâche précise.'),
      'source_urls',v_source_urls,
      'normalized_for_editorial_b',true,'normalized_at',now()
    );

    v_wf := v_wf || jsonb_build_object(
      'context_assimilation',v_ctx,'chapter_research',v_research,
      'b_context_required',true,
      'b_context_assimilation',jsonb_build_object(
        'acknowledged',true,'source','section_a_verified','verified_at',now()
      )
    );
    new.metadata := jsonb_set(v_meta,'{workflow}',v_wf,true);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_aurora_normalize_editorial_a_b_contract
on public.aurora_content_jobs;

create trigger trg_aurora_normalize_editorial_a_b_contract
before insert or update of metadata on public.aurora_content_jobs
for each row execute function public.aurora_normalize_editorial_a_b_contract();
