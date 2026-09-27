-- Explicit no-visuals contract for chemistry editorial documents.
-- Production equivalent of the change applied to project tdeotqfsbvouresfhkab.
-- Keeps standard word, scientific and structural gates intact while allowing
-- an explicitly declared course_profile.no_visuals=true document to contain
-- no documentary visuals or graph requirement.

create or replace function public.aurora_enforce_course_quality()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
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
  if not is_course then return new; end if;
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
    words := cardinality(regexp_split_to_array(
      regexp_replace(trim(coalesce(new.content_json->>'introduction','')),'[[:space:]]+',' ','g'),
      '[[:space:]]+'));
    for section in select value from jsonb_array_elements(new.content_json->'sections') loop
      for item_text in select value from jsonb_array_elements_text(coalesce(section->'content','[]'::jsonb)) loop
        if trim(item_text)<>'' then
          words := words + cardinality(regexp_split_to_array(
            regexp_replace(trim(item_text),'[[:space:]]+',' ','g'),'[[:space:]]+'));
        end if;
      end loop;
    end loop;
    if words < 1200 then
      raise exception 'COURSE_QUALITY_GATE: cours standard insuffisant (% mots utiles; minimum 1200).', words;
    end if;
    if words > 2000 then
      raise exception 'COURSE_QUALITY_GATE: cours standard trop long (% mots utiles; maximum 2000).', words;
    end if;
  end if;

  if no_visuals then
    for section in select value from jsonb_array_elements(coalesce(new.content_json->'sections','[]'::jsonb)) loop
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
$function$;

