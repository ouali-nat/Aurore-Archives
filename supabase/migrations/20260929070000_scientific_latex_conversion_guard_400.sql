-- Aurore Archives — Garde-fou scientifique LaTeX 400.
-- Seuil centralisé dans la mémoire éditoriale et appliqué par le
-- préflight scientifique canonique avant ingestion.

insert into public.aurora_editorial_memory
  (rule_key,version,title,priority,mandatory,active,content)
values
(
  'scientific_latex_conversion_guard',1,
  'Garde-fou scientifique — densité minimale des éléments LaTeX',
  2015,true,true,
  jsonb_build_object(
    'schema_version','scientific-latex-conversion-guard-1',
    'hard_gate',true,
    'minimum_latex_conversion_elements',400,
    'subjects',jsonb_build_array(
      'Mathématiques','Physique-Chimie','Physique','Chimie','Sciences physiques','PC'
    ),
    'scope',jsonb_build_array('cours','exercices','devoirs','corrigés','séries'),
    'meaning','Le contenu scientifique doit comporter au moins 400 éléments mathématiques/scientifiques effectivement convertis en LaTeX. En dessous de ce seuil, l’injection est bloquée et l’éditeur doit compléter la couche scientifique du document.',
    'anti_bypass',jsonb_build_array(
      'Ne pas atteindre le seuil par répétition artificielle.',
      'Ne pas compter les métadonnées, identifiants, chemins d’assets ou textes techniques.',
      'Ne pas utiliser le volume de mots pour compenser une densité LaTeX insuffisante.',
      'Le préflight scientifique reste l’arbitre déterministe final avant ingestion.'
    )
  )
)
on conflict (rule_key,version) do update
set title=excluded.title,
    priority=excluded.priority,
    mandatory=excluded.mandatory,
    active=true,
    content=excluded.content,
    updated_at=now();

create or replace function public.aurora_count_scientific_latex_elements(p_content_json jsonb)
returns integer
language plpgsql
stable
set search_path='public','pg_temp'
as $function$
declare
  v_content text := '';
  v_inside text := '';
  v_slash text := chr(92);
  v_token_pattern text;
  v_match text[];
  v_tokens integer := 0;
  v_count integer := 0;
  v_cursor integer := 1;
  v_start integer := 0;
  v_end_offset integer := 0;
  v_section jsonb;
  v_item jsonb;
  v_value text;
