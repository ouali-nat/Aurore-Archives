-- Aurore Archives: hard gate for graphics when D deposits content into the pending-PDF queue.
-- Prevents malformed GeoGebra function2d definitions from reaching GitHub/GeoGebra.
-- In particular: free parameters such as C*exp(-x) and undefined functions such as F(x)
-- are rejected unless explicitly declared in the same graph.

create or replace function public.aurora_graphics_preflight(p_content_json jsonb)
returns jsonb
language plpgsql
stable
set search_path='public','pg_temp'
as $function$
declare
  v_sections jsonb := coalesce(p_content_json->'sections','[]'::jsonb);
  v_section jsonb;
  v_graph jsonb;
  v_exercise jsonb;
  v_correction jsonb;
  v_graphs jsonb;
  v_graph_idx int := 0;
  v_section_idx int := 0;
  v_graph_id text;
  v_instrument text;
  v_expression text;
  v_named text;
  v_body text;
  v_match text[];
  v_token text;
  v_fn text;
  v_param text;
  v_known_functions constant text[] := array[
    'abs','acos','asin','atan','cos','cosh','cot','coth','csc','exp',
    'floor','ceil','if','integral','ln','log','max','min','mod','nroot',
    'round','sec','sech','sgn','sin','sinh','sqrt','sum','tan','tanh',
    'derivative','function','sequence','zip','length','element','first',
    'last','random','randombetween','countif'
  ];
  v_known_constants constant text[] := array['e','pi','i'];
  v_defined_functions text[] := array[]::text[];
  v_declared_parameters text[] := array[]::text[];
  v_failures text[] := array[]::text[];
  v_parameters jsonb;
  v_companions jsonb;
  v_companion text;
  v_definition text[];