create or replace function public.aurora_enforce_documentary_visual_plan()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_subject text := lower(coalesce(new.subject, ''));
  v_document_type text := lower(coalesce(new.document_type, ''));
  v_origin text := lower(coalesce(new.metadata->>'origin', ''));
  v_content jsonb := coalesce(new.content_json, '{}'::jsonb);
  v_plan jsonb;
  v_decisions jsonb;
  v_section jsonb;
  v_decision jsonb;
  v_visual jsonb;
  v_visual_ids jsonb;
  v_idx int;
  v_id text;
  v_choice text;
  v_visual_ids_seen text[] := array[]::text[];
  v_referenced_ids text[] := array[]::text[];
  v_no_visuals boolean := coalesce((v_content #>> '{course_profile,no_visuals}')::boolean,false);
begin
  if v_document_type !~ 'cours'
     or v_document_type ~ 'exercice|devoir|corrig'
     or v_subject ~ 'math'
     or v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if v_no_visuals then
    for v_section in select value from jsonb_array_elements(coalesce(v_content->'sections','[]'::jsonb)) loop
      if jsonb_array_length(coalesce(v_section->'visuals','[]'::jsonb)) > 0 then
        raise exception 'Cours no_visuals=true : aucun visuel documentaire autorisé';
      end if;
    end loop;
    return new;
  end if;

  v_plan := coalesce(v_content->'visual_plan',
    case when jsonb_typeof(v_content->'metadata') = 'object'
         then v_content->'metadata'->'visual_plan' else null end);
  if jsonb_typeof(v_content->'sections') <> 'array' then
    raise exception 'Cours non mathématique : sections doit être un tableau pour le plan documentaire';
  end if;
  if jsonb_typeof(v_plan) <> 'object' then
    raise exception 'Cours non mathématique : visual_plan documentaire obligatoire';
  end if;
  if coalesce(v_plan->>'schema_version', '') <> 'documentary-visual-plan-1' then
    raise exception 'Cours non mathématique : visual_plan.schema_version doit être documentary-visual-plan-1';
  end if;
  if jsonb_typeof(v_plan->'decisions') <> 'array'
     or jsonb_array_length(v_plan->'decisions') <> jsonb_array_length(v_content->'sections') then
    raise exception 'Cours non mathématique : une décision documentaire est requise pour chaque section';
  end if;
  v_decisions := v_plan->'decisions';

  for v_idx in 0..jsonb_array_length(v_content->'sections')-1 loop
    v_section := v_content->'sections'->v_idx;
    v_decision := null;
    for v_decision in select value from jsonb_array_elements(v_decisions) loop
      if coalesce(v_decision->>'section_number','') ~ '^[0-9]+$'
         and (v_decision->>'section_number')::int = v_idx + 1 then
        exit;
      end if;
      v_decision := null;
    end loop;
    if v_decision is null then
      raise exception 'Cours non mathématique : décision documentaire manquante pour la section %', v_idx + 1;
    end if;
    v_choice := lower(trim(coalesce(v_decision->>'decision','')));
    if v_choice not in ('build','not_needed') then
      raise exception 'Section % : decision documentaire doit être build ou not_needed', v_idx + 1;
    end if;
    if jsonb_typeof(v_section->'visuals') is null then
      v_section := jsonb_set(v_section, '{visuals}', '[]'::jsonb);
    end if;
    if jsonb_typeof(v_section->'visuals') <> 'array' then
      raise exception 'Section % : visuals doit être un tableau', v_idx + 1;
    end if;
    if v_choice = 'not_needed' then
      if jsonb_array_length(v_section->'visuals') > 0 then
        raise exception 'Section % : not_needed ne peut pas contenir de visuel', v_idx + 1;
      end if;
      if length(trim(coalesce(v_decision->>'rationale',''))) < 8 then
        raise exception 'Section % : rationale obligatoire pour not_needed', v_idx + 1;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

create or replace function public.aurora_scientific_preflight(p_subject text, p_document_type text, p_content_json jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v_subject text := lower(coalesce(p_subject,''));
  v_type text := lower(coalesce(p_document_type,''));
  v_raw text := coalesce(p_content_json::text,'');
  v_math boolean := v_subject ~ 'math';
  v_pc boolean := v_subject ~ 'physique|chimie|sciences[[:space:]-]*physiques|(^|[[:space:]])pc([[:space:]]|$)';
  v_general_quant boolean := v_subject ~ 'biolog|svt|géograph|geograph|économ|econom|gestion|comptabil|informat|statist|technolog|scien|agronom|finance';
  v_quant boolean := false;
  v_course boolean := v_type ~ 'cours|course|fiche de cours|document pedagogique|resume';
  v_exercises boolean := v_type ~ 'exercice|devoir|corrig';
  v_latex_blocks int := 0;
  v_latex_commands int := 0;
  v_scientific_relations int := 0;
  v_units int := 0;
  v_unicode_math int := 0;
  v_build_graphs int := 0;
  v_equals int := 0;
  v_graphable boolean := false;
  v_no_visuals boolean := coalesce((p_content_json #>> '{course_profile,no_visuals}')::boolean,false);
  v_failures text[] := array[]::text[];
  v_modules text[] := array[]::text[];
  v_slash text := chr(92);
begin
  if p_content_json is null or jsonb_typeof(p_content_json) <> 'object' then
    return jsonb_build_object('status','blocked','contract_version','scientific-preflight-1','failures',jsonb_build_array('content_json doit être un objet JSON.'));
  end if;
  v_quant := v_math or v_pc or v_general_quant;
  if v_math then
    v_modules := array['latex','symbolic_math','numerical_verification','graphing_when_relevant'];
  elsif v_pc then
    v_modules := array['latex','numerical_verification','units','dimensional_analysis','chemical_equations','graphing_when_relevant'];
  elsif v_general_quant then
    v_modules := array['latex','numerical_verification','data_consistency','graphing_when_relevant'];
  end if;
  v_latex_blocks :=
      least((length(v_raw)-length(replace(v_raw,v_slash||'(', '_')))/2,(length(v_raw)-length(replace(v_raw,v_slash||')', '_')))/2)
    + least((length(v_raw)-length(replace(v_raw,v_slash||'[', '_')))/2,(length(v_raw)-length(replace(v_raw,v_slash||']', '_')))/2)
    + (length(v_raw)-length(replace(v_raw,'$','')))/2;
  select count(*) into v_latex_commands from regexp_matches(v_raw,v_slash||'[A-Za-z]{2,}','g');
  v_equals := length(v_raw)-length(replace(v_raw,'=',''));
  v_scientific_relations := v_equals + v_latex_commands;
  select count(*) into v_units from regexp_matches(v_raw,'[0-9]+(?:[.,][0-9]+)?[[:space:]]*(mol(?:/L)?|g|kg|mg|µg|L|mL|Pa|kPa|MPa|J|kJ|W|V|A|K|N|Hz|m/s|cm|mm|km|s|min|h|°C|Ω|C)','gi');
  select count(*) into v_unicode_math from regexp_matches(v_raw,'[≈≃≤≥→⇌↔⇒⇔∈∉⊂⊆∪∩∞∑√]','g');
  select count(*) into v_build_graphs from regexp_matches(v_raw,'\\\"decision\\\"[[:space:]]*:[[:space:]]*\\\"build\\\"','g');

  if v_math and v_course and v_latex_blocks < 6 then
    v_failures := array_append(v_failures,format('MATH-LATEX-001 : cours de mathématiques : 6 blocs LaTeX minimum, %s détectés.',v_latex_blocks));
  end if;
  if v_math and v_exercises and v_latex_blocks < 6 then
    v_failures := array_append(v_failures,format('MATH-LATEX-002 : série mathématique : 6 blocs LaTeX minimum, %s détectés.',v_latex_blocks));
  end if;
  if v_math and v_course and v_scientific_relations < 6 then
    v_failures := array_append(v_failures,format('MATH-REL-001 : un cours de mathématiques doit contenir au moins 6 relations/formules exploitables ; %s détectées.',v_scientific_relations));
  end if;
  if v_math and v_course and v_unicode_math >= 3 and v_latex_blocks = 0 then
    v_failures := array_append(v_failures,'MATH-LATEX-003 : notation Unicode mathématique détectée sans LaTeX exploitable.');
  end if;
  if v_math and v_course and v_graphable and v_build_graphs < 1 and not v_no_visuals then
    v_failures := array_append(v_failures,'MATH-VISUAL-001 : notion mathématique graphable détectée sans construction graphique planifiée.');
  end if;

  if v_pc and v_latex_blocks < 4 then
    v_failures := array_append(v_failures,format('SCI-LATEX-001 : Physique-Chimie : 4 blocs LaTeX minimum, %s détectés.',v_latex_blocks));
  end if;
  if v_pc and v_scientific_relations < 8 then
    v_failures := array_append(v_failures,format('SCI-REL-001 : Physique-Chimie : 8 relations scientifiques minimum, %s détectées.',v_scientific_relations));
  end if;
  if v_pc and v_course and v_graphable and v_build_graphs < 1 and not v_no_visuals then
    v_failures := array_append(v_failures,'SCI-VISUAL-001 : Physique-Chimie graphable sans construction graphique planifiée.');
  end if;

  if v_general_quant and (v_units >= 1 or v_scientific_relations >= 2 or v_unicode_math >= 2) and v_latex_blocks < 2 then
    v_failures := array_append(v_failures,'QUANT-LATEX-001 : traitement quantitatif détecté sans représentation LaTeX suffisante.');
  end if;
  if v_quant and v_latex_commands = 0 and v_unicode_math >= 3 and v_latex_blocks = 0 then
    v_failures := array_append(v_failures,'SCIENTIFIC-PLAIN-TEXT-001 : contenu scientifique livré en texte/Unicode sans couche LaTeX.');
  end if;

  return jsonb_build_object(
    'status',case when cardinality(v_failures)=0 then 'pass' else 'blocked' end,
    'contract_version','scientific-preflight-1',
    'subject',p_subject,'document_type',p_document_type,'quantitative_mode',v_quant,
    'activated_modules',to_jsonb(v_modules),
    'metrics',jsonb_build_object('latex_blocks',v_latex_blocks,'latex_commands',v_latex_commands,'scientific_relations',v_scientific_relations,'units',v_units,'unicode_math_symbols',v_unicode_math,'built_graphs',v_build_graphs,'graphable',v_graphable),
    'failures',to_jsonb(v_failures)
  );
end;
$function$;