begin
  if p_content_json is null or jsonb_typeof(p_content_json) <> 'object' then
    return 0;
  end if;

  v_content := coalesce(p_content_json->>'introduction','') || ' '
            || coalesce(p_content_json->>'synthesis','');

  if jsonb_typeof(p_content_json->'sections')='array' then
    for v_section in select value from jsonb_array_elements(p_content_json->'sections') loop
      if jsonb_typeof(v_section->'content')='array' then
        for v_value in select value from jsonb_array_elements_text(v_section->'content') loop
          v_content := v_content || ' ' || coalesce(v_value,'');
        end loop;
      elsif jsonb_typeof(v_section->'content')='string' then
        v_content := v_content || ' ' || coalesce(v_section->>'content','');
      end if;

      if jsonb_typeof(v_section->'exercises')='array' then
        for v_item in select value from jsonb_array_elements(v_section->'exercises') loop
          if jsonb_typeof(v_item)='object' then
            for v_value in
              select value from jsonb_each_text(v_item)
              where key not in ('id','exercise_id','graph_id','visual_id')
            loop
              v_content := v_content || ' ' || coalesce(v_value,'');
            end loop;
          elsif jsonb_typeof(v_item) in ('string','number','boolean') then
            v_content := v_content || ' ' || coalesce(v_item #>> '{}','');
          end if;
        end loop;
      end if;

      if jsonb_typeof(v_section->'corrections')='array' then
        for v_item in select value from jsonb_array_elements(v_section->'corrections') loop
          if jsonb_typeof(v_item)='object' then
            for v_value in
              select value from jsonb_each_text(v_item)
              where key not in ('id','exercise_id','graph_id','visual_id')
            loop
              v_content := v_content || ' ' || coalesce(v_value,'');
            end loop;
          elsif jsonb_typeof(v_item) in ('string','number','boolean') then
            v_content := v_content || ' ' || coalesce(v_item #>> '{}','');
          end if;
        end loop;
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_content_json->'corrections')='array' then
    for v_item in select value from jsonb_array_elements(p_content_json->'corrections') loop
      if jsonb_typeof(v_item)='object' then
        for v_value in
          select value from jsonb_each_text(v_item)
          where key not in ('id','exercise_id','graph_id','visual_id')
        loop
          v_content := v_content || ' ' || coalesce(v_value,'');
        end loop;
      elsif jsonb_typeof(v_item) in ('string','number','boolean') then
        v_content := v_content || ' ' || coalesce(v_item #>> '{}','');
      end if;
    end loop;
  end if;

  v_content := regexp_replace(v_content,'[[:space:]]+',' ','g');

  v_token_pattern := v_slash||v_slash||'[A-Za-z]+'
                  ||'|[A-Za-z]+_[A-Za-z0-9]+'
                  ||'|[A-Za-z]+\^[A-Za-z0-9+\-]+'
                  ||'|[A-Za-z]+'
                  ||'|[0-9]+(?:[.,][0-9]+)?'
                  ||'|[-=+*/×÷≈≠≤≥<>→↔⇔√]';

  -- Les délimiteurs canoniques Aurore sont \( ... \) et \[ ... \].
  -- La recherche par positions évite les ambiguïtés d’échappement regex.
  v_cursor := 1;
  loop
    v_start := strpos(substr(v_content,v_cursor),v_slash||'(');
    exit when v_start = 0;
    v_start := v_cursor + v_start - 1;
    v_end_offset := strpos(substr(v_content,v_start+2),v_slash||')');
    exit when v_end_offset = 0;
    v_inside := substr(v_content,v_start+2,v_end_offset-1);
    select count(*) into v_tokens from regexp_matches(v_inside,v_token_pattern,'g');
    v_count := v_count + v_tokens;
    v_cursor := v_start + 2 + v_end_offset;
  end loop;

  v_cursor := 1;
  loop
    v_start := strpos(substr(v_content,v_cursor),v_slash||'[');
    exit when v_start = 0;
    v_start := v_cursor + v_start - 1;
    v_end_offset := strpos(substr(v_content,v_start+2),v_slash||']');
    exit when v_end_offset = 0;
    v_inside := substr(v_content,v_start+2,v_end_offset-1);
    select count(*) into v_tokens from regexp_matches(v_inside,v_token_pattern,'g');
    v_count := v_count + v_tokens;
    v_cursor := v_start + 2 + v_end_offset;
  end loop;

  return greatest(v_count,0);
end;
$function$;

create or replace function public.aurora_scientific_preflight(p_subject text, p_document_type text, p_content_json jsonb)
returns jsonb
language plpgsql
stable
set search_path='public','pg_temp'
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
  v_latex_conversion_elements int := 0;
  v_min_latex_conversion_elements int := 400;
  v_guard_content jsonb := coalesce(
    (select content from public.aurora_editorial_memory
     where rule_key='scientific_latex_conversion_guard'
       and version=1
       and active=true
     order by priority desc
     limit 1),
    '{}'::jsonb
  );
begin
  if p_content_json is null or jsonb_typeof(p_content_json) <> 'object' then
    return jsonb_build_object(
      'status','blocked',
      'contract_version','scientific-preflight-1',
      'failures',jsonb_build_array('content_json doit être un objet JSON.')
    );
  end if;

  v_quant := v_math or v_pc or v_general_quant;

  if v_math then
    v_modules := array['latex','symbolic_math','numerical_verification','graphing_when_relevant'];
  elsif v_pc then
    v_modules := array['latex','numerical_verification','units','dimensional_analysis','chemical_equations','graphing_when_relevant'];
  elsif v_general_quant then
    v_modules := array['latex','numerical_verification','data_consistency','graphing_when_relevant'];
  end if;

  v_min_latex_conversion_elements := coalesce(
    nullif(v_guard_content->>'minimum_latex_conversion_elements','')::int,
    400
  );
  if v_min_latex_conversion_elements < 1 then
    v_min_latex_conversion_elements := 400;
  end if;

  v_latex_conversion_elements := public.aurora_count_scientific_latex_elements(p_content_json);

  v_latex_blocks :=
      least((length(v_raw)-length(replace(v_raw,v_slash||'(', '_')))/2,(length(v_raw)-length(replace(v_raw,v_slash||')', '_')))/2)
    + least((length(v_raw)-length(replace(v_raw,v_slash||'[', '_')))/2,(length(v_raw)-length(replace(v_raw,v_slash||']', '_')))/2)
    + (length(v_raw)-length(replace(v_raw,'$','')))/2;

  select count(*) into v_latex_commands from regexp_matches(v_raw,v_slash||'[A-Za-z]{2,}','g');
  v_equals := length(v_raw)-length(replace(v_raw,'=',''));
  v_scientific_relations := v_equals + v_latex_commands;

  select count(*) into v_units
  from regexp_matches(v_raw,'[0-9]+(?:[.,][0-9]+)?[[:space:]]*(mol(?:/L)?|g|kg|mg|µg|L|mL|Pa|kPa|MPa|J|kJ|W|V|A|K|N|Hz|m/s|cm|mm|km|s|min|h|°C|Ω|C)','gi');

  select count(*) into v_unicode_math from regexp_matches(v_raw,'[≈≃≤≥→⇌↔⇒⇔∈∉⊂⊆∪∩∞∑√]','g');

  select count(*) into v_build_graphs
  from regexp_matches(v_raw, '\"decision\"[[:space:]]*:[[:space:]]*\"build\"', 'g');

  if v_math then
    v_graphable := v_raw ~* 'fonction|courbe|droite|parabole|ellipse|hyperbole|conique|transformation|translation|rotation|symétrie|symetrie|homothétie|homothetie|intersection|tangente|asymptote|suite|système|systeme|repère|repere|géométrie analytique|geometrie analytique|lieu géométrique|lieu geometrique|paramétrique|parametrique|surface|congruence|divisibilité|divisibilite|pgcd|algorithme d.?euclide|bézout|bezout|reste modulo|classe de congruence|résidu|residu|nombre premier';
  elsif v_pc then
    v_graphable := v_raw ~* 'mouvement|trajectoire|vitesse|accélération|acceleration|oscillation|sinusoïdal|sinusoidal|circuit|tension|intensité|intensite|u\\\\(t\\\\)|i\\\\(t\\\\)|pH|titrage|équivalence|equivalence|concentration|absorbance|spectre|énergie|energie|pression|volume|température|temperature|évolution|evolution|courbe|temps';
  elsif v_general_quant then
    v_graphable := v_raw ~* 'graphique|courbe|évolution|evolution|série|serie temporelle|distribution|histogramme|diagramme|données|donnees|statistique|taux|indice|densité|densite|population|croissance|rendement|variation';
  end if;

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

  if (v_math or v_pc) and v_latex_conversion_elements < v_min_latex_conversion_elements then
    if v_math then
      v_failures := array_append(
        v_failures,
        format(
          'MATH-LATEX-400 : %s éléments scientifiques effectivement convertis en LaTeX ; minimum %s requis. Compléter la conversion LaTeX et relancer le contrôle.',
          v_latex_conversion_elements,v_min_latex_conversion_elements
        )
      );
    else
      v_failures := array_append(
        v_failures,
        format(
          'SCI-LATEX-400 : %s éléments scientifiques effectivement convertis en LaTeX ; minimum %s requis. Compléter la conversion LaTeX et relancer le contrôle.',
          v_latex_conversion_elements,v_min_latex_conversion_elements
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'status',case when cardinality(v_failures)=0 then 'pass' else 'blocked' end,
    'contract_version','scientific-preflight-1',
    'subject',p_subject,
    'document_type',p_document_type,
    'quantitative_mode',v_quant,
    'activated_modules',to_jsonb(v_modules),
    'metrics',jsonb_build_object(
      'latex_blocks',v_latex_blocks,
      'latex_commands',v_latex_commands,
      'scientific_relations',v_scientific_relations,
      'units',v_units,
      'unicode_math_symbols',v_unicode_math,
      'built_graphs',v_build_graphs,
      'graphable',v_graphable,
      'latex_conversion_elements',v_latex_conversion_elements,
      'minimum_latex_conversion_elements',case when (v_math or v_pc) then v_min_latex_conversion_elements else 0 end
    ),
    'failures',to_jsonb(v_failures)
  );
end;
$function$;

create or replace function public.aurora_enforce_scientific_content_contract()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $function$
declare
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_report jsonb;
begin
  if v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  -- Les anciens documents peuvent encore évoluer techniquement (PDF,
  -- diagnostics, statuts, metadata) sans être soumis à nouveau au seuil 400.
  -- Une modification du contenu éditorial, elle, repasse par le préflight.
  if tg_op = 'UPDATE'
     and new.content_json is not distinct from old.content_json
     and new.subject is not distinct from old.subject
     and new.document_type is not distinct from old.document_type
     and new.matiere is not distinct from old.matiere then
    return new;
  end if;

  v_report := public.aurora_scientific_preflight(new.matiere,new.document_type,new.content_json);

  if v_report->>'status' <> 'pass' then
    raise exception 'Préflight scientifique Aurore bloqué : %',coalesce(v_report->>'failures','[]');
  end if;

  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object('scientific_preflight',v_report || jsonb_build_object('checked_at',now()));

  return new;
end;
$function$;
