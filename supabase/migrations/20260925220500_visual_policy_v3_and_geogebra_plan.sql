-- Aurore Archives: cross-subject visual policy and GeoGebra plan
-- Applied to Supabase as visual_policy_v3_and_geogebra_plan.

select setval('public.aurora_editorial_memory_id_seq', (select max(id) from public.aurora_editorial_memory));

update public.aurora_editorial_memory
set active=false, updated_at=now()
where rule_key='visual_graph_policy' and active=true;

insert into public.aurora_editorial_memory
(id, rule_key, version, title, priority, mandatory, active, content)
values
(
  13,
  'visual_graph_policy',
  3,
  'Politique visuelle transversale : documentaire + GeoGebra',
  990,
  true,
  true,
  '{
    "general_rule": "Avant de rédiger un cours, analyser chaque section selon son besoin visuel réel. Deux branches indépendantes peuvent être utilisées ensemble : Wikimedia pour les contenus documentaires, réels ou contextuels ; GeoGebra pour les représentations mathématiques, géométriques, quantitatives, dynamiques ou scientifiques.",
    "documentary_branch": {
      "source": "Wikimedia Commons",
      "applies_to": "cours non mathématiques",
      "schema_version": "documentary-visual-plan-1",
      "location": "content_json.visual_plan",
      "decision_per_section": "build ou not_needed",
      "required_per_course": true,
      "max_per_section": 3,
      "max_per_document": 8,
      "allowed_purposes": ["illustration","schema","photo","experimental","comparison"],
      "rule": "Une illustration documentaire doit apporter une information utile à la compréhension, au contexte ou à l observation ; jamais de quota artificiel."
    },
    "geogebra_branch": {
      "scope": "toutes les matières lorsque la représentation est mathématique, géométrique, quantitative, dynamique ou scientifique",
      "not_math_only": true,
      "schema_version": "geogebra-visual-plan-1",
      "location": "content_json.geogebra_plan",
      "decision_per_section": "build ou not_needed",
      "max_per_document": 24,
      "principle": "GeoGebra n est pas limité aux mathématiques. Un cours de physique peut et doit l utiliser lorsque les vecteurs, forces, trajectoires, graphes x(t)/v(t)/a(t), oscillations, optique géométrique ou autres relations scientifiques gagnent à être représentés.",
      "physics_examples": [
        "vecteurs de forces et résultantes",
        "mouvement : position, vitesse et accélération en fonction du temps",
        "trajectoires et mouvements 2D/3D",
        "oscillations et systèmes masse-ressort",
        "optique géométrique et rayons",
        "champs et représentations quantitatives"
      ],
      "supported_instruments": ["function2d","complex_plane","parametric2d","parametric3d","surface3d","geometry2d","geometry3d"],
      "geometry2d_use": "points, vecteurs, droites, segments, rayons et polygones, notamment pour les schémas vectoriels de physique",
      "quality": "Construction exacte à partir des données du document, axes et fenêtre adaptés, lignes sobres, couleur uniquement lorsqu elle porte une information scientifique, aucun objet décoratif."
    },
    "combination_rule": "Wikimedia et GeoGebra sont indépendants et combinables dans un même cours. Par exemple, un cours de physique peut contenir une photographie documentaire d un dispositif et une construction GeoGebra de son modèle ou de ses mesures.",
    "quality_gate": [
      "Chaque section reçoit une décision explicite pour la branche visuelle concernée.",
      "Aucune image ou construction ne doit être ajoutée pour remplir un quota.",
      "Chaque visuel demandé doit être récupéré ou construit, validé puis effectivement inséré dans le PDF.",
      "Les identifiants doivent rester stables entre plan, section, asset et rendu final."
    ]
  }'::jsonb
);

insert into public.aurora_editorial_memory
(id, rule_key, version, title, priority, mandatory, active, content)
values
(
  14,
  'geogebra_visual_policy',
  1,
  'GeoGebra transversal aux sciences et aux mathématiques',
  985,
  true,
  true,
  '{
    "purpose": "Déterminer quand une représentation GeoGebra est pédagogiquement nécessaire, sans la limiter à la matière Mathématiques.",
    "trigger": [
      "représentation de fonction ou courbe",
      "vecteur ou somme vectorielle",
      "géométrie plane ou spatiale",
      "trajectoire",
      "graphe d une grandeur physique",
      "relation quantitative",
      "phénomène dynamique",
      "construction scientifique calculable"
    ],
    "physics": {
      "must_consider": true,
      "examples": ["forces","résultante","mouvement","trajectoire","x(t)","v(t)","a(t)","oscillations","optique","champs"]
    },
    "contract": {
      "schema_version": "geogebra-visual-plan-1",
      "location": "content_json.geogebra_plan",
      "decision_fields": ["section_number","decision","rationale","graph_ids"],
      "graph_requires": ["id","title ou name","purpose","instrument","construction data"],
      "decision_rule": "build exige tous les graph_ids de la section ; not_needed exige une justification pédagogique.",
      "no_decorative_graphs": true
    },
    "independence": "Le plan GeoGebra ne remplace pas le plan documentaire Wikimedia ; les deux peuvent exister simultanément dans une même section ou un même cours."
  }'::jsonb
);

