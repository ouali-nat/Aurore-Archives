-- Aurore Archives
-- Hard gate scientifique final D -> Documents en attente.
-- Cette barrière complète le préflight scientifique existant : elle contrôle le
-- raisonnement réellement présent dans le content_json final, avant insertion.
-- Aucun PDF, scheduler ou publication n'est déclenché par cette migration.

create or replace function public.aurora_scientific_reasoning_preflight(
  p_subject text,
  p_document_type text,
  p_level text,
  p_content_json jsonb
)
returns jsonb
language plpgsql
stable
set search_path='public','pg_temp'
as $function$
declare
  v_subject text := lower(coalesce(p_subject,''));
  v_type text := lower(coalesce(p_document_type,''));
  v_level text := lower(coalesce(p_level,''));
  v_raw text := '';
  v_prose text := '';
  v_slash text := chr(92);
  v_scientific boolean;
  v_maternelle boolean;
  v_course boolean := v_type ~ 'cours|course|fiche[[:space:]-]*de[[:space:]-]*cours|document[[:space:]-]*pedagogique|resume|lecon|leçon';
  v_exercises boolean := v_type ~ 'exercice|devoir|corrig';
  v_cursor int := 1;
  v_start int;
  v_close int;
  v_paren int;
  v_bracket int;
  v_previous_tail int := 0;
  v_gap text := '';
  v_gap_words int := 0;
  v_formula_blocks int := 0;
  v_unexplained_gaps int := 0;
  v_explained_gaps int := 0;
  v_unclosed int := 0;
  v_prose_words int := 0;
  v_reasoning_connectors int := 0;
  v_explanation_signals int := 0;
  v_definition_signals int := 0;
  v_method_signals int := 0;
  v_example_signals int := 0;
  v_interpretation_signals int := 0;
  v_reasoning_evidence int := 0;
  v_min_reasoning int := 0;
  v_min_prose_words int := 0;
  v_failures text[] := array[]::text[];
  v_section jsonb;
  v_item jsonb;
  v_value text;