begin
  if p_content_json is null or jsonb_typeof(p_content_json) <> 'object' then
    return jsonb_build_object(
      'status','blocked',
      'contract_version','graphics-preflight-1',
      'failures',jsonb_build_array('content_json doit être un objet JSON.')
    );
  end if;

  -- Validate ordinary section-level GeoGebra graphs.
  for v_section, v_section_idx in
    select value, ordinality::int
    from jsonb_array_elements(v_sections) with ordinality
  loop
    v_graphs := case
      when jsonb_typeof(v_section->'graphs')='array' then v_section->'graphs'
      else '[]'::jsonb
    end;

    for v_graph, v_graph_idx in
      select value, ordinality::int
      from jsonb_array_elements(v_graphs) with ordinality
    loop
      v_graph_id := trim(coalesce(v_graph->>'id','section-'||v_section_idx||'-graph-'||v_graph_idx));
      v_instrument := lower(trim(coalesce(v_graph->>'instrument',v_graph->>'graph_type','')));

      if v_instrument in ('function','graph','courbe') then
        v_instrument := 'function2d';
      end if;

      if v_instrument = 'function2d' then
        v_expression := trim(coalesce(v_graph->>'expression',''));
        v_parameters := coalesce(v_graph->'parameters','{}'::jsonb);
        v_companions := coalesce(v_graph->'companion_expressions','[]'::jsonb);
        v_defined_functions := array[]::text[];
        v_declared_parameters := array[]::text[];

        -- Explicit parameter declaration: object keys or [{name: ...}, ...].
        if jsonb_typeof(v_parameters)='object' then
          select coalesce(array_agg(key),array[]::text[])
            into v_declared_parameters
            from jsonb_object_keys(v_parameters) key;
        elsif jsonb_typeof(v_parameters)='array' then
          select coalesce(array_agg(trim(value->>'name')),array[]::text[])
            into v_declared_parameters
            from jsonb_array_elements(v_parameters) value
           where jsonb_typeof(value)='object'
             and trim(coalesce(value->>'name','')) <> '';
        end if;

        -- Named functions declared by the main expression and companion expressions.
        if v_expression ~* '^[[:space:]]*[A-Za-z][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*[A-Za-z][A-Za-z0-9_]*[[:space:]]*\)[[:space:]]*=' then
          v_match := regexp_match(v_expression, '^[[:space:]]*([A-Za-z][A-Za-z0-9_]*)[[:space:]]*\(');
          if v_match is not null then
            v_defined_functions := array_append(v_defined_functions, lower(v_match[1]));
          end if;
        end if;

        if jsonb_typeof(v_companions)='array' then
          for v_companion in select jsonb_array_elements_text(v_companions) loop
            if v_companion ~* '^[[:space:]]*[A-Za-z][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*[A-Za-z][A-Za-z0-9_]*[[:space:]]*\)[[:space:]]*=' then
              v_match := regexp_match(v_companion, '^[[:space:]]*([A-Za-z][A-Za-z0-9_]*)[[:space:]]*\(');
              if v_match is not null then
                v_defined_functions := array_append(v_defined_functions, lower(v_match[1]));
              end if;
            end if;
          end loop;
        end if;

        if v_expression = '' then
          v_failures := array_append(v_failures, format(
            'GRAPH-001 [%s] : expression function2d obligatoire.', v_graph_id));
        else
          -- Strip a possible function name and argument before token analysis.
          v_body := regexp_replace(
            v_expression,
            '^[[:space:]]*[A-Za-z][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*[A-Za-z][A-Za-z0-9_]*[[:space:]]*\)[[:space:]]*=[[:space:]]*',
            '',
            'i'
          );

          -- Every call-shaped identifier must be a GeoGebra built-in or explicitly defined.
          for v_fn in
            select distinct lower(m[1])
            from regexp_matches(v_body, '([A-Za-z][A-Za-z0-9_]*)[[:space:]]*\(', 'g') m
          loop
            if not (v_fn = any(v_known_functions))
               and not (v_fn = any(v_defined_functions)) then
              v_failures := array_append(v_failures, format(
                'GRAPH-002 [%s] : fonction "%s" utilisée mais non définie dans ce graphique.',
                v_graph_id, v_fn));
            end if;
          end loop;

          -- Any identifier other than x/t, known functions/constants, declared parameters,
          -- or explicitly defined functions is forbidden.
          for v_token in
            select distinct m[1]
            from regexp_matches(v_body, '([A-Za-z][A-Za-z0-9_]*)', 'g') m
          loop
            if lower(v_token) in ('x','t')
               or lower(v_token) = any(v_known_functions)
               or lower(v_token) = any(v_known_constants)
               or lower(v_token) = any(v_defined_functions)
               or v_token = any(v_declared_parameters)
               or lower(v_token) = any(v_declared_parameters) then
              continue;
            end if;

            -- Operators/known GeoGebra words are not identifiers needing declaration.
            if lower(v_token) in ('and','or','not') then
              continue;
            end if;

            v_failures := array_append(v_failures, format(
              'GRAPH-003 [%s] : identifiant "%s" non déclaré. Déclarez-le dans parameters ou définissez la fonction dans ce graphe.',
              v_graph_id, v_token));
          end loop;
        end if;

        -- Validate the declared parameters themselves.
        foreach v_param in array v_declared_parameters loop
          if v_param !~ '^[A-Za-z][A-Za-z0-9_]*$' then
            v_failures := array_append(v_failures, format(
              'GRAPH-004 [%s] : paramètre "%s" invalide.', v_graph_id, v_param));
          end if;
        end loop;
      end if;

      -- Generic construction fields must not be empty for the instruments that require them.
      if v_instrument='parametric2d' then
        if nullif(trim(v_graph->>'expression'),'') is null
           or trim(v_graph->>'expression') !~* '^Curve\\s*\\(' then
          v_failures := array_append(v_failures, format(
            'GRAPH-005 [%s] : construction parametric2d invalide : Curve(x,y,t,a,b) attendue.', v_graph_id));
        end if;
      elsif v_instrument='parametric3d' then
        if nullif(trim(v_graph->>'expression'),'') is null
           or trim(v_graph->>'expression') !~* '^Curve\\s*\\(' then
          v_failures := array_append(v_failures, format(
            'GRAPH-006 [%s] : construction parametric3d invalide : Curve(x,y,z,t,a,b) attendue.', v_graph_id));
        end if;
      elsif v_instrument='surface3d' then
        if nullif(trim(v_graph->>'expression'),'') is null then
          v_failures := array_append(v_failures, format(
            'GRAPH-007 [%s] : expression surface3d manquante.', v_graph_id));
        end if;
      end if;
    end loop;

    -- Exercise graphs live outside section.graphs.
    if jsonb_typeof(v_section->'exercises')='array' then
      for v_exercise in select jsonb_array_elements(v_section->'exercises') loop
        for v_graphs in
          select value
          from (
            select coalesce(v_exercise->'statement_graphs','[]'::jsonb) value
            union all
            select coalesce(v_exercise->'correction_graphs','[]'::jsonb) value
          ) q
        loop
          for v_graph, v_graph_idx in
            select value, ordinality::int
            from jsonb_array_elements(v_graphs) with ordinality
          loop
            v_graph_id := trim(coalesce(v_graph->>'id','exercise-'||v_section_idx||'-'||v_graph_idx));
            v_instrument := lower(trim(coalesce(v_graph->>'instrument',v_graph->>'graph_type','')));
            if v_instrument in ('function','graph','courbe') then v_instrument := 'function2d'; end if;
            if v_instrument='function2d' and nullif(trim(v_graph->>'expression'),'') is null then
              v_failures := array_append(v_failures, format(
                'GRAPH-009 [%s] : expression function2d manquante.', v_graph_id));
            end if;
          end loop;
        end loop;

        if jsonb_typeof(v_exercise->'correction_graphs')='array' then
          -- handled above
          null;
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_section->'corrections')='array' then
      for v_correction in select jsonb_array_elements(v_section->'corrections') loop
        if jsonb_typeof(v_correction->'graphs')='array' then
          for v_graph in select jsonb_array_elements(v_correction->'graphs') loop
            v_graph_id := trim(coalesce(v_graph->>'id','correction-'||v_section_idx));
            v_instrument := lower(trim(coalesce(v_graph->>'instrument',v_graph->>'graph_type','')));
            if v_instrument in ('function','graph','courbe') then v_instrument := 'function2d'; end if;
            if v_instrument='function2d' and nullif(trim(v_graph->>'expression'),'') is null then
              v_failures := array_append(v_failures, format(
                'GRAPH-008 [%s] : expression function2d manquante.', v_graph_id));
            end if;
          end loop;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when cardinality(v_failures)=0 then 'pass' else 'blocked' end,
    'contract_version','graphics-preflight-1',
    'failures', to_jsonb(v_failures)
  );
