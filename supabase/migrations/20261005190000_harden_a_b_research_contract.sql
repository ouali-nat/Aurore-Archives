-- Aurore — harden A → B research contract.
-- Canonical rule: B is only reachable when the persisted research dossier is
-- normalized, verified, sourced, and usable by the editorial UI.

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
  v_findings text := '';
  v_results_findings text := '';
  v_methodology text := '';
  v_distinct_hosts integer := 0;
  v_source_count integer := 0;
  v_scientific boolean := false;
  v_option_count integer := 0;
  v_bad_option boolean := false;
  v_now timestamptz := now();
begin
  if coalesce((v_wf->>'chatgpt_claimed')::boolean,false)
     and coalesce(v_wf->>'stage','') in ('initiale','chapitres_demandes','chapitres_proposes') then

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
      concat('Tâche ',new.id,': ',coalesce(new.title,''),' | ',coalesce(new.subject,''),' | ',
             coalesce(new.level,''),' | ',coalesce(new.class_name,''),' | ',coalesce(new.document_type,''))
    );

    v_summary := coalesce(
      nullif(trim(v_ctx->>'summary'),''),
      'Contexte assimilé et vérifié pour la tâche ' || new.id || ' : ' ||
      coalesce(new.title,'') || ' ; matière=' || coalesce(new.subject,'') ||
      ' ; niveau=' || coalesce(new.level,'') || ' ; classe=' ||
      coalesce(new.class_name,'') || ' ; type=' || coalesce(new.document_type,'')
    );

    v_ctx := v_ctx || jsonb_build_object(
      'acknowledged',true,
      'snapshot',v_snapshot,
      'summary',v_summary,
      'normalized_for_editorial_b',true,
      'normalized_at',v_now
    );

    if jsonb_typeof(v_source_urls)='array' and jsonb_array_length(v_source_urls)>0 then
      select coalesce(jsonb_agg(to_jsonb(btrim(case
        when jsonb_typeof(value)='object' then coalesce(value->>'url',value->>'href',value->>'source_url','')
        else value#>>'{}'
      end))), '[]'::jsonb)
      into v_source_urls
      from jsonb_array_elements(v_source_urls)
      where btrim(case
        when jsonb_typeof(value)='object' then coalesce(value->>'url',value->>'href',value->>'source_url','')
        else value#>>'{}'
      end)<>'';
    elsif jsonb_typeof(v_sources)='array' and jsonb_array_length(v_sources)>0 then
      select coalesce(jsonb_agg(to_jsonb(btrim(case
        when jsonb_typeof(value)='object' then coalesce(value->>'url',value->>'href',value->>'source_url','')
        else value#>>'{}'
      end))), '[]'::jsonb)
      into v_source_urls
      from jsonb_array_elements(v_sources)
      where btrim(case
        when jsonb_typeof(value)='object' then coalesce(value->>'url',value->>'href',value->>'source_url','')
        else value#>>'{}'
      end)<>'';
    else
      v_source_urls := '[]'::jsonb;
    end if;

    v_methodology := btrim(coalesce(v_research->>'methodology',v_research->>'method',''));

    v_findings := btrim(coalesce(
      nullif(v_research->>'findings',''),
      nullif(v_research->>'constats',''),
      nullif(v_research->>'researchFindings',''),
      ''
    ));

    if v_findings='' and jsonb_typeof(v_research->'results')='array' then
      select btrim(coalesce(string_agg(
        case
          when jsonb_typeof(value)='object' then coalesce(value->>'finding',value->>'constat',value->>'summary',value->>'text','')
          else value#>>'{}'
        end,
        E'\n'
      ),'')) into v_results_findings
      from jsonb_array_elements(v_research->'results');
      v_findings := btrim(coalesce(v_results_findings,''));
    end if;

    v_source_count := case
      when jsonb_typeof(v_source_urls)='array' then jsonb_array_length(v_source_urls)
      else 0
    end;

    if v_source_count>0 then
      select count(distinct lower(
        regexp_replace(
          regexp_replace(value#>>'{}','^[A-Za-z][A-Za-z0-9+.-]*://([^/]+).*$', '\\1'),
          '[/:?#].*$',''
        )
      ))
      into v_distinct_hosts
      from jsonb_array_elements(v_source_urls)
      where btrim(value#>>'{}')<>'';
    end if;

    v_scientific := lower(btrim(coalesce(new.subject,''))) in (
      'mathématiques','mathematiques','maths',
      'physique','physique-chimie','physique chimie',
      'chimie','sciences physiques',
      'svt','sciences de la vie et de la terre',
      'sciences de la vie','sciences de la terre'
    );

    v_option_count := case
      when jsonb_typeof(v_wf->'chapter_options')='array' then jsonb_array_length(v_wf->'chapter_options')
      else 0
    end;

    v_bad_option := v_option_count>0 and exists(
      select 1
      from jsonb_array_elements(v_wf->'chapter_options') as e(value)
      where btrim(case
        when jsonb_typeof(value)='object' then coalesce(value->>'title',value->>'name','')
        when jsonb_typeof(value)='string' then value#>>'{}'
        else ''
      end)=''
    );

    if v_methodology='' or length(v_methodology)<10 then
      raise exception 'SECTION_A_BLOCKED: méthodologie de recherche persistée insuffisante';
    end if;
    if length(v_findings)<40 then
      raise exception 'SECTION_A_BLOCKED: constats de recherche persistés insuffisants (minimum 40 caractères)';
    end if;
    if v_source_count<1 then
      raise exception 'SECTION_A_BLOCKED: au moins une URL de source valide est obligatoire';
    end if;
    if v_bad_option then
      raise exception 'SECTION_A_BLOCKED: chaque proposition de chapitre doit avoir un titre';
    end if;
    if v_scientific and v_distinct_hosts<3 then
      raise exception 'SECTION_A_BLOCKED: une matière scientifique exige 3 hôtes distincts réellement calculés';
    end if;

    v_research := v_research || jsonb_build_object(
      'status','researched',
      'methodology',v_methodology,
      'findings',v_findings,
      'source_urls',v_source_urls,
      'distinct_hosts',v_distinct_hosts,
      'normalized_for_editorial_b',true,
      'normalized_at',v_now
    );

    v_wf := v_wf || jsonb_build_object(
      'context_assimilation',v_ctx,
      'chapter_research',v_research,
      'b_context_required',true,
      'b_context_assimilation',jsonb_build_object(
        'acknowledged',true,
        'source','section_a_verified',
        'verified_at',v_now
      ),
      'research_verification',jsonb_build_object(
        'status','verified',
        'version','a-b-research-contract-v2',
        'verified_at',v_now,
        'findings_chars',length(v_findings),
        'source_count',v_source_count,
        'distinct_hosts',v_distinct_hosts,
        'option_count',v_option_count,
        'checks','context+methodology+findings+sources+options+scientific_hosts'
      ),
      'research_verified_at',v_now,
      'research_verification_state','persisted_and_validated'
    );

    new.metadata := jsonb_set(v_meta,'{workflow}',v_wf,true);
  end if;

  return new;
end;
$function$;

create or replace function public.aurora_section_a_to_b_transition()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  wf jsonb := coalesce(new.metadata->'workflow','{}'::jsonb);
  cr jsonb := coalesce(wf->'chapter_research','{}'::jsonb);
  opts jsonb := coalesce(wf->'chapter_options','[]'::jsonb);
  verification jsonb := coalesce(wf->'research_verification','{}'::jsonb);
  subject_l text := lower(btrim(coalesce(new.subject,'')));
  scientific boolean := subject_l in (
    'mathématiques','mathematiques','maths',
    'physique','physique-chimie','physique chimie',
    'chimie','sciences physiques',
    'svt','sciences de la vie et de la terre',
    'sciences de la vie','sciences de la terre'
  );
  source_count integer := 0;
  option_count integer := 0;
  findings_len integer := length(btrim(coalesce(cr->>'findings','')));
  methodology_len integer := length(btrim(coalesce(cr->>'methodology',cr->>'method','')));
  distinct_hosts integer := coalesce((verification->>'distinct_hosts')::integer,0);
begin
  source_count := case
    when jsonb_typeof(cr->'source_urls')='array' then jsonb_array_length(cr->'source_urls')
    when jsonb_typeof(cr->'sources')='array' then jsonb_array_length(cr->'sources')
    else 0
  end;
  option_count := case
    when jsonb_typeof(opts)='array' then jsonb_array_length(opts)
    else 0
  end;

  if coalesce(wf->>'stage','') in ('initiale','chapitres_demandes')
     and coalesce((wf->>'chatgpt_claimed')::boolean,false) then

    if lower(coalesce(verification->>'status','')) <> 'verified'
       or coalesce(verification->>'version','') <> 'a-b-research-contract-v2' then
      raise exception 'SECTION_A_BLOCKED: aucune migration A→B sans vérification persistée du dossier de recherche.';
    end if;

    if lower(coalesce(cr->>'status','')) <> 'researched'
       or findings_len < 40
       or methodology_len < 10
       or source_count < 1
       or option_count < 1 then
      raise exception 'SECTION_A_BLOCKED: recherche, constats, méthodologie, sources et propositions doivent être complets avant B.';
    end if;

    if scientific and distinct_hosts < 3 then
      raise exception 'SECTION_A_BLOCKED: une matière scientifique exige 3 hôtes distincts réellement vérifiés.';
    end if;

    if jsonb_typeof(wf->'selected_chapters') = 'array'
       and jsonb_array_length(wf->'selected_chapters') > 0 then
      raise exception 'SECTION_A_BLOCKED: selected_chapters ne peut pas être rempli pendant A.';
    end if;

    new.metadata := jsonb_set(
      coalesce(new.metadata,'{}'::jsonb),
      '{workflow,stage}',
      to_jsonb('chapitres_proposes'::text),
      true
    );
  end if;

  wf := coalesce(new.metadata->'workflow','{}'::jsonb);
  verification := coalesce(wf->'research_verification','{}'::jsonb);
  cr := coalesce(wf->'chapter_research','{}'::jsonb);
  opts := coalesce(wf->'chapter_options','[]'::jsonb);
  findings_len := length(btrim(coalesce(cr->>'findings','')));
  methodology_len := length(btrim(coalesce(cr->>'methodology',cr->>'method','')));
  distinct_hosts := coalesce((verification->>'distinct_hosts')::integer,0);

  if coalesce(wf->>'stage','')='chapitres_proposes'
     and coalesce((wf->>'chatgpt_claimed')::boolean,false) then

    source_count := case
      when jsonb_typeof(cr->'source_urls')='array' then jsonb_array_length(cr->'source_urls')
      when jsonb_typeof(cr->'sources')='array' then jsonb_array_length(cr->'sources')
      else 0
    end;
    option_count := case
      when jsonb_typeof(opts)='array' then jsonb_array_length(opts)
      else 0
    end;

    if lower(coalesce(verification->>'status','')) <> 'verified'
       or coalesce(verification->>'version','') <> 'a-b-research-contract-v2'
       or lower(coalesce(cr->>'status','')) <> 'researched'
       or findings_len < 40
       or methodology_len < 10
       or source_count < 1
       or option_count < 1 then
      raise exception 'SECTION_B_BLOCKED: impossible d’entrer ou de rester en B avec un dossier A→B non certifié.';
    end if;

    if scientific and distinct_hosts < 3 then
      raise exception 'SECTION_B_BLOCKED: une matière scientifique exige 3 hôtes distincts réellement vérifiés.';
    end if;
  end if;

  return new;
end;
$function$;
