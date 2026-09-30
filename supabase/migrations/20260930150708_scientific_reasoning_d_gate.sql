-- Aurore Archives — hard gate D : qualité pédagogique du raisonnement scientifique.
-- Cette barrière intervient au dernier passage D -> Documents en attente.
-- Elle contrôle le contenu réellement produit, indépendamment de la complétude du plan C/CX.
--
-- Scope :
--   mathématiques, physique, chimie, sciences physiques/PC, biologie/SVT,
--   statistiques et autres documents scientifiques quantitatifs.
-- Les exercices/corrigés peuvent rester naturellement denses en formules ;
-- les parties explicatives/instructionnelles d'un cours ne le peuvent pas.

insert into public.aurora_editorial_memory
  (rule_key, version, title, priority, mandatory, active, content)
values
(
  'scientific_reasoning_quality_gate',
  1,
  'Garde-fou D — raisonnement scientifique explicite',
  2040,
  true,
  true,
  jsonb_build_object(
    'schema_version','scientific-reasoning-d-gate-1',
    'hard_gate',true,
    'boundary','D -> documents_en_attente -> avant ingestion',
    'principle','Une succession de formules, équations, résultats ou valeurs ne constitue pas à elle seule une explication scientifique.',
    'required_logic',jsonb_build_array(
      'définir les grandeurs, variables, espèces ou notions introduites',
      'nommer la loi, relation, propriété, définition ou méthode utilisée',
      'expliquer les transformations et substitutions importantes',
      'rendre explicite le lien entre une étape et la suivante',
      'interpréter le résultat obtenu'
    ),
    'course_structure','Concept/definiton -> explication -> méthode/raisonnement -> exemple/application -> interprétation ; les exercices et corrigés peuvent suivre leur logique propre.',
    'formula_only_sections','Toute section instructionnelle contenant plusieurs relations scientifiques mais pratiquement aucune prose explicative est bloquante.',
    'coverage','Pour un cours scientifique comportant au moins 3 sections scientifiques porteuses de relations, au moins 60% de ces sections doivent contenir une prose explicative et un marqueur de raisonnement/définition ; aucune section instructionnelle formula-only n’est tolérée.',
    'failure_behavior','Rester en D, enregistrer le rapport de contrôle, refuser l’insertion dans Documents en attente et demander une correction éditoriale explicite.'
  )
)
on conflict (rule_key,version) do update
set title=excluded.title,
    priority=excluded.priority,
    mandatory=excluded.mandatory,
    active=true,
    content=excluded.content,
    updated_at=now();

