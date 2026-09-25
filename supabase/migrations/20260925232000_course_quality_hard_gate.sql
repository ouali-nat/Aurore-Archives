-- Aurore Archives: hard quality gate for standard courses.
-- Applied to production Supabase as course_quality_hard_gate_20260925.

update public.aurora_editorial_memory
set active=false, updated_at=now()
where rule_key='pedagogical_volume' and active=true;

insert into public.aurora_editorial_memory
  (rule_key, version, title, priority, mandatory, active, content)
values
  (
    'pedagogical_volume', 2,
    'Volume pédagogique minimal — cours standard', 90, true, true,
    '{
      "rules": [
        "Tout cours standard doit contenir au moins 3000 mots de contenu réellement utile.",
        "Le comptage porte sur content_json.introduction et les blocs textuels de content_json.sections[].content[].",
        "Le volume ne doit jamais être atteint par répétition, remplissage ou reformulation artificielle.",
        "Une exception n’est admise que si le document porte explicitement le profil course_quality.format_profile=short_course et fournit course_quality.short_format_reason.",
        "Une exception silencieuse ou déduite automatiquement est interdite."
      ],
      "hard_gate": true,
      "exception_profile": "short_course"
    }'::jsonb
  )
on conflict (rule_key, version) do update set
  title=excluded.title, priority=excluded.priority, mandatory=excluded.mandatory,
  active=true, content=excluded.content, updated_at=now();

insert into public.aurora_editorial_memory
  (rule_key, version, title, priority, mandatory, active, content)
values
  (
    'course_quality_contract', 1,
    'Contrat qualité bloquant des cours : introduction, volume et visuels documentaires',
    998, true, true,
    '{
      "scope": "Tous les documents document_type=cours.",
      "hard_gate": true,
      "minimum_useful_words": 3000,
      "word_count_scope": ["content_json.introduction","content_json.sections[].content[]"],
      "introduction": {
        "required": true,
        "minimum_characters": 80,
        "purpose": "Installer le sujet, les objectifs, les repères et la problématique du cours."
      },
      "short_course_exception": {
        "allowed": true,
        "format_profile": "short_course",
        "reason_field": "course_quality.short_format_reason",
        "minimum_reason_characters": 30,
        "silent_exception_forbidden": true
      },
      "documentary_visuals": {
        "required_for_non_math_courses": true,
        "schema_version": "documentary-visual-plan-1",
        "location": "content_json.visual_plan",
        "decision_per_section": "build ou not_needed",
        "build": "visual_ids non vides et visuels Wikimedia réels correspondants.",
        "not_needed": "aucun visuel dans la section et rationale pédagogique explicite.",
        "max_per_section": 3,
        "max_per_document": 8,
        "allowed_purposes": ["illustration","schema","photo","experimental","comparison"],
        "at_least_one_planned_visual": true
      },
      "visual_separation": {
        "no_svg_automatic": "Interdit seulement la génération automatique d’Aurore SVG.",
        "does_not_disable": ["Wikimedia Commons","GeoGebra"],
        "principle": "Ne jamais transformer une consigne no_svg_automatic en consigne no_visual."
      },
      "preflight": [
        "Refuser le document avant insertion si le cours standard est sous 3000 mots.",
        "Refuser le document si l’introduction est absente ou trop courte.",
        "Refuser un cours non mathématique sans visual_plan documentaire complet.",
        "Refuser un plan documentaire sans visuel build.",
        "Refuser toute divergence entre visual_ids et sections[].visuals[].",
        "Effectuer ces contrôles avant la mise en file LuaLaTeX."
      ]
    }'::jsonb
  )
on conflict (rule_key, version) do update set
  title=excluded.title, priority=excluded.priority, mandatory=excluded.mandatory,
  active=true, content=excluded.content, updated_at=now();

insert into public.aurora_editorial_memory
  (rule_key, version, title, priority, mandatory, active, content)
values
  (
    'document_structure', 2,
    'Structure canonique d’un cours — introduction obligatoire',
    950, true, true,
    '{
      "required_top_level": ["title","introduction","sections"],
      "course_requirements": [
        "content_json.introduction est obligatoire pour document_type=cours.",
        "Chaque cours doit présenter une progression pédagogique explicite.",
        "Les blocs textuels sont découpés et lisibles.",
        "Les exercices et corrections restent séparables."
      ],
      "recommended_sequence": [
        "introduction","objectifs","repères ou prérequis","définition ou rappel",
        "propriété ou mécanisme","explication","exemple","application","synthèse"
      ]
    }'::jsonb
  )