select setval('public.aurora_editorial_memory_id_seq', (select max(id) from public.aurora_editorial_memory));

create or replace function public.aurora_enforce_geogebra_visual_plan()
returns trigger
language plpgsql
set search_path=public, pg_temp
as $$
declare
  v_subject text := lower(coalesce(new.subject,''));
  v_document_type text := lower(coalesce(new.document_type,''));
  v_origin text := lower(coalesce(new.metadata->>'origin',''));
  v_content jsonb := coalesce(new.content_json,'{}'::jsonb);
  v_plan jsonb;
  v_decisions jsonb;
  v_section jsonb;
  v_decision jsonb;
  v_graph jsonb;
  v_graph_ids jsonb;
  v_idx int;
  v_id text;
  v_choice text;
  v_instrument text;
  v_graph_count int := 0;
  v_seen_ids text[] := array[]::text[];
  v_referenced_ids text[] := array[]::text[];
begin
  if v_document_type !~ 'cours'
     or v_document_type ~ 'exercice|devoir|corrig'
     or v_subject ~ 'math'
     or v_origin <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if jsonb_typeof(v_content->'sections') <> 'array' then
    return new;
  end if;

  for v_section in select value from jsonb_array_elements(v_content->'sections') loop
    if jsonb_typeof(v_section->'graphs') = 'array' then
      v_graph_count := v_graph_count + jsonb_array_length(v_section->'graphs');
    end if;
  end loop;

  if v_graph_count = 0 then
    return new;
  end if;

  if v_graph_count > 24 then
    raise exception 'Cours avec GeoGebra : maximum 24 graphiques/constructions par document';
  end if;

  v_plan := coalesce(
    v_content->'geogebra_plan',
    case when jsonb_typeof(v_content->'metadata') = 'object'
      then v_content->'metadata'->'geogebra_plan'
      else null end
  );

  if jsonb_typeof(v_plan) <> 'object' then
    raise exception 'Cours non mathématique avec GeoGebra : geogebra_plan obligatoire';
  end if;

  if coalesce(v_plan->>'schema_version','') <> 'geogebra-visual-plan-1' then
    raise exception 'Cours avec GeoGebra : geogebra_plan.schema_version doit être geogebra-visual-plan-1';
  end if;

  if jsonb_typeof(v_plan->'decisions') <> 'array'
     or jsonb_array_length(v_plan->'decisions') <> jsonb_array_length(v_content->'sections') then
    raise exception 'Cours avec GeoGebra : une décision GeoGebra est requise pour chaque section';
  end if;

  v_decisions := v_plan->'decisions';

  for v_idx in 0..jsonb_array_length(v_content->'sections')-1 loop
    v_section := v_content->'sections'->v_idx;
    v_decision := null;

    for v_decision in select value from jsonb_array_elements(v_decisions) loop
      if coalesce(v_decision->>'section_number','') ~ '^[0-9]+$'
         and (v_decision->>'section_number')::int = v_idx+1 then
        exit;
      end if;
      v_decision := null;
    end loop;

    if v_decision is null then
      raise exception 'Cours avec GeoGebra : décision manquante pour la section %', v_idx+1;
    end if;

    v_choice := lower(trim(coalesce(v_decision->>'decision','')));
    if v_choice not in ('build','not_needed') then
      raise exception 'Section % : décision GeoGebra doit être build ou not_needed', v_idx+1;
    end if;

    if jsonb_typeof(v_section->'graphs') is null then
      v_section := jsonb_set(v_section,'{graphs}','[]'::jsonb);
    end if;

    if jsonb_typeof(v_section->'graphs') <> 'array' then
      raise exception 'Section % : graphs doit être un tableau', v_idx+1;
    end if;

    if v_choice='not_needed' then
      if jsonb_array_length(v_section->'graphs') > 0 then
        raise exception 'Section % : not_needed ne peut pas contenir de graphique GeoGebra', v_idx+1;
      end if;
      if length(trim(coalesce(v_decision->>'rationale',''))) < 8 then
        raise exception 'Section % : rationale obligatoire pour not_needed', v_idx+1;
      end if;
      continue;
    end if;

    v_graph_ids := v_decision->'graph_ids';
    if jsonb_typeof(v_graph_ids) <> 'array'
       or jsonb_array_length(v_graph_ids) < 1 then
      raise exception 'Section % : build exige au moins un graph_id', v_idx+1;
    end if;

    if jsonb_array_length(v_graph_ids) <> jsonb_array_length(v_section->'graphs') then
      raise exception 'Section % : les graph_ids doivent couvrir exactement les graphiques de la section', v_idx+1;
    end if;

    for v_graph in select value from jsonb_array_elements(v_section->'graphs') loop
      if jsonb_typeof(v_graph) <> 'object' then
        raise exception 'Section % : graphique GeoGebra invalide', v_idx+1;
      end if;

      v_id := trim(coalesce(v_graph->>'id',''));
      if v_id='' then
        raise exception 'Section % : chaque graphique GeoGebra doit avoir un id stable', v_idx+1;
      end if;
      if v_id = any(v_seen_ids) then
        raise exception 'graph_id dupliqué : %', v_id;
      end if;
      v_seen_ids := array_append(v_seen_ids,v_id);

      if length(trim(coalesce(v_graph->>'title',v_graph->>'name',''))) < 1
         or length(trim(coalesce(v_graph->>'purpose',''))) < 3 then
        raise exception 'Graphique % : title/name et purpose sont obligatoires', v_id;
      end if;

      v_instrument := lower(trim(coalesce(v_graph->>'instrument',v_graph->>'graph_type','')));
      if v_instrument in ('function','graph','courbe') then v_instrument := 'function2d'; end if;
      if v_instrument='parametric' then v_instrument := 'parametric2d'; end if;
      if v_instrument in ('geometrie3d','3d') then v_instrument := 'geometry3d'; end if;
      if v_instrument in ('vector2d','plan2d') then v_instrument := 'geometry2d'; end if;

      if v_instrument not in ('function2d','complex_plane','parametric2d','parametric3d','surface3d','geometry2d','geometry3d') then
        raise exception 'Graphique % : instrument GeoGebra non supporté (%)', v_id, v_instrument;
      end if;

      if v_instrument in ('function2d','complex_plane') then
        if length(trim(coalesce(v_graph->>'expression',''))) = 0
           and coalesce(jsonb_array_length(v_graph->'points'),0) = 0
           and coalesce(jsonb_array_length(v_graph->'asymptotes'),0) = 0 then
          raise exception 'Graphique % : construction 2D insuffisante', v_id;
        end if;
      elsif v_instrument='parametric2d' then
        if length(trim(coalesce(v_graph->>'x_expression',''))) = 0
           or length(trim(coalesce(v_graph->>'y_expression',''))) = 0 then
          raise exception 'Graphique % : x_expression et y_expression sont requis', v_id;
        end if;
      elsif v_instrument='parametric3d' then
        if length(trim(coalesce(v_graph->>'x_expression',''))) = 0
           or length(trim(coalesce(v_graph->>'y_expression',''))) = 0
           or length(trim(coalesce(v_graph->'z_expression',''))) = 0 then
          raise exception 'Graphique % : x_expression, y_expression et z_expression sont requis', v_id;
        end if;
      elsif v_instrument='surface3d' then
        if length(trim(coalesce(v_graph->>'expression',''))) = 0 then
          raise exception 'Graphique % : expression requise pour surface3d', v_id;
        end if;
      elsif v_instrument='geometry2d' then
        if coalesce(jsonb_array_length(v_graph->'objects'),0) = 0
           and coalesce(jsonb_array_length(v_graph->'points'),0) = 0 then
          raise exception 'Graphique % : objets ou points 2D requis pour geometry2d', v_id;
        end if;
      elsif v_instrument='geometry3d' then
        if coalesce(jsonb_array_length(v_graph->'objects'),0) = 0
           and coalesce(jsonb_array_length(v_graph->'points'),0) = 0
           and coalesce(jsonb_array_length(v_graph->'points_of_interest'),0) = 0 then
          raise exception 'Graphique % : objets ou points 3D requis pour geometry3d', v_id;
        end if;
      end if;
    end loop;

    for v_id in select jsonb_array_elements_text(v_graph_ids) loop
      if v_id = any(v_referenced_ids) then
        raise exception 'graph_id % est référencé plusieurs fois dans geogebra_plan', v_id;
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_section->'graphs') g
        where trim(coalesce(g->>'id','')) = v_id
      ) then
        raise exception 'Section % : graph_id % introuvable dans sa section', v_idx+1, v_id;
      end if;
      v_referenced_ids := array_append(v_referenced_ids,v_id);
    end loop;
  end loop;

  for v_id in select unnest(v_seen_ids) loop
    if not (v_id = any(v_referenced_ids)) then
      raise exception 'Graphique % : présent dans le document mais absent de geogebra_plan', v_id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists aurora_generated_documents_geogebra_visual_plan
on public.aurora_generated_documents;

create trigger aurora_generated_documents_geogebra_visual_plan
before insert or update of subject, document_type, content_json, metadata
on public.aurora_generated_documents
for each row
execute function public.aurora_enforce_geogebra_visual_plan();