end;
$function$;

-- Run the graphics preflight for every newly ingested editorial document before
-- it can become visible as "documents en attente".
create or replace function public.aurora_enforce_graphics_preflight()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $function$
declare
  v_report jsonb;
begin
  if lower(coalesce(new.metadata->>'origin','')) <> 'gpt_editorial_ingest' then
    return new;
  end if;

  if tg_op='UPDATE'
     and new.content_json is not distinct from old.content_json then
    return new;
  end if;

  v_report := public.aurora_graphics_preflight(new.content_json);

  if v_report->>'status' <> 'pass' then
    raise exception 'Garde-fou graphiques Aurore bloqué : %', coalesce(v_report->>'failures','[]');
  end if;

  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'graphics_preflight',
      v_report || jsonb_build_object('checked_at',now())
    );

  return new;
end;
$function$;

drop trigger if exists aurora_generated_documents_graphics_preflight
  on public.aurora_generated_documents;

create trigger aurora_generated_documents_graphics_preflight
before insert or update of content_json on public.aurora_generated_documents
for each row
execute function public.aurora_enforce_graphics_preflight();

insert into public.aurora_editorial_memory
  (rule_key,version,title,priority,mandatory,active,content)
values
  (
    'graphics_preflight_d_to_pending',
    1,
    'Garde-fou graphique D → Documents en attente',
    2300,
    true,
    true,
    jsonb_build_object(
      'scope','Toute production éditoriale ChatGPT déposée dans Documents en attente.',
      'hard_gate',true,
      'contract_version','graphics-preflight-1',
      'function2d','Toute fonction doit utiliser uniquement x/t, fonctions GeoGebra natives, constantes connues, paramètres explicitement déclarés ou fonctions explicitement définies dans le même graphe.',
      'forbidden_examples',jsonb_build_array(
        'C*exp(-x) sans déclaration de C',
        'F(x) sans définition de F'
      ),
      'required_examples',jsonb_build_array(
        'parameters: {"C":1} avec C*exp(-x)',
        'companion_expressions: ["F(x)=x^2"] avec F(x)'
      ),
      'failure_policy','Le document reste hors du sas Documents en attente. Aucune production PDF ne doit être lancée.',
      'no_fallback','Ne jamais remplacer une expression invalide par une courbe arbitraire ou une expression inventée.'
    )
  )
on conflict (rule_key,version) do update
set title=excluded.title,
    priority=excluded.priority,
    mandatory=excluded.mandatory,
    active=true,
    content=excluded.content,
    updated_at=now();