on conflict (rule_key, version) do update set
  title=excluded.title, priority=excluded.priority, mandatory=excluded.mandatory,
  active=true, content=excluded.content, updated_at=now();

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

  if trim(coalesce(p_title,'')) = ''
     or trim(v_content->>'title') <> trim(p_title) then
    raise exception 'Cours : content_json.title doit correspondre exactement au champ title';
  end if;

  v_sections := v_content->'sections';
  if jsonb_typeof(v_sections) <> 'array'
     or jsonb_array_length(v_sections) < 1
     or jsonb_array_length(v_sections) > 30 then
    raise exception 'Cours : content_json.sections doit contenir de 1 à 30 sections';
  end if;

  v_intro := trim(coalesce(v_content->>'introduction',''));
  if length(v_intro) < 80 then
    raise exception 'Cours : introduction pédagogique obligatoire (minimum 80 caractères)';
  end if;

  v_words := array_length(regexp_split_to_array(v_intro, '\s+'),1);
  if v_words is null then v_words := 0; end if;

  for v_section in select value from jsonb_array_elements(v_sections) loop
    if jsonb_typeof(v_section) <> 'object'
       or trim(coalesce(v_section->>'title','')) = '' then
      raise exception 'Cours : chaque section doit avoir un titre non vide';
    end if;

    if jsonb_typeof(v_section->'content') = 'array' then
      for v_item in select value from jsonb_array_elements(v_section->'content') loop
        if jsonb_typeof(v_item) = 'string' and trim(v_item #>> '{}') <> '' then
          v_words := v_words
            + coalesce(array_length(regexp_split_to_array(trim(v_item #>> '{}'), '\s+'),1),0);
        end if;
      end loop;
    end if;
  end loop;

  if v_profile = 'short_course' then
    if length(v_reason) < 30 then
      raise exception 'Cours : short_course exige course_quality.short_format_reason (minimum 30 caractères)';
    end if;
  elsif v_words < 3000 then
    raise exception 'Cours standard : minimum 3000 mots utiles requis ; comptage actuel=%', v_words;
  end if;

  if v_subject !~ 'math' then
    if jsonb_typeof(v_content->'visual_plan') <> 'object' then
      raise exception 'Cours non mathématique : content_json.visual_plan documentaire obligatoire';
    end if;

    v_plan := v_content->'visual_plan';
    if coalesce(v_plan->>'schema_version','') <> 'documentary-visual-plan-1' then
      raise exception 'Cours non mathématique : visual_plan.schema_version doit être documentary-visual-plan-1';
    end if;

    v_decisions := v_plan->'decisions';
    if jsonb_typeof(v_decisions) <> 'array'
       or jsonb_array_length(v_decisions) <> jsonb_array_length(v_sections) then
      raise exception 'Cours non mathématique : une décision documentaire est requise pour chaque section';
    end if;
    v_decision_count := jsonb_array_length(v_decisions);

    for v_section in
      select value from jsonb_array_elements(v_sections) with ordinality s(value,ord)
    loop
      v_decision := null;
      for v_decision in select value from jsonb_array_elements(v_decisions) loop
        if coalesce(v_decision->>'section_number','') ~ '^[0-9]+$'
           and (v_decision->>'section_number')::int = s.ord then
          exit;
        end if;
        v_decision := null;
      end loop;

      if v_decision is null then
        raise exception 'Cours non mathématique : décision documentaire manquante pour la section %', s.ord;
      end if;

      v_choice := lower(trim(coalesce(v_decision->>'decision','')));
      v_visuals := case
        when jsonb_typeof(s.value->'visuals')='array' then s.value->'visuals'
        else '[]'::jsonb
      end;

      if v_choice not in ('build','not_needed') then
        raise exception 'Section % : décision documentaire doit être build ou not_needed', s.ord;
      end if;

      if v_choice='not_needed' then
        if jsonb_array_length(v_visuals) > 0 then
          raise exception 'Section % : not_needed ne peut pas contenir de visuel documentaire', s.ord;
        end if;
        if length(trim(coalesce(v_decision->>'rationale',''))) < 8 then
          raise exception 'Section % : rationale obligatoire lorsque l’illustration est écartée', s.ord;
        end if;
        continue;
      end if;

      v_build_sections := v_build_sections + 1;
      v_visual_ids := v_decision->'visual_ids';
      if jsonb_typeof(v_visual_ids) <> 'array'
         or jsonb_array_length(v_visual_ids) < 1 then
        raise exception 'Section % : build exige au moins un visual_id', s.ord;
      end if;

      if jsonb_array_length(v_visual_ids) <> jsonb_array_length(v_visuals) then
        raise exception 'Section % : visual_ids doit couvrir exactement les visuels de la section', s.ord;
      end if;

      if jsonb_array_length(v_visuals) > 3 then
        raise exception 'Section % : maximum 3 visuels documentaires', s.ord;
      end if;

      for v_visual in select value from jsonb_array_elements(v_visuals) loop
        if jsonb_typeof(v_visual) <> 'object' then
          raise exception 'Section % : visuel documentaire invalide', s.ord;
        end if;
        v_id := trim(coalesce(v_visual->>'id',''));
        if v_id='' then
          raise exception 'Section % : chaque visuel documentaire doit avoir un id stable', s.ord;
        end if;
        if v_id = any(v_seen_ids) then
          raise exception 'visual_id dupliqué : %', v_id;
        end if;
        v_seen_ids := array_append(v_seen_ids,v_id);
        v_total_visuals := v_total_visuals + 1;

        if lower(trim(coalesce(v_visual->>'type','wikimedia'))) <> 'wikimedia' then
          raise exception 'Visuel % : type doit être wikimedia', v_id;
        end if;
        if length(trim(coalesce(v_visual->>'query',''))) < 4 then
          raise exception 'Visuel % : query obligatoire', v_id;
        end if;
        if length(trim(coalesce(v_visual->>'title',''))) < 2 then
          raise exception 'Visuel % : title obligatoire', v_id;
        end if;
        if length(trim(coalesce(v_visual->>'caption',''))) < 4 then
          raise exception 'Visuel % : caption pédagogique obligatoire', v_id;
        end if;
        v_purpose := lower(trim(coalesce(v_visual->>'purpose','')));
        if v_purpose not in ('illustration','schema','photo','experimental','comparison') then
          raise exception 'Visuel % : purpose invalide', v_id;
        end if;
        if not coalesce(v_visual->>'required','false')::boolean then
          raise exception 'Visuel % : required=true est obligatoire', v_id;
        end if;
      end loop;

      for v_id in select jsonb_array_elements_text(v_visual_ids) loop
        if v_id = any(v_planned_ids) then
          raise exception 'visual_id référencé plusieurs fois : %', v_id;
        end if;
        if not exists (
          select 1 from jsonb_array_elements(v_visuals) vv
          where trim(coalesce(vv->>'id','')) = trim(v_id)
        ) then
          raise exception 'Section % : visual_id % introuvable dans sections[].visuals[]', s.ord, v_id;
        end if;
        v_planned_ids := array_append(v_planned_ids,v_id);
      end loop;
    end loop;

    for v_section in select value from jsonb_array_elements(v_sections) loop
      if jsonb_typeof(v_section->'visuals')='array' then
        for v_visual in select value from jsonb_array_elements(v_section->'visuals') loop
          v_id := trim(coalesce(v_visual->>'id',''));
          if v_id='' or not (v_id = any(v_planned_ids)) then
            raise exception 'Visuel % présent dans le document mais absent du visual_plan', coalesce(v_id,'(vide)');
          end if;
        end loop;
      end if;
    end loop;

    if v_total_visuals > 8 then
      raise exception 'Cours non mathématique : maximum 8 visuels documentaires';
    end if;

    if v_build_sections < 1 or v_total_visuals < 1 then
      raise exception 'Cours non mathématique : au moins un visuel documentaire build est requis';
    end if;
  end if;

  return jsonb_build_object(
    'required',true,'passed',true,'word_count',v_words,
    'minimum_word_count',3000,'introduction_present',true,
    'short_course',v_profile='short_course',
    'documentary_plan_required',v_subject !~ 'math',
    'documentary_visuals',v_total_visuals,
    'documentary_build_sections',v_build_sections,
    'documentary_decisions',v_decision_count
  );
end;
$function$;

create or replace function public.aurora_enforce_course_quality()
returns trigger
language plpgsql
security invoker
set search_path=public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  v_result := public.aurora_validate_course_quality(
    NEW.content_json,
    NEW.title,
    coalesce(NEW.subject, NEW.matiere, ''),
    NEW.document_type,
    coalesce(NEW.metadata,'{}'::jsonb)
  );

  if coalesce((v_result->>'required')::boolean,false) then
    NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb)
      || jsonb_build_object('course_quality_gate',v_result);
  end if;

  return NEW;
end;
$function$;

drop trigger if exists aurora_generated_documents_course_quality
on public.aurora_generated_documents;

create trigger aurora_generated_documents_course_quality
before insert or update of title, subject, document_type, content_json
on public.aurora_generated_documents
for each row execute function public.aurora_enforce_course_quality();

revoke all on function public.aurora_validate_course_quality(jsonb,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.aurora_enforce_course_quality() from public, anon, authenticated;
grant execute on function public.aurora_validate_course_quality(jsonb,text,text,text,jsonb) to service_role;
grant execute on function public.aurora_enforce_course_quality() to service_role;

select setval('public.aurora_editorial_memory_id_seq', (select coalesce(max(id),1) from public.aurora_editorial_memory));
