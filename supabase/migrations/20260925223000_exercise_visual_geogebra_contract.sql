-- Exercise-series visual contract: no documentary-image quota; GeoGebra is
-- optional but explicitly planned per exercise for Mathématiques and
-- Physique-Chimie, with independent statement/correction channels.

update public.aurora_editorial_memory
set active=false, updated_at=now()
where rule_key='exercise_and_correction' and version=1;

insert into public.aurora_editorial_memory
(rule_key,version,title,priority,mandatory,active,content)
values
('exercise_and_correction',2,'Exercices et corrigés : structure et supports visuels',850,true,true,
 jsonb_build_object(
   'rules',jsonb_build_array(
     'énoncé identifiable',
     'correction rattachée à l’exercice',
     'corrigé centré sur la question posée',
     'calculs lisibles',
     'un graphique ne doit apparaître que lorsqu’il apporte une information pédagogique réelle'
   ),
   'profiles',jsonb_build_object(
     'cours','les exercices complètent la leçon',
     'exercices','énoncés indépendants et corrections correspondantes'
   ),
   'visual_rule','Pour une série d’exercices, les images documentaires ne sont ni obligatoires ni soumises à un quota. Elles ne sont utilisées que si le problème lui-même en a besoin. Les représentations GeoGebra relèvent d’un contrat séparé et peuvent être utilisées en Mathématiques et en Physique-Chimie.'
 ));

insert into public.aurora_editorial_memory
(rule_key,version,title,priority,mandatory,active,content)
values
('exercise_visual_policy',1,'Politique visuelle des séries d’exercices',987,true,true,
 jsonb_build_object(
   'scope',jsonb_build_array('exercices','séries d’exercices','devoirs','corrigés'),
   'general_rule','Ne jamais ajouter une image ou un graphique pour remplir un quota. Une série d’exercices doit rester centrée sur les compétences évaluées.',
   'documentary_images',jsonb_build_object(
     'required',false,
     'source','Wikimedia Commons',
     'rule','Pas d’obligation d’illustration documentaire automatique. Une image n’est acceptable que si elle fait partie intégrante du problème ou fournit une donnée à observer.'
   ),
   'geogebra',jsonb_build_object(
     'subjects',jsonb_build_array('mathématiques','physique-chimie'),
     'required',false,
     'trigger',jsonb_build_array('courbe ou fonction','lecture d’un graphique','construction d’une courbe','conique ou lieu géométrique','plan complexe','vecteur ou résultante','trajectoire','grandeur physique en fonction du temps','relation quantitative ou phénomène dynamique'),
     'contract_location','content_json.exercise_geogebra_plan',
     'schema_version','exercise-geogebra-plan-1',
     'decision_per_exercise','pour chaque exercice, décider séparément pour l’énoncé et pour le corrigé : build ou not_needed',
     'no_quota',true
   ),
   'statement_vs_correction',jsonb_build_array(
     'Si l’énoncé demande à l’élève de tracer, construire ou représenter une courbe, ne pas donner cette construction dans l’énoncé sauf si elle constitue précisément la donnée à lire.',
     'Si une représentation est nécessaire pour la lecture des données de l’énoncé, elle appartient à l’énoncé.',
     'Le corrigé peut construire et montrer le graphique attendu lorsque cela aide à vérifier ou expliquer le résultat.',
     'Un graphique de corrigé ne doit pas être ajouté lorsque le résultat est purement algébrique et qu’il n’apporte rien.'
   ),
   'data_contract',jsonb_build_object(
     'location','content_json.exercise_geogebra_plan',
     'schema_version','exercise-geogebra-plan-1',
     'decision_fields',jsonb_build_array('exercise_number','statement','correction'),
     'channel_fields',jsonb_build_array('decision','rationale','graph_ids'),
     'graph_locations',jsonb_build_array('exercise.statement_graphs','exercise.correction_graphs','corrections[].graphs')
   ),
   'other_subjects','Pour les autres matières, ne pas demander de graphique GeoGebra automatiquement et ne pas imposer d’images. Une extension ultérieure devra être explicitement décidée.'
 ));

insert into public.aurora_math_editorial_memory
(rule_key,version,title,priority,mandatory,active,content)
values
('math_exercise_geogebra',1,'GeoGebra dans les séries d’exercices de mathématiques',968,true,true,
 jsonb_build_object(
   'scope',jsonb_build_array('exercices','séries d’exercices','corrigés'),
   'principle','Utiliser GeoGebra lorsque la représentation apporte une information mathématique utile, sans aucun quota.',
   'consider_for',jsonb_build_array('fonctions et courbes','études de variations','coniques','intersections et tangentes','lieux géométriques','géométrie analytique','transformations','plan complexe','courbes paramétriques'),
   'exercise_rule','Distinguer strictement le graphique nécessaire à la lecture de l’énoncé et le graphique construit dans le corrigé. Ne pas révéler dans l’énoncé une construction que l’élève est précisément invité à produire.',
   'contract',jsonb_build_object(
     'location','content_json.exercise_geogebra_plan',
     'schema_version','exercise-geogebra-plan-1',
     'graph_locations',jsonb_build_array('exercise.statement_graphs','exercise.correction_graphs','corrections[].graphs')
   )
 ));