create or replace function public.aurora_validate_scientific_reasoning_quality(
  p_subject text,
  p_document_type text,
  p_level text,
  p_class_name text,
  p_content_json jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path='public','pg_temp'
as $function$
declare
  v_subject text := lower(trim(coalesce(p_subject,'')));
  v_type text := lower(trim(coalesce(p_document_type,'')));
  v_level text := lower(trim(coalesce(p_level,'')));
  v_class text := lower(trim(coalesce(p_class_name,'')));
  v_scientific boolean;
  v_maternelle boolean := v_level ~ 'maternelle' or v_class ~ 'maternelle';
  v_course boolean := v_type ~ 'cours|course|fiche de cours|document pedagogique|résumé|resume';
  v_practice boolean;
  v_content jsonb := coalesce(p_content_json,'{}'::jsonb);
  v_sections jsonb;
  v_section jsonb;
  v_text text;
  v_prose text;
  v_prose_words int;
  v_relations int;
  v_latex_blocks int;
  v_explanation_markers int;
  v_math_sections int := 0;
  v_explained_sections int := 0;
  v_formula_only_sections int := 0;
  v_max_formula_only_run int := 0;
  v_formula_only_run int := 0;
  v_reasoning_markers int := 0;
  v_total_prose_words int := 0;
  v_total_relations int := 0;
  v_failures text[] := array[]::text[];
  v_min_explained_ratio numeric := 0.60;
  v_ratio numeric := 1.0;
  v_index int := 0;
begin
  v_scientific :=
    v_subject ~ '(^|[^a-z])(maths|mathématiques|mathematiques|mathematique|physique|chimie|sciences[[:space:]-]*physiques|pc|biologie|biologic|svt|statistique|statistics|science|sciences|agronomie|agronom)([^a-z]|$)'
    or v_subject ~ 'physique[[:space:]-]*chimie';

  if not v_scientific or v_maternelle then
    return jsonb_build_object(
      'status','pass',
      'required',false,
      'contract_version','scientific-reasoning-d-gate-1',
      'scope',case when v_maternelle then 'maternelle-exempt' else 'non-scientific' end,
      'metrics',jsonb_build_object(
        'scientific_sections',0,
        'math_bearing_sections',0,
        'explained_math_sections',0,
        'formula_only_sections',0,
        'reasoning_marker_count',0,
        'prose_words',0,
        'relations',0
      ),
      'failures','[]'::jsonb
    );
  end if;

  if jsonb_typeof(v_content->'sections') <> 'array' then
    return jsonb_build_object(
      'status','blocked',
      'required',true,
      'contract_version','scientific-reasoning-d-gate-1',
      'scope','scientific',
      'failures',jsonb_build_array('SCI-REASONING-000 : content_json.sections doit être un tableau de sections exploitables.')
    );
  end if;

  for v_section in
    select value from jsonb_array_elements(v_content->'sections')
  loop
    v_index := v_index + 1;

    v_text := trim(coalesce(v_section->>'title',''));
    if jsonb_typeof(v_section->'content') = 'array' then
      select string_agg(coalesce(x.value#>>'{}',''),' ')
        into v_text
      from jsonb_array_elements(v_section->'content') x;
      v_text := trim(coalesce(v_section->>'title','') || ' ' || coalesce(v_text,''));
    elsif jsonb_typeof(v_section->'content') = 'string' then
      v_text := trim(coalesce(v_section->>'title','') || ' ' || coalesce(v_section->>'content',''));
    end if;

    if coalesce(v_text,'') = '' then
      v_formula_only_run := 0;
      continue;
    end if;

    v_practice :=
      lower(coalesce(v_section->>'title','')) ~ 'exercice|corrig|correction|devoir|qcm|quiz|entrainement|entraînement|série d.?exercices|série d.?exercice';

    v_latex_blocks :=
      coalesce((select count(*) from regexp_matches(v_text,E'(\\\\\\\\\\(|\\\\\\\\\\[|\\$\\$?)','g')),0);

    v_relations :=
      coalesce((select count(*) from regexp_matches(
        v_text,
        E'(=|⇔|⟺|⇒|⟹|→|↔|≤|≥|∈|∉|\\\\\\\\Rightarrow|\\\\\\\\Longrightarrow|\\\\\\\\implies|\\\\\\\\Leftrightarrow|\\\\\\\\iff|\\\\\\\\to)',
        'g'
      )),0);

    v_explanation_markers :=
      coalesce((select count(*) from regexp_matches(
        v_text,
        '(?i)(donc|ainsi|par conséquent|par consequent|on en déduit|on en deduit|ce qui implique|ce qui signifie|autrement dit|en effet|puisque|car|on applique|on utilise|on remplace|on substitue|on pose|on obtient|on vérifie|on verifie|on détermine|on determine|on cherche|la relation|la loi|le théorème|le theoreme|la définition|la definition|est défini|est definie|se définit|se definit|désigne|designe|représente|represente|correspond|mesure|interprétation|interpretation|justification|montrons|démontrons|demontrons|supposons|il suffit|cela revient|si et seulement si|réciproquement|reciproquement|ce résultat|ce resultat)',
        'g'
      )),0);

    v_prose := v_text;
    v_prose := regexp_replace(v_prose,E'\\\\\\\\[A-Za-z]+\\*?(\\{[^{}]*\\})?', ' ', 'g');
    v_prose := regexp_replace(v_prose,E'[\\$=⇔⟺⇒⟹→↔≤≥∈∉_\\^{}()[\\]<>+*/:;,%|]', ' ', 'g');
    select count(*) into v_prose_words
    from regexp_matches(v_prose,'[[:alpha:]À-ÿ]{2,}','g');

    v_total_prose_words := v_total_prose_words + coalesce(v_prose_words,0);
    v_total_relations := v_total_relations + v_relations;
    v_reasoning_markers := v_reasoning_markers + v_explanation_markers;

    if not v_practice and (v_relations >= 2 or v_latex_blocks >= 1) then
      v_math_sections := v_math_sections + 1;

      if v_prose_words >= 18 and v_explanation_markers >= 1 then
        v_explained_sections := v_explained_sections + 1;
        v_formula_only_run := 0;
      else
        v_formula_only_sections := v_formula_only_sections + 1;
        v_formula_only_run := v_formula_only_run + 1;
        if v_formula_only_run > v_max_formula_only_run then
          v_max_formula_only_run := v_formula_only_run;
        end if;

        if v_course then
          v_failures := array_append(
            v_failures,
            format(
              'SCI-REASONING-FORMULA-ONLY : section %s « %s » contient %s relation(s), %s mot(s) de prose et %s marqueur(s) explicatif(s). Ajouter le raisonnement et les explications avant/après les formules.',
              v_index,
              coalesce(nullif(v_section->>'title',''),'sans titre'),
              v_relations,
              coalesce(v_prose_words,0),
              v_explanation_markers
            )
          );
        end if;
      end if;
    else
      v_formula_only_run := 0;
    end if;
  end loop;

  if v_math_sections > 0 then
    v_ratio := v_explained_sections::numeric / v_math_sections::numeric;
  end if;

  if v_course then
    if v_math_sections = 0 then
      v_failures := array_append(
        v_failures,
        'SCI-REASONING-COURSE-001 : aucun bloc scientifique explicatif exploitable n’a été identifié dans ce cours.'
      );
    elsif v_formula_only_sections > 0 then
      -- Les détails par section sont déjà ajoutés ci-dessus.
      null;
    elsif v_math_sections <= 2 and v_explained_sections < v_math_sections then
      v_failures := array_append(
        v_failures,
        format(
          'SCI-REASONING-COVERAGE-001 : %s/%s section(s) scientifique(s) expliquée(s) ; toutes les sections porteuses de relations doivent être expliquées lorsque le cours en comporte 1 à 2.',
          v_explained_sections,v_math_sections
        )
      );
    elsif v_math_sections >= 3 and v_ratio < v_min_explained_ratio then
      v_failures := array_append(
        v_failures,
        format(
          'SCI-REASONING-COVERAGE-002 : couverture explicative %.0f%% ; minimum 60%% des sections scientifiques porteuses de relations requis (%s/%s).',
          v_ratio*100,v_explained_sections,v_math_sections
        )
      );
    end if;

    if v_total_relations >= 6 and v_reasoning_markers < 3 then
      v_failures := array_append(
        v_failures,
        format(
          'SCI-REASONING-LINK-001 : %s relations/formules scientifiques détectées mais seulement %s marqueur(s) de définition/raisonnement. Détailler les transitions, justifications et interprétations.',
          v_total_relations,v_reasoning_markers
        )
      );
    end if;
  elsif v_total_relations >= 4 and v_formula_only_sections > 0 then
    v_failures := array_append(
      v_failures,
      format(
        'SCI-REASONING-DOC-001 : document scientifique non pédagogique : %s section(s) instructionnelle(s) formula-only. Ajouter une justification ou une interprétation.',
        v_formula_only_sections
      )
    );
  elsif v_total_relations >= 4 and v_reasoning_markers = 0 then
    v_failures := array_append(
      v_failures,
      'SCI-REASONING-DOC-002 : relations scientifiques détectées sans aucune explication ou justification textuelle.'
    );
  end if;

  return jsonb_build_object(
    'status',case when cardinality(v_failures)=0 then 'pass' else 'blocked' end,
    'required',true,
    'contract_version','scientific-reasoning-d-gate-1',
    'scope',case when v_course then 'scientific-course' else 'scientific-document' end,
    'subject',p_subject,
    'level',p_level,
    'class_name',p_class_name,
    'metrics',jsonb_build_object(
      'scientific_sections',v_math_sections,
      'math_bearing_sections',v_math_sections,
      'explained_math_sections',v_explained_sections,
      'formula_only_sections',v_formula_only_sections,
      'max_formula_only_run',v_max_formula_only_run,
      'explanation_coverage',round(v_ratio,4),
      'reasoning_marker_count',v_reasoning_markers,
      'prose_words',v_total_prose_words,
      'relations',v_total_relations
    ),
    'policy',jsonb_build_object(
      'min_prose_words_per_explained_section',18,
      'min_explanation_markers_per_explained_section',1,
      'course_min_explained_ratio',v_min_explained_ratio,
      'practice_titles_exempt',true,
      'formula_only_instructional_sections_blocking',true
    ),
    'failures',to_jsonb(v_failures)
  );
end;
$function$;

revoke all on function public.aurora_validate_scientific_reasoning_quality(text,text,text,text,jsonb)
  from public, anon;
grant execute on function public.aurora_validate_scientific_reasoning_quality(text,text,text,text,jsonb)
  to authenticated, service_role;

create or replace function public.aurora_enforce_scientific_reasoning_d_gate()
returns trigger
language plpgsql
security invoker
set search_path='public','pg_temp'
as $function$
declare
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_report jsonb;
begin
  -- La barrière D est appliquée au contenu éditorial final. Les mises à jour
  -- purement techniques (PDF, progression, diagnostic) ne repassent pas ici.
  if v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.content_json is not distinct from old.content_json
     and new.subject is not distinct from old.subject
     and new.matiere is not distinct from old.matiere
     and new.document_type is not distinct from old.document_type
     and new.level is not distinct from old.level
     and new.class_name is not distinct from old.class_name then
    return new;
  end if;

  v_report := public.aurora_validate_scientific_reasoning_quality(
    coalesce(new.matiere,new.subject),
    new.document_type,
    new.level,
    new.class_name,
    new.content_json
  );

  if coalesce((v_report->>'required')::boolean,false)
     and v_report->>'status' <> 'pass' then
    raise exception 'Garde-fou D scientifique Aurore bloqué : %',
      coalesce(v_report->>'failures','[]');
  end if;

  if coalesce((v_report->>'required')::boolean,false) then
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'scientific_reasoning_gate',
        v_report || jsonb_build_object('checked_at',now(),'boundary','D->documents_en_attente')
      );
  end if;

  return new;
end;
$function$;

revoke all on function public.aurora_enforce_scientific_reasoning_d_gate()
  from public, anon, authenticated;
grant execute on function public.aurora_enforce_scientific_reasoning_d_gate()
  to service_role;

drop trigger if exists aurora_generated_documents_scientific_reasoning_d
on public.aurora_generated_documents;

-- 01_ suit le normalizeur 00_connector_normalize :
-- la qualité est donc évaluée sur la forme canonique du contenu avant les
-- autres contrôles métier.
create trigger aurora_generated_documents_scientific_reasoning_d
before insert or update of content_json, subject, matiere, document_type, level, class_name, metadata
on public.aurora_generated_documents
for each row execute function public.aurora_enforce_scientific_reasoning_d_gate();
