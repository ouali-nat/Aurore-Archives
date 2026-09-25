-- Aurore Archives: fix the section ordinal loop in the hard course-quality validator.
-- Applied to production Supabase as course_quality_gate_ordinality_fix_20260925.

create or replace function public.aurora_validate_course_quality(
  p_content jsonb,
  p_title text,
  p_subject text,
  p_document_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=public, pg_temp
as $function$
declare
  v_type text := lower(trim(coalesce(p_document_type,'')));
  v_subject text := lower(trim(coalesce(p_subject,'')));
  v_content jsonb := coalesce(p_content,'{}'::jsonb);
  v_sections jsonb;
  v_intro text;
  v_qc jsonb := coalesce(p_metadata->'course_quality','{}'::jsonb);
  v_profile text := lower(trim(coalesce(v_qc->>'format_profile','')));
  v_reason text := trim(coalesce(v_qc->>'short_format_reason',''));
  v_words integer := 0;
  v_section jsonb;
  v_item jsonb;
  v_plan jsonb;
  v_decisions jsonb;
  v_decision jsonb;
  v_visuals jsonb;
  v_visual jsonb;
  v_visual_ids jsonb;
  v_id text;
  v_choice text;
  v_purpose text;
  v_ord integer;
  v_seen_ids text[] := array[]::text[];
  v_planned_ids text[] := array[]::text[];
  v_total_visuals integer := 0;
  v_build_sections integer := 0;
  v_decision_count integer := 0;
begin
  if v_type !~ 'cours' or v_type ~ 'exercice|devoir|corrig' then
    return jsonb_build_object('required',false);
  end if;
  if jsonb_typeof(v_content) <> 'object' then
    raise exception 'Cours : content_json doit être un objet JSON';
  end if;
  if trim(coalesce(v_content->>'title','')) = '' then
    raise exception 'Cours : content_json.title est obligatoire';
  end if;
  if trim(coalesce(p_title,'')) = '' or trim(v_content->>'title') <> trim(p_title) then
    raise exception 'Cours : content_json.title doit correspondre exactement au champ title';
  end if;
  v_sections := v_content->'sections';
  if jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections) < 1 or jsonb_array_length(v_sections) > 30 then
    raise exception 'Cours : content_json.sections doit contenir de 1 à 30 sections';
  end if;
  v_intro := trim(coalesce(v_content->>'introduction',''));
  if length(v_intro) < 80 then
    raise exception 'Cours : introduction pédagogique obligatoire (minimum 80 caractères)';
  end if;
  v_words := coalesce(array_length(regexp_split_to_array(v_intro, '\s+'),1),0);
  for v_section in select value from jsonb_array_elements(v_sections) loop
    if jsonb_typeof(v_section) <> 'object' or trim(coalesce(v_section->>'title','')) = '' then
      raise exception 'Cours : chaque section doit avoir un titre non vide';
    end if;
    if jsonb_typeof(v_section->'content') = 'array' then
      for v_item in select value from jsonb_array_elements(v_section->'content') loop
        if jsonb_typeof(v_item) = 'string' and trim(v_item #>> '{}') <> '' then
          v_words := v_words + coalesce(array_length(regexp_split_to_array(trim(v_item #>> '{}'), '\s+'),1),0);
        end if;
      end loop;
    end if;
  end loop;
  if v_profile='short_course' then
    if length(v_reason) < 30 then
      raise exception 'Cours : short_course exige course_quality.short_format_reason (minimum 30 caractères)';
    end if;
  elsif v_words < 3000 then
    raise exception 'Cours standard : minimum 3000 mots utiles requis ; comptage actuel=%',v_words;
  end if;
  if v_subject !~ 'math' then
    if jsonb_typeof(v_content->'visual_plan') <> 'object' then
      raise exception 'Cours non mathématique : content_json.visual_plan documentaire obligatoire';
    end if;
    v_plan:=v_content->'visual_plan';
    if coalesce(v_plan->>'schema_version','')<>'documentary-visual-plan-1' then
      raise exception 'Cours non mathématique : visual_plan.schema_version doit être documentary-visual-plan-1';
    end if;
    v_decisions:=v_plan->'decisions';
    if jsonb_typeof(v_decisions)<>'array' or jsonb_array_length(v_decisions)<>jsonb_array_length(v_sections) then
      raise exception 'Cours non mathématique : une décision documentaire est requise pour chaque section';
    end if;
    v_decision_count:=jsonb_array_length(v_decisions);
    for v_section, v_ord in
      select value, ordinality::integer from jsonb_array_elements(v_sections) with ordinality
    loop
      v_decision:=null;
      for v_decision in select value from jsonb_array_elements(v_decisions) loop
        if coalesce(v_decision->>'section_number','')~'^[0-9]+$' and (v_decision->>'section_number')::int=v_ord then exit; end if;
        v_decision:=null;
      end loop;
      if v_decision is null then raise exception 'Cours non mathématique : décision documentaire manquante pour la section %',v_ord; end if;
      v_choice:=lower(trim(coalesce(v_decision->>'decision','')));
      v_visuals:=case when jsonb_typeof(v_section->'visuals')='array' then v_section->'visuals' else '[]'::jsonb end;
      if v_choice not in ('build','not_needed') then raise exception 'Section % : décision documentaire doit être build ou not_needed',v_ord; end if;
      if v_choice='not_needed' then
        if jsonb_array_length(v_visuals)>0 then raise exception 'Section % : not_needed ne peut pas contenir de visuel documentaire',v_ord; end if;
        if length(trim(coalesce(v_decision->>'rationale','')))<8 then raise exception 'Section % : rationale obligatoire lorsque l’illustration est écartée',v_ord; end if;
        continue;
      end if;
      v_build_sections:=v_build_sections+1;
      v_visual_ids:=v_decision->'visual_ids';
      if jsonb_typeof(v_visual_ids)<>'array' or jsonb_array_length(v_visual_ids)<1 then raise exception 'Section % : build exige au moins un visual_id',v_ord; end if;
      if jsonb_array_length(v_visual_ids)<>jsonb_array_length(v_visuals) then raise exception 'Section % : visual_ids doit couvrir exactement les visuels de la section',v_ord; end if;
      if jsonb_array_length(v_visuals)>3 then raise exception 'Section % : maximum 3 visuels documentaires',v_ord; end if;
      for v_visual in select value from jsonb_array_elements(v_visuals) loop
        if jsonb_typeof(v_visual)<>'object' then raise exception 'Section % : visuel documentaire invalide',v_ord; end if;
        v_id:=trim(coalesce(v_visual->>'id',''));
        if v_id='' then raise exception 'Section % : chaque visuel documentaire doit avoir un id stable',v_ord; end if;
        if v_id=any(v_seen_ids) then raise exception 'visual_id dupliqué : %',v_id; end if;
        v_seen_ids:=array_append(v_seen_ids,v_id);
        v_total_visuals:=v_total_visuals+1;
        if lower(trim(coalesce(v_visual->>'type','wikimedia'))) <>'wikimedia' then raise exception 'Visuel % : type doit être wikimedia',v_id; end if;
        if length(trim(coalesce(v_visual->>'query','')))<4 then raise exception 'Visuel % : query obligatoire',v_id; end if;
        if length(trim(coalesce(v_visual->>'title','')))<2 then raise exception 'Visuel % : title obligatoire',v_id; end if;
        if length(trim(coalesce(v_visual->>'caption','')))<4 then raise exception 'Visuel % : caption pédagogique obligatoire',v_id; end if;
        v_purpose:=lower(trim(coalesce(v_visual->>'purpose','')));
        if v_purpose not in ('illustration','schema','photo','experimental','comparison') then raise exception 'Visuel % : purpose invalide',v_id; end if;
        if not coalesce(v_visual->>'required','false')::boolean then raise exception 'Visuel % : required=true est obligatoire',v_id; end if;
      end loop;
      for v_id in select jsonb_array_elements_text(v_visual_ids) loop
        if v_id=any(v_planned_ids) then raise exception 'visual_id référencé plusieurs fois : %',v_id; end if;
        if not exists(select 1 from jsonb_array_elements(v_visuals) vv where trim(coalesce(vv->>'id',''))=trim(v_id)) then
          raise exception 'Section % : visual_id % introuvable dans sections[].visuals[]',v_ord,v_id;
        end if;
        v_planned_ids:=array_append(v_planned_ids,v_id);
      end loop;
    end loop;
    for v_section in select value from jsonb_array_elements(v_sections) loop
      if jsonb_typeof(v_section->'visuals')='array' then
        for v_visual in select value from jsonb_array_elements(v_section->'visuals') loop
          v_id:=trim(coalesce(v_visual->>'id',''));
          if v_id='' or not (v_id=any(v_planned_ids)) then raise exception 'Visuel % présent dans le document mais absent du visual_plan',coalesce(v_id,'(vide)'); end if;
        end loop;
      end if;
    end loop;
    if v_total_visuals>8 then raise exception 'Cours non mathématique : maximum 8 visuels documentaires'; end if;
    if v_build_sections<1 or v_total_visuals<1 then raise exception 'Cours non mathématique : au moins un visuel documentaire build est requis'; end if;
  end if;
  return jsonb_build_object('required',true,'passed',true,'word_count',v_words,'minimum_word_count',3000,'introduction_present',true,'short_course',v_profile='short_course','documentary_plan_required',v_subject !~ 'math','documentary_visuals',v_total_visuals,'documentary_build_sections',v_build_sections,'documentary_decisions',v_decision_count);
end;
$function$;