CREATE OR REPLACE FUNCTION public.aurora_enforce_exercise_geogebra_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_subject text := lower(coalesce(new.subject,''));
  v_document_type text := lower(coalesce(new.document_type,''));
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_content jsonb := coalesce(new.content_json,'{}'::jsonb);
  v_plan jsonb;
  v_decisions jsonb;
  v_section jsonb;
  v_ex jsonb;
  v_corr jsonb;
  v_graph jsonb;
  v_channel jsonb;
  v_graphs jsonb;
  v_graph_ids jsonb;
  v_decision jsonb;
  v_idx int;
  v_exercise_number int := 0;
  v_total_exercises int := 0;
  v_graph_count int := 0;
  v_id text;
  v_choice text;
  v_instrument text;
  v_section_graphs int := 0;
  v_seen_ids text[] := array[]::text[];
  v_referenced_ids text[] := array[]::text[];
  v_decision_numbers int[] := array[]::int[];
  v_subject_supported boolean;
begin
  if v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if v_document_type !~ 'exercice|devoir|corrig' then
    return new;
  end if;

  v_subject_supported :=
    v_subject ~ 'math'
    or v_subject ~ 'physique'
    or v_subject ~ 'chimie'
    or v_subject ~ 'sciences[[:space:]-]*physiques'
    or v_subject ~ '(^|[[:space:]])pc([[:space:]]|$)';

  if jsonb_typeof(v_content->'sections') <> 'array' then
    raise exception 'Série d’exercices : sections doit être un tableau';
  end if;

  for v_section in select value from jsonb_array_elements(v_content->'sections') loop
    if jsonb_typeof(v_section->'graphs') = 'array' then
      v_section_graphs := v_section_graphs + jsonb_array_length(v_section->'graphs');
    end if;

    if jsonb_typeof(v_section->'exercises') = 'array' then
      v_total_exercises := v_total_exercises + jsonb_array_length(v_section->'exercises');
    end if;
  end loop;

  -- Legacy section-level graphs remain untouched outside the GPT ingest gate.
  if v_section_graphs > 0 and v_subject_supported then
    raise exception 'Série d’exercices : les nouveaux graphiques doivent appartenir à exercise.statement_graphs ou exercise.correction_graphs, pas à section.graphs';
  end if;

  -- Any explicit GeoGebra graph in unsupported exercise subjects is rejected
  -- for new editorial ingest, while old/manual documents remain untouched.
  if not v_subject_supported then
    if v_section_graphs > 0 then
      raise exception 'Série d’exercices : les constructions GeoGebra ne sont pas autorisées pour cette matière dans l’ingestion éditoriale';
    end if;

    for v_section in select value from jsonb_array_elements(v_content->'sections') loop
      for v_ex in
        select value from jsonb_array_elements(
          case when jsonb_typeof(v_section->'exercises')='array'
               then v_section->'exercises' else '[]'::jsonb end
        )
      loop
        v_graph_count := v_graph_count
          + case when jsonb_typeof(v_ex->'statement_graphs')='array'
                 then jsonb_array_length(v_ex->'statement_graphs') else 0 end
          + case when jsonb_typeof(v_ex->'correction_graphs')='array'
                 then jsonb_array_length(v_ex->'correction_graphs') else 0 end;
      end loop;
    end loop;

    if jsonb_typeof(v_content->'corrections')='array' then
      for v_corr in select value from jsonb_array_elements(v_content->'corrections') loop
        if jsonb_typeof(v_corr->'graphs')='array' then
          v_graph_count := v_graph_count + jsonb_array_length(v_corr->'graphs');
        end if;
      end loop;
    end if;

    if v_graph_count > 0 then
      raise exception 'Série d’exercices : GeoGebra est actuellement réservé aux Mathématiques et à la Physique-Chimie pour l’ingestion éditoriale';
    end if;

    return new;
  end if;

  -- For Math/PC, a decision is explicit for every exercise and separately
  -- for the statement and the correction.
  v_plan := coalesce(
    v_content->'exercise_geogebra_plan',
    case when jsonb_typeof(v_content->'metadata')='object'
         then v_content->'metadata'->'exercise_geogebra_plan'
         else null end
  );

  if v_plan is null or jsonb_typeof(v_plan) <> 'object' then
    raise exception 'Série Math/Physique-Chimie : exercise_geogebra_plan obligatoire';
  end if;

  if coalesce(v_plan->>'schema_version','') <> 'exercise-geogebra-plan-1' then
    raise exception 'Série Math/Physique-Chimie : exercise_geogebra_plan.schema_version doit être exercise-geogebra-plan-1';
  end if;

  v_decisions := v_plan->'decisions';
  if jsonb_typeof(v_decisions) <> 'array'
     or jsonb_array_length(v_decisions) <> v_total_exercises then
    raise exception 'Série Math/Physique-Chimie : une décision doit exister pour chaque exercice';
  end if;

  -- Validate decision numbering and duplicates.
  for v_decision in select value from jsonb_array_elements(v_decisions) loop
    begin
      v_exercise_number := (v_decision->>'exercise_number')::int;
    exception when others then
      raise exception 'exercise_geogebra_plan : exercise_number invalide';
    end;

    if v_exercise_number < 1 or v_exercise_number > v_total_exercises then
      raise exception 'exercise_geogebra_plan : exercise_number hors plage';
    end if;

    if v_exercise_number = any(v_decision_numbers) then
      raise exception 'exercise_geogebra_plan : exercise_number dupliqué : %', v_exercise_number;
    end if;

    v_decision_numbers := array_append(v_decision_numbers, v_exercise_number);
  end loop;

  -- Process every exercise in document order.
  v_exercise_number := 0;
  for v_section in select value from jsonb_array_elements(v_content->'sections') loop
    for v_ex in
      select value from jsonb_array_elements(
        case when jsonb_typeof(v_section->'exercises')='array'
             then v_section->'exercises' else '[]'::jsonb end
      )
    loop
      v_exercise_number := v_exercise_number + 1;

      select value into v_decision
      from jsonb_array_elements(v_decisions)
      where (value->>'exercise_number')::int = v_exercise_number
      limit 1;

      if v_decision is null then
        raise exception 'exercise_geogebra_plan : décision manquante pour l’exercice %', v_exercise_number;
      end if;

      -- Statement and correction are independent channels.
      for v_channel in
        select value
        from jsonb_array_elements(
          jsonb_build_array(
            jsonb_build_object(
              'kind','statement',
              'decision',coalesce(v_decision->'statement','{}'::jsonb),
              'graphs',coalesce(v_ex->'statement_graphs','[]'::jsonb)
            ),
            jsonb_build_object(
              'kind','correction',
              'decision',coalesce(v_decision->'correction','{}'::jsonb),
              'graphs',
                case
                  when jsonb_typeof(v_ex->'correction_graphs')='array'
                    then v_ex->'correction_graphs'
                  else
                    coalesce(
                      (
                        select c.value->'graphs'
                        from jsonb_array_elements(
                          case when jsonb_typeof(v_content->'corrections')='array'
                               then v_content->'corrections' else '[]'::jsonb end
                        ) c
                        where (c.value->>'exercise_number')::int = v_exercise_number
                        limit 1
                      ),
                      '[]'::jsonb
                    )
                end
            )
          )
        )
      loop
        v_choice := lower(trim(coalesce(v_channel->'decision'->>'decision','')));
        v_graphs := coalesce(v_channel->'graphs','[]'::jsonb);

        if v_choice not in ('build','not_needed') then
          raise exception 'Exercice % : décision GeoGebra % doit être build ou not_needed', v_exercise_number, v_channel->>'kind';
        end if;

        if jsonb_typeof(v_graphs) <> 'array' then
          raise exception 'Exercice % : %_graphs doit être un tableau', v_exercise_number, v_channel->>'kind';
        end if;

        if v_choice = 'not_needed' then
          if jsonb_array_length(v_graphs) > 0 then
            raise exception 'Exercice % : % ne peut pas contenir de graphique avec not_needed', v_exercise_number, v_channel->>'kind';
          end if;
          if length(trim(coalesce(v_channel->'decision'->>'rationale',''))) < 8 then
            raise exception 'Exercice % : rationale obligatoire pour %/not_needed', v_exercise_number, v_channel->>'kind';
          end if;
          continue;
        end if;

        v_graph_ids := v_channel->'decision'->'graph_ids';
        if jsonb_typeof(v_graph_ids) <> 'array'
           or jsonb_array_length(v_graph_ids) < 1 then
          raise exception 'Exercice % : build exige au moins un graph_id pour %', v_exercise_number, v_channel->>'kind';
        end if;

        if jsonb_array_length(v_graph_ids) <> jsonb_array_length(v_graphs) then
          raise exception 'Exercice % : les graph_ids de % doivent couvrir exactement les graphiques du document', v_exercise_number, v_channel->>'kind';
        end if;

        for v_graph in select value from jsonb_array_elements(v_graphs) loop
          if jsonb_typeof(v_graph) <> 'object' then
            raise exception 'Exercice % : graphique GeoGebra invalide dans %', v_exercise_number, v_channel->>'kind';
          end if;

          v_id := trim(coalesce(v_graph->>'id',''));
          if v_id='' then
            raise exception 'Exercice % : chaque graphique GeoGebra doit avoir un id stable', v_exercise_number;
          end if;

          if v_id = any(v_seen_ids) then
            raise exception 'graph_id GeoGebra dupliqué : %', v_id;
          end if;
          v_seen_ids := array_append(v_seen_ids,v_id);

          if length(trim(coalesce(v_graph->>'title',v_graph->>'name',''))) < 1
             or length(trim(coalesce(v_graph->>'purpose',''))) < 3 then
            raise exception 'Graphique % : title/name et purpose sont obligatoires', v_id;
          end if;

          v_instrument := lower(trim(coalesce(v_graph->>'instrument',v_graph->>'graph_type','')));
          if v_instrument in ('function','graph','courbe') then v_instrument := 'function2d'; end if;
          if v_instrument='parametric' then v_instrument := 'parametric2d'; end if;
          if v_instrument in ('vector2d','plan2d') then v_instrument := 'geometry2d'; end if;
          if v_instrument in ('geometrie3d','3d') then v_instrument := 'geometry3d'; end if;

          if v_instrument not in ('function2d','complex_plane','parametric2d','parametric3d','surface3d','geometry2d','geometry3d') then
            raise exception 'Graphique % : instrument GeoGebra non supporté (%)', v_id, v_instrument;
          end if;

          if v_instrument in ('function2d','complex_plane') then
            if length(trim(coalesce(v_graph->>'expression',''))) = 0
               and coalesce(jsonb_array_length(v_graph->'points'),0) = 0
               and coalesce(jsonb_array_length(v_graph->'asymptotes'),0) = 0 then
              raise exception 'Graphique % : expression, points ou asymptotes nécessaires', v_id;
            end if;
          elsif v_instrument='parametric2d' then
            if length(trim(coalesce(v_graph->>'x_expression',''))) = 0
               or length(trim(coalesce(v_graph->>'y_expression',''))) = 0 then
              raise exception 'Graphique % : x_expression et y_expression requis', v_id;
            end if;
          elsif v_instrument='parametric3d' then
            if length(trim(coalesce(v_graph->>'x_expression',''))) = 0
               or length(trim(coalesce(v_graph->>'y_expression',''))) = 0
               or length(trim(coalesce(v_graph->>'z_expression',''))) = 0 then
              raise exception 'Graphique % : x_expression, y_expression et z_expression requis', v_id;
            end if;
          elsif v_instrument='surface3d' then
            if length(trim(coalesce(v_graph->>'expression',''))) = 0 then
              raise exception 'Graphique % : expression requise pour surface3d', v_id;
            end if;
          elsif v_instrument='geometry2d' then
            if coalesce(jsonb_array_length(v_graph->'objects'),0) = 0
               and coalesce(jsonb_array_length(v_graph->'points'),0) = 0 then
              raise exception 'Graphique % : objects ou points requis pour geometry2d', v_id;
            end if;
          elsif v_instrument='geometry3d' then
            if coalesce(jsonb_array_length(v_graph->'objects'),0) = 0
               and coalesce(jsonb_array_length(v_graph->'points'),0) = 0
               and coalesce(jsonb_array_length(v_graph->'points_of_interest'),0) = 0 then
              raise exception 'Graphique % : objects, points ou points_of_interest requis pour geometry3d', v_id;
            end if;
          end if;

          v_graph_count := v_graph_count + 1;
        end loop;

        for v_id in select jsonb_array_elements_text(v_graph_ids) loop
          if v_id = any(v_referenced_ids) then
            raise exception 'graph_id % référencé plusieurs fois dans exercise_geogebra_plan', v_id;
          end if;

          if not exists (
            select 1
            from jsonb_array_elements(v_graphs) g
            where trim(coalesce(g->>'id','')) = trim(v_id)
          ) then
            raise exception 'Exercice % : graph_id % introuvable dans les graphiques de %', v_exercise_number, v_id, v_channel->>'kind';
          end if;

          v_referenced_ids := array_append(v_referenced_ids,trim(v_id));
        end loop;
      end loop;
    end loop;
  end loop;

  if v_graph_count > 24 then
    raise exception 'Série d’exercices : maximum 24 constructions GeoGebra par document';
  end if;

  return new;
end;
$function$


drop trigger if exists aurora_generated_documents_exercise_geogebra_plan
on public.aurora_generated_documents;

create trigger aurora_generated_documents_exercise_geogebra_plan
before insert or update of subject, document_type, content_json, metadata
on public.aurora_generated_documents
for each row execute function public.aurora_enforce_exercise_geogebra_plan();