begin
  if p_content_json is null or jsonb_typeof(p_content_json) <> 'object' then
    return jsonb_build_object(
      'status','blocked',
      'contract_version','scientific-reasoning-hard-gate-1',
      'hard_gate',true,
      'failures',jsonb_build_array('content_json doit être un objet JSON.')
    );
  end if;

  v_scientific := v_subject ~ 'math|physique|chimie|sciences[[:space:]-]*physiques|(^|[[:space:]])pc([[:space:]]|$)|biolog|svt|statist|scien|astronom|geolog|ecolog|agronom|technolog';
  v_maternelle := v_level ~ 'maternelle';

  if not v_scientific or v_maternelle then
    return jsonb_build_object(
      'status','pass',
      'contract_version','scientific-reasoning-hard-gate-1',
      'hard_gate',true,
      'scope',case when v_maternelle then 'maternelle-exempt' else 'non-scientific' end,
      'metrics',jsonb_build_object(
        'formula_blocks',0,
        'prose_words',0,
        'reasoning_connectors',0,
        'explanation_signals',0,
        'definition_signals',0,
        'method_signals',0,
        'example_signals',0,
        'interpretation_signals',0,
        'unexplained_formula_gaps',0,
        'explained_formula_gaps',0
      ),
      'failures',jsonb_build_array()
    );
  end if;

  for v_value in
    select value
    from jsonb_each_text(p_content_json)
    where key in (
      'title','introduction','synthesis','notes','content','methods',
      'examples','activities','exercises','corrections',
      'differentiation','evaluation'
    )
  loop
    v_raw := v_raw || ' ' || coalesce(v_value,'');
  end loop;

  if jsonb_typeof(p_content_json->'sections')='array' then
    for v_section in select value from jsonb_array_elements(p_content_json->'sections') loop
      v_raw := v_raw || ' ' || coalesce(v_section->>'title','') || ' ' || coalesce(v_section->>'content','');

      if jsonb_typeof(v_section->'content')='array' then
        for v_item in select value from jsonb_array_elements(v_section->'content') loop
          if jsonb_typeof(v_item)='object' then
            for v_value in select value from jsonb_each_text(v_item) loop
              v_raw := v_raw || ' ' || coalesce(v_value,'');
            end loop;
          else
            v_raw := v_raw || ' ' || coalesce(v_item #>> '{}','');
          end if;
        end loop;
      end if;

      if jsonb_typeof(v_section->'exercises')='array' then
        for v_item in select value from jsonb_array_elements(v_section->'exercises') loop
          if jsonb_typeof(v_item)='object' then
            for v_value in
              select value
              from jsonb_each_text(v_item)
              where key not in ('id','exercise_id','graph_id','visual_id')
            loop
              v_raw := v_raw || ' ' || coalesce(v_value,'');
            end loop;
          else
            v_raw := v_raw || ' ' || coalesce(v_item #>> '{}','');
          end if;
        end loop;
      end if;

      if jsonb_typeof(v_section->'corrections')='array' then
        for v_item in select value from jsonb_array_elements(v_section->'corrections') loop
          if jsonb_typeof(v_item)='object' then
            for v_value in
              select value
              from jsonb_each_text(v_item)
              where key not in ('id','exercise_id','graph_id','visual_id')
            loop
              v_raw := v_raw || ' ' || coalesce(v_value,'');
            end loop;
          else
            v_raw := v_raw || ' ' || coalesce(v_item #>> '{}','');
          end if;
        end loop;
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_content_json->'corrections')='array' then
    for v_item in select value from jsonb_array_elements(p_content_json->'corrections') loop
      if jsonb_typeof(v_item)='object' then
        for v_value in
          select value
          from jsonb_each_text(v_item)
          where key not in ('id','exercise_id','graph_id','visual_id')
        loop
          v_raw := v_raw || ' ' || coalesce(v_value,'');
        end loop;
      else
        v_raw := v_raw || ' ' || coalesce(v_item #>> '{}','');
      end if;
    end loop;
  end if;

  v_raw := regexp_replace(v_raw,'[[:space:]]+',' ','g');

  -- Extraire la prose autour des blocs LaTeX et contrôler les transitions.
  v_cursor := 1;
  loop
    v_paren := strpos(substr(v_raw,v_cursor), v_slash||'(');
    v_bracket := strpos(substr(v_raw,v_cursor), v_slash||'[');

    if v_paren=0 and v_bracket=0 then
      v_prose := v_prose || substr(v_raw,v_cursor);
      exit;
    end if;

    if v_paren=0 or (v_bracket>0 and v_bracket<v_paren) then
      v_start := v_cursor + v_bracket - 1;
      v_close := strpos(substr(v_raw,v_start+2), v_slash||']');
    else
      v_start := v_cursor + v_paren - 1;
      v_close := strpos(substr(v_raw,v_start+2), v_slash||')');
    end if;

    v_prose := v_prose || substr(v_raw,v_cursor,greatest(v_start-v_cursor,0));

    if v_close=0 then
      v_unclosed := v_unclosed + 1;
      v_prose := v_prose || substr(v_raw,v_start);
      exit;
    end if;

    if v_previous_tail>0 then
      v_gap := substr(v_raw,v_previous_tail,greatest(v_start-v_previous_tail,0));
      v_gap_words := case
        when trim(v_gap)='' then 0
        else array_length(
          regexp_split_to_array(
            trim(regexp_replace(v_gap,'[^[:alnum:][:alpha:]]+',' ','g')),
            '[[:space:]]+'
          ),1
        )
      end;

      if coalesce(v_gap_words,0) >= 5
         or v_gap ~* '(donc|ainsi|alors|par[[:space:]]+conséquent|par[[:space:]]+consequent|ce[[:space:]]+qui[[:space:]]+implique|ce[[:space:]]+qui[[:space:]]+signifie|on[[:space:]]+en[[:space:]]+déduit|on[[:space:]]+en[[:space:]]+deduit|ce[[:space:]]+qui[[:space:]]+montre|cela[[:space:]]+montre|d[[:space:]]*où|d[[:space:]]+ou|puisque|car|en[[:space:]]+effet)' then
        v_explained_gaps := v_explained_gaps + 1;
      else
        v_unexplained_gaps := v_unexplained_gaps + 1;
      end if;
    end if;

    v_formula_blocks := v_formula_blocks + 1;
    v_start := v_start + 2 + v_close - 1;
    v_previous_tail := v_start + 2;
    v_cursor := v_previous_tail;
  end loop;

  v_prose_words := case
    when trim(v_prose)='' then 0
    else array_length(
      regexp_split_to_array(
        trim(regexp_replace(v_prose,'[^[:alnum:][:alpha:]]+',' ','g')),
        '[[:space:]]+'
      ),1
  end;

  select count(*) into v_reasoning_connectors
  from regexp_matches(
    v_prose,
    '(?i)(donc|ainsi|alors|par[[:space:]]+conséquent|par[[:space:]]+consequent|ce[[:space:]]+qui[[:space:]]+implique|ce[[:space:]]+qui[[:space:]]+signifie|on[[:space:]]+en[[:space:]]+déduit|on[[:space:]]+en[[:space:]]+deduit|ce[[:space:]]+qui[[:space:]]+montre|cela[[:space:]]+montre|d[[:space:]]*où|d[[:space:]]+ou|puisque|car|en[[:space:]]+effet|si[[:space:]]+et[[:space:]]+seulement[[:space:]]+si)',
    'g'
  );

  select count(*) into v_explanation_signals
  from regexp_matches(
    v_prose,
    '(?i)(expliqu|raisonn|justifi|autrement[[:space:]]+dit|cela[[:space:]]+signifie|cela[[:space:]]+permet|on[[:space:]]+obtient|on[[:space:]]+trouve|on[[:space:]]+calcule)',
    'g'
  );

  select count(*) into v_definition_signals
  from regexp_matches(
    v_prose,
    '(?i)(définition|definition|on[[:space:]]+définit|on[[:space:]]+definit|par[[:space:]]+définition|par[[:space:]]+definition|on[[:space:]]+appelle|désigne|designe|notons|on[[:space:]]+note|soit)',
    'g'
  );

  select count(*) into v_method_signals
  from regexp_matches(
    v_prose,
    '(?i)(méthode|methode|étape|etape|procéd|proced|on[[:space:]]+applique|on[[:space:]]+calcule|on[[:space:]]+résout|on[[:space:]]+resout|on[[:space:]]+isole|on[[:space:]]+remplace|on[[:space:]]+substitue|on[[:space:]]+dérive|on[[:space:]]+derive|on[[:space:]]+factorise|on[[:space:]]+développe|on[[:space:]]+developpe|on[[:space:]]+simplifie|on[[:space:]]+détermine|on[[:space:]]+determine)',
    'g'
  );

  select count(*) into v_example_signals
  from regexp_matches(
    v_prose,
    '(?i)(exemple|application|cas[[:space:]]+particulier|prenons|considérons|considerons)',
    'g'
  );

  select count(*) into v_interpretation_signals
  from regexp_matches(
    v_prose,
    '(?i)(interprét|interpret|cela[[:space:]]+signifie|signifie[[:space:]]+que|représente|represente|physiquement|chimiquement|en[[:space:]]+pratique|on[[:space:]]+en[[:space:]]+conclut)',
    'g'
  );

  v_reasoning_evidence := v_reasoning_connectors + v_explained_gaps;

  if v_unclosed>0 then
    v_failures := array_append(
      v_failures,
      'SCI-REASONING-LATEX-001 : un ou plusieurs blocs mathématiques sont ouverts mais non fermés.'
    );
  end if;

  if v_formula_blocks>=3 and v_unexplained_gaps>=2 then
    v_failures := array_append(
      v_failures,
      format(
        'SCI-REASONING-SEQ-001 : %s lacune(s) entre blocs mathématiques sans explication suffisante ; une suite de formules ne peut pas remplacer le raisonnement.',
        v_unexplained_gaps
      )
    );
  end if;

  if v_formula_blocks>=4 and v_explanation_signals<2 and v_reasoning_evidence<2 then
    v_failures := array_append(
      v_failures,
      'SCI-REASONING-EXPL-001 : le contenu scientifique contient plusieurs relations/formules mais trop peu de traces explicites d’explication du raisonnement.'
    );
  end if;

  if v_course then
    v_min_prose_words := greatest(120, ceil(greatest(v_formula_blocks,1)*3.0)::int);
    v_min_reasoning := greatest(3, least(24, ceil(greatest(v_formula_blocks,1)*0.08)::int));

    if v_formula_blocks>=6 and v_prose_words<v_min_prose_words then
      v_failures := array_append(
        v_failures,
        format(
          'SCI-REASONING-PROSE-001 : %s mots de prose explicative détectés ; minimum %s pour accompagner %s blocs/formules.',
          v_prose_words,v_min_prose_words,v_formula_blocks
        )
      );
    end if;

    if v_formula_blocks>=6 and v_explanation_signals<3 then
      v_failures := array_append(
        v_failures,
        'SCI-REASONING-EXPL-002 : un cours scientifique doit expliquer les étapes, et pas seulement énumérer les relations ou résultats.'
      );
    end if;

    if v_formula_blocks>=6 and v_reasoning_evidence<v_min_reasoning then
      v_failures := array_append(
        v_failures,
        format(
          'SCI-REASONING-LOGIC-001 : %s trace(s) de raisonnement explicite/liaison entre étapes ; minimum %s requis pour %s blocs/formules.',
          v_reasoning_evidence,v_min_reasoning,v_formula_blocks
        )
      );
    end if;

    if v_definition_signals<1 then
      v_failures := array_append(
        v_failures,
        'SCI-REASONING-DEF-001 : aucune trace suffisante de définition/identification des notions ou grandeurs.'
      );
    end if;

    if v_method_signals<1 then
      v_failures := array_append(
        v_failures,
        'SCI-REASONING-METHOD-001 : aucune trace suffisante de méthode ou de démarche de résolution.'
      );
    end if;

    if v_example_signals<1 then
      v_failures := array_append(
        v_failures,
        'SCI-REASONING-EXAMPLE-001 : aucun exemple ou cas d’application explicite détecté.'
      );
    end if;

    if v_interpretation_signals<1 then
      v_failures := array_append(
        v_failures,
        'SCI-REASONING-INTERPRET-001 : aucun signal d’interprétation du résultat ou de la signification scientifique détecté.'
      );
    end if;

  elsif not v_exercises then
    v_min_prose_words := greatest(80, ceil(greatest(v_formula_blocks,1)*2.0)::int);

    if v_formula_blocks>=4 and v_prose_words<v_min_prose_words then
      v_failures := array_append(
        v_failures,
        format(
          'SCI-REASONING-PROSE-002 : %s mots de prose explicative détectés ; minimum %s pour %s blocs/formules.',
          v_prose_words,v_min_prose_words,v_formula_blocks
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'status',case when cardinality(v_failures)=0 then 'pass' else 'blocked' end,
    'contract_version','scientific-reasoning-hard-gate-1',
    'hard_gate',true,
    'scope',
      case
        when v_course then 'scientific-course'
        when v_exercises then 'scientific-exercise'
        else 'scientific-document'
      end,
    'metrics',jsonb_build_object(
      'formula_blocks',v_formula_blocks,
      'prose_words',v_prose_words,
      'reasoning_connectors',v_reasoning_connectors,
      'explanation_signals',v_explanation_signals,
      'definition_signals',v_definition_signals,
      'method_signals',v_method_signals,
      'example_signals',v_example_signals,
      'interpretation_signals',v_interpretation_signals,
      'reasoning_evidence',v_reasoning_evidence,
      'unexplained_formula_gaps',v_unexplained_gaps,
      'explained_formula_gaps',v_explained_gaps,
      'unclosed_math_blocks',v_unclosed,
      'minimum_prose_words',v_min_prose_words,
      'minimum_reasoning_evidence',v_min_reasoning
    ),
    'pedagogical_contract',jsonb_build_object(
      'course_sequence',jsonb_build_array(
        'notion ou problème',
        'définition',
        'explication',
        'méthode',
        'raisonnement étape par étape',
        'exemple/application',
        'interprétation',
        'exercice/correction'
      ),
      'principle',
        'Une formule, une loi ou un résultat scientifique ne doit pas apparaître comme une suite isolée : le chemin de raisonnement doit être explicité.'
    ),
    'failures',to_jsonb(v_failures)
  );
end;
$function$;

-- On étend le préflight scientifique canonique (6 paramètres), déjà utilisé par
-- le trigger d'insertion de aurora_generated_documents et par Section D.
create or replace function public.aurora_scientific_preflight(
  p_subject text,
  p_document_type text,
  p_content_json jsonb,
  p_level text,
  p_class_name text,
  p_research jsonb
)
returns jsonb
language plpgsql
stable
set search_path='public','pg_temp'
as $function$
declare
 s text:=lower(coalesce(p_subject,''));
 l text:=lower(coalesce(p_level,''));
 c text:=lower(coalesce(p_class_name,''));
 raw text:=coalesce(p_content_json::text,'');
 scientific boolean:=s~'math|physique|chimie|sciences[[:space:]-]*physiques|(^|[[:space:]])pc([[:space:]]|$)|biolog|svt|statist|scien';
 maternelle boolean:=l~'maternelle' or c~'maternelle';
 primary_level boolean:=l~'primaire|elementaire|élémentaire' or c~'(^|[[:space:]-])(cp|ce1|ce2|cm1|cm2)([[:space:]-]|$)';
 college boolean:=l~'college|collège|post[[:space:]-]*primaire' or c~'(^|[[:space:]-])(6e|5e|4e|3e|6eme|5eme|4eme|3eme|6ème|5ème|4ème|3ème)([[:space:]-]|$)';
 lycee boolean:=l~'lycee|lycée|secondaire.*2nd|secondaire.*cycle' or c~'seconde|2nde|2de|premiere|première|1ere|1re|terminale|tle';
 higher boolean:=l~'univers|superieur|supérieur|licence|master|doctor|bts|dut|deug|ingenieur|ingénieur|formation[[:space:]-]*professionnelle' or c~'licence|master|doctor|bts|dut|deug|ingenieur|ingénieur';
 minlatex int:=0;
 latex_count int:=0;
 graph_count int:=0;
 source_sites int:=0;
 implications int:=0;
 connector_implications int:=0;
 max_implications int:=0;
 min_implications int:=1;
 failures text[]:=array[]::text[];
 base jsonb;
 reasoning jsonb;
 research jsonb:=coalesce(p_research,'{}'::jsonb);
begin
 if p_content_json is null or jsonb_typeof(p_content_json)<>'object' then
   return jsonb_build_object('status','blocked','contract_version','scientific-preflight-4',
     'failures',jsonb_build_array('content_json doit être un objet JSON.'));
 end if;

 if not scientific or maternelle then
   return jsonb_build_object('status','pass','contract_version','scientific-preflight-4',
     'scope',case when maternelle then 'maternelle-exempt' else 'non-scientific' end,
     'metrics',jsonb_build_object(
       'latex_conversion_elements',public.aurora_count_scientific_latex_elements(p_content_json),
       'geogebra_graphs',0,'source_sites',0,'implication_count',0));
 end if;

 if primary_level then minlatex:=400;
 elsif college then minlatex:=500;
 elsif lycee or higher then minlatex:=1200;
 else minlatex:=1200;
 end if;

 latex_count:=public.aurora_count_scientific_latex_elements(p_content_json);

 base:=public.aurora_scientific_preflight(p_subject,p_document_type,p_content_json);

 if jsonb_typeof(base->'failures')='array' then
   select coalesce(array_agg(value::text),array[]::text[])
   into failures
   from jsonb_array_elements_text(base->'failures');
 end if;

 if latex_count<minlatex then
   failures:=array_append(
     failures,
     format(
       'SCI-LATEX-LEVEL : %s éléments LaTeX ; minimum %s requis pour %s.',
       latex_count,minlatex,coalesce(p_level,'niveau non précisé')
     )
   );
 end if;

 select count(*)
 into graph_count
 from jsonb_array_elements(coalesce(p_content_json->'sections','[]'::jsonb)) sec
 cross join lateral jsonb_array_elements(coalesce(sec->'graphs','[]'::jsonb)) g
 where lower(coalesce(g->>'type',''))='geogebra'
    or lower(coalesce(g->>'instrument',g->>'graph_type','')) in
       ('function2d','complex_plane','parametric2d','parametric3d',
        'surface3d','geometry2d','geometry3d','geogebra');

 if graph_count<2 then
   failures:=array_append(
     failures,
     format('SCI-GEOGEBRA-001 : %s construction(s) GeoGebra ; minimum 2 requis.',graph_count)
   );
 end if;

 implications=
   (length(raw)-length(replace(raw,'\\Rightarrow','')))/length('\\Rightarrow')
  +(length(raw)-length(replace(raw,'\\Longrightarrow','')))/length('\\Longrightarrow')
  +(length(raw)-length(replace(raw,'\\implies','')))/length('\\implies')
  +(length(raw)-length(replace(raw,'\\Longimplies','')))/length('\\Longimplies')
  +(length(raw)-length(replace(raw,'⇒','')))/length('⇒')
  +(length(raw)-length(replace(raw,'⟹','')))/length('⟹');

 select count(*)
 into connector_implications
 from regexp_matches(
   raw,
   '(?i)\b(?:donc|ainsi|alors|on s''ensuit|on en déduit|il s''ensuit)\b',
   'g'
 );

 implications:=implications+connector_implications;
 max_implications:=least(100,greatest(1,ceil(latex_count*0.08)::int));

 if implications<min_implications then
   failures:=array_append(
     failures,
     'SCI-IMPLICATION-002 : au moins un signe d''implication LaTeX ou un connecteur de raisonnement convertible est requis.'
   );
 elsif implications>max_implications then
   failures:=array_append(
     failures,
     format(
       'SCI-IMPLICATION-001 : %s implications ; plafond %s pour %s éléments LaTeX.',
       implications,max_implications,latex_count
     )
   );
 end if;

 reasoning:=public.aurora_scientific_reasoning_preflight(
  p_subject,p_document_type,p_level,p_content_json
 );

 if jsonb_typeof(reasoning->'failures')='array' then
   failures:=failures || array(
     select value::text
     from jsonb_array_elements_text(reasoning->'failures')
   );
 end if;

 return jsonb_build_object(
   'status',case when cardinality(failures)=0 then 'pass' else 'blocked' end,
   'contract_version','scientific-preflight-4',
   'subject',p_subject,
   'level',p_level,
   'class_name',p_class_name,
   'metrics',
     jsonb_build_object(
       'latex_conversion_elements',latex_count,
       'minimum_latex_conversion_elements',minlatex,
       'geogebra_graphs',graph_count,
       'minimum_geogebra_graphs',2,
       'source_sites',source_sites,
       'minimum_source_sites',3,
       'implication_count',implications,
       'source_connector_count',connector_implications,
       'minimum_implications',min_implications,
       'maximum_implications',max_implications
     ) || coalesce(reasoning->'metrics','{}'::jsonb),
   'reasoning_guard',reasoning,
   'research_guard',jsonb_build_object(
     'structured_trace',true,
     'distinct_sites_required',3
   ),
   'implication_guard',jsonb_build_object(
     'minimum_absolute',1,
     'maximum_absolute',100,
     'maximum_ratio',0.08,
     'paragraph_rule','inline_in_paragraph'
   ),
   'failures',to_jsonb(failures)
 );
end;
$function$;

-- Barrière serveur finale : aucune production éditoriale scientifique issue de D
-- ne peut entrer dans le sas Documents en attente sans raisonnement conforme.
create or replace function public.aurora_enforce_scientific_reasoning_d_gate()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $function$
declare
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_pending boolean := coalesce(new.metadata->>'pending_admin_surface','')='documents_en_attente';
  v_report jsonb;
begin
  if not v_pending and v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if tg_op='UPDATE'
     and new.content_json is not distinct from old.content_json
     and new.subject is not distinct from old.subject
     and new.matiere is not distinct from old.matiere
     and new.document_type is not distinct from old.document_type
     and new.level is not distinct from old.level
     and new.class_name is not distinct from old.class_name then
    return new;
  end if;

  v_report := public.aurora_scientific_reasoning_preflight(
    coalesce(new.matiere,new.subject),
    new.document_type,
    new.level,
    new.content_json
  );

  if v_report->>'status' <> 'pass' then
    raise exception 'Garde-fou D scientifique Aurore bloqué : %',
      coalesce(v_report->>'failures','[]');
  end if;

  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'scientific_reasoning_gate',
      v_report || jsonb_build_object(
        'checked_at',now(),
        'boundary','D->documents_en_attente',
        'hard_gate',true
      )
    );

  return new;
end;
$function$;

drop trigger if exists aurora_generated_documents_01_scientific_reasoning_d
on public.aurora_generated_documents;

create trigger aurora_generated_documents_01_scientific_reasoning_d
before insert or update of content_json, subject, matiere, document_type, level, class_name, metadata
on public.aurora_generated_documents
for each row execute function public.aurora_enforce_scientific_reasoning_d_gate();

revoke all on function public.aurora_scientific_reasoning_preflight(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.aurora_enforce_scientific_reasoning_d_gate() from public, anon, authenticated;
grant execute on function public.aurora_scientific_reasoning_preflight(text,text,text,jsonb) to service_role;
grant execute on function public.aurora_enforce_scientific_reasoning_d_gate() to service_role;

-- La fonction canonique ci-dessus est déjà appelée par le trigger scientifique
-- existant sur aurora_generated_documents. L'insertion D -> sas est donc
-- impossible tant que le raisonnement scientifique n'est pas conforme.
-- Le test ci-dessous reste transactionnel et ne modifie aucune donnée réelle.
do $test$
declare
  bad jsonb := jsonb_build_object(
    'title','Cours test',
    'sections',jsonb_build_array(jsonb_build_object(
      'title','Dérivation',
      'content',
        chr(92)||'(f''(x)=2x'||chr(92)||') '||
        chr(92)||'(f''(x)=0'||chr(92)||') '||
        chr(92)||'(x=0'||chr(92)||') '||
        chr(92)||'(D=4'||chr(92)||') '||
        chr(92)||'(x_1=2'||chr(92)||') '||
        chr(92)||'(x_2=3'||chr(92)||')'
    ))
  );
  good jsonb := jsonb_build_object(
    'title','Cours test',
    'introduction',
      'On définit la notion étudiée et les grandeurs nécessaires avant de commencer le calcul. Cette étape précise le contexte, les hypothèses et les notations utilisées.',
    'synthesis',
      'En pratique, le résultat obtenu doit être interprété dans le contexte du problème et comparé aux hypothèses de départ.',
    'sections',jsonb_build_array(jsonb_build_object(
      'title','Méthode et application',
      'content',
        'Par définition, la grandeur recherchée est liée à la première relation. Nous expliquons ici pourquoi cette relation est adaptée au problème et quelles variables elle met en jeu. '||
        chr(92)||'(f''(x)=2x'||chr(92)||') '||
        'Pour déterminer la valeur, on applique la méthode puis on isole la grandeur inconnue en conservant la même relation. '||
        chr(92)||'(2x=6'||chr(92)||') '||
        'Donc, en divisant les deux membres par deux, on obtient le résultat suivant et cette transformation est justifiée par la propriété utilisée. '||
        chr(92)||'(x=3'||chr(92)||') '||
        'Cela signifie que la valeur calculée satisfait bien la relation de départ. Exemple : considérons un cas particulier et vérifions numériquement le résultat obtenu. '||
        chr(92)||'(f''(3)=6'||chr(92)||') '||
        'Ainsi, on interprète le résultat dans le contexte étudié, puis on vérifie son unité et sa cohérence. '||
        chr(92)||'(6=6'||chr(92)||') '||
        'On en déduit finalement une valeur cohérente avec les hypothèses. Cette conclusion montre comment le calcul précédent répond à la question posée.'
    ))
  );
  r_bad jsonb;
  r_good jsonb;
  r_full jsonb;
begin
  select public.aurora_scientific_reasoning_preflight('Mathématiques','cours','Terminale',bad)
  into r_bad;

  if r_bad->>'status' <> 'blocked' then
    raise exception 'TEST SCI-REASONING bad unexpectedly passed: %',r_bad;
  end if;

  select public.aurora_scientific_reasoning_preflight('Mathématiques','cours','Terminale',good)
  into r_good;

  if r_good->>'status' <> 'pass' then
    raise exception 'TEST SCI-REASONING good unexpectedly blocked: %',r_good;
  end if;

  select public.aurora_scientific_preflight(
    'Mathématiques','cours',bad,'Terminale','Terminale C','{}'::jsonb
  )
  into r_full;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(r_full->'failures','[]'::jsonb)) v
    where v like 'SCI-REASONING-%'
  ) then
    raise exception 'TEST SCI-PREFLIGHT did not propagate reasoning failures: %',r_full;
  end if;
end;
$test$;

rollback;
