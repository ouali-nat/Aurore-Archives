-- Exercise-series visual guard refinement
-- Statement: AI may choose whether a graph is useful.
-- Scientific correction: a GeoGebra graph is required unless the AI supplies
-- a sufficiently developed and discipline-specific justification for its absence.
create or replace function public.aurora_scientific_preflight(
  p_subject text, p_document_type text, p_content_json jsonb, p_level text, p_class_name text, p_research jsonb
) returns jsonb language plpgsql stable set search_path to 'public','pg_temp' as $function$
declare
  s text:=lower(coalesce(p_subject,'')); l text:=lower(coalesce(p_level,'')); c text:=lower(coalesce(p_class_name,''));
  raw text:=coalesce(p_content_json::text,'');
  scientific boolean:=s~'math|physique|chimie|sciences[[:space:]-]*physiques|(^|[[:space:]])pc([[:space:]]|$)|biolog|svt|statist|scien';
  maternelle boolean:=l~'maternelle' or c~'maternelle';
  primary_level boolean:=l~'primaire|elementaire|élémentaire' or c~'(^|[[:space:]-])(cp|ce1|ce2|cm1|cm2)([[:space:]-]|$)';
  college boolean:=l~'college|collège|post[[:space:]-]*primaire' or c~'(^|[[:space:]-])(6e|5e|4e|3e|6eme|5eme|4eme|3eme|6ème|5ème|4ème|3ème)([[:space:]-]|$)';
  lycee boolean:=l~'lycee|lycée|secondaire.*2nd|secondaire.*cycle' or c~'seconde|2nde|2de|premiere|première|1ere|1re|terminale|tle';
  higher boolean:=l~'univers|superieur|supérieur|licence|master|doctor|bts|dut|deug|ingenieur|ingénieur|formation[[:space:]-]*professionnelle' or c~'licence|master|doctor|bts|dut|deug|ingenieur|ingénieur';
  minlatex int:=0; latex_count int:=0; graph_count int:=0; correction_graph_count int:=0;
  exercise_count int:=0; correction_justified_without_graph int:=0; correction_missing_graph int:=0;
  source_sites int:=0; implications int:=0; connector_implications int:=0; max_implications int:=0; min_implications int:=1;
  failures text[]:=array[]::text[]; base jsonb; research jsonb:=coalesce(p_research,'{}'::jsonb);
  is_exercise_document boolean := lower(coalesce(p_document_type,'')) ~ 'exercice|devoir|corrig';
  sec jsonb; ex jsonb; rationale text; correction_graphs jsonb; v_plan jsonb; v_decisions jsonb; ex_num int;
begin
  if p_content_json is null or jsonb_typeof(p_content_json)<>'object' then
    return jsonb_build_object('status','blocked','contract_version','scientific-preflight-4','failures',jsonb_build_array('content_json doit être un objet JSON.'));
  end if;
  if not scientific or maternelle then
    return jsonb_build_object('status','pass','contract_version','scientific-preflight-4','scope',case when maternelle then 'maternelle-exempt' else 'non-scientific' end,'metrics',jsonb_build_object('latex_conversion_elements',public.aurora_count_scientific_latex_elements(p_content_json),'geogebra_graphs',0,'correction_geogebra_graphs',0,'implication_count',0));
  end if;
  if primary_level then minlatex:=400; elsif college then minlatex:=500; elsif lycee or higher then minlatex:=1200; else minlatex:=1200; end if;
  latex_count:=public.aurora_count_scientific_latex_elements(p_content_json);
  base:=public.aurora_scientific_preflight(p_subject,p_document_type,p_content_json);
  if jsonb_typeof(base->'failures')='array' then select coalesce(array_agg(value::text),array[]::text[]) into failures from jsonb_array_elements_text(base->'failures'); end if;
  if latex_count<minlatex then failures:=array_append(failures,format('SCI-LATEX-LEVEL : %s éléments LaTeX ; minimum %s requis pour %s.',latex_count,minlatex,coalesce(p_level,'niveau non précisé'))); end if;

  select count(*) into graph_count from (
    select g.value as graph from jsonb_array_elements(coalesce(p_content_json->'sections','[]'::jsonb)) sec_row cross join lateral jsonb_array_elements(coalesce(sec_row->'graphs','[]'::jsonb)) g
    union all
    select g.value from jsonb_array_elements(coalesce(p_content_json->'sections','[]'::jsonb)) sec_row cross join lateral jsonb_array_elements(coalesce(sec_row->'exercises','[]'::jsonb)) ex_row cross join lateral jsonb_array_elements(coalesce(ex_row->'statement_graphs','[]'::jsonb) || coalesce(ex_row->'correction_graphs','[]'::jsonb)) g
  ) q
  where lower(coalesce(q.graph->>'type',''))='geogebra'
     or lower(coalesce(q.graph->>'instrument',q.graph->>'graph_type','')) in ('function2d','complex_plane','parametric2d','parametric3d','surface3d','geometry2d','geometry3d','geogebra');

  if is_exercise_document and jsonb_typeof(p_content_json->'sections')='array' then
    for sec in select value from jsonb_array_elements(p_content_json->'sections') loop
      for ex in select value from jsonb_array_elements(case when jsonb_typeof(sec->'exercises')='array' then sec->'exercises' else '[]'::jsonb end) loop
        exercise_count := exercise_count + 1;
        correction_graphs := coalesce(ex->'correction_graphs','[]'::jsonb);
        correction_graph_count := correction_graph_count + jsonb_array_length(correction_graphs);
        if jsonb_array_length(correction_graphs)=0 then
          ex_num := coalesce(nullif(ex->>'exercise_number','')::int, exercise_count);
          rationale := '';
          v_plan := coalesce(p_content_json->'exercise_geogebra_plan',case when jsonb_typeof(p_content_json->'metadata')='object' then p_content_json->'metadata'->'exercise_geogebra_plan' else null end);
          v_decisions := case when jsonb_typeof(v_plan->'decisions')='array' then v_plan->'decisions' else '[]'::jsonb end;
          select coalesce(value->'correction'->>'rationale','') into rationale
          from jsonb_array_elements(v_decisions)
          where (value->>'exercise_number') ~ '^[0-9]+$' and (value->>'exercise_number')::int = ex_num limit 1;
          rationale := trim(coalesce(rationale,''));
          if char_length(rationale) >= 160
             and rationale ~* '(calcul|alg[eè]bre|d[eé]monstr|raisonnement|g[eé]om[eé]tr|courbe|fonction|repr[eé]sentation|visuel|graphique|figure|construction|p[eé]dagog|[eé]quation|r[eé]solution|num[eé]rique|donn[eé]e|relation)'
             and rationale !~* '^(pas besoin|aucun graphique|graphique inutile|not needed|no graph)[.! ]*$'
          then
            correction_justified_without_graph := correction_justified_without_graph + 1;
          else
            correction_missing_graph := correction_missing_graph + 1;
            failures := array_append(failures,format('SCI-CORRECTION-VISUAL-001 : correction de l''exercice %s sans graphique GeoGebra. Un graphique est requis dans la correction scientifique, sauf justification disciplinaire développée (au moins 160 caractères et raison explicite).',ex_num));
          end if;
        end if;
      end loop;
    end loop;
  else
    if graph_count<2 then failures:=array_append(failures,format('SCI-GEOGEBRA-001 : %s construction(s) GeoGebra ; minimum 2 requis.',graph_count)); end if;
  end if;

  implications=(length(raw)-length(replace(raw,'\\Rightarrow','')))/length('\\Rightarrow')+(length(raw)-length(replace(raw,'\\Longrightarrow','')))/length('\\Longrightarrow')+(length(raw)-length(replace(raw,'\\implies','')))/length('\\implies')+(length(raw)-length(replace(raw,'\\Longimplies','')))/length('\\Longimplies')+(length(raw)-length(replace(raw,'⇒','')))/length('⇒')+(length(raw)-length(replace(raw,'⟹','')))/length('⟹');
  select count(*) into connector_implications from regexp_matches(raw,'(?i)\\b(?:donc|ainsi|alors|on en déduit|il s''ensuit)\\b','g');
  implications:=implications+connector_implications; max_implications:=least(100,greatest(1,ceil(latex_count*0.08)::int));
  if implications<min_implications then failures:=array_append(failures,'SCI-IMPLICATION-002 : au moins un signe d''implication LaTeX ou un connecteur de raisonnement convertible est requis.');
  elsif implications>max_implications then failures:=array_append(failures,format('SCI-IMPLICATION-001 : %s implications ; plafond %s pour %s éléments LaTeX.',implications,max_implications,latex_count)); end if;

  with urls as (
    select trim(coalesce(v->>'url',case when jsonb_typeof(v)='string' then v#>>'{}' else '' end)) url from jsonb_array_elements(case when jsonb_typeof(research->'sources')='array' then research->'sources' else '[]'::jsonb end) v
    union all select trim(coalesce(v->>'url',case when jsonb_typeof(v)='string' then v#>>'{}' else '' end)) from jsonb_array_elements(case when jsonb_typeof(research->'source_urls')='array' then research->'source_urls' else '[]'::jsonb end) v
  ), hosts as (select distinct lower(regexp_replace(regexp_replace(url,'^https?://',''),'[/?#].*$','')) host from urls where url~*'^https?://[^/]+')
  select count(*) into source_sites from hosts where host<>'' and host<>'localhost';
  if source_sites<3 then failures:=array_append(failures,format('SCI-SOURCES-001 : %s site(s) source distinct(s) ; minimum 3 requis.',source_sites)); end if;

  return jsonb_build_object('status',case when cardinality(failures)=0 then 'pass' else 'blocked' end,'contract_version','scientific-preflight-4','subject',p_subject,'level',p_level,'class_name',p_class_name,'exercise_visual_policy',case when is_exercise_document then 'statement_ai_choice_correction_required_with_justified_exception' else 'legacy_scientific_graph_minimum_2' end,'metrics',jsonb_build_object('latex_conversion_elements',latex_count,'minimum_latex_conversion_elements',minlatex,'geogebra_graphs',graph_count,'correction_geogebra_graphs',correction_graph_count,'exercise_count',exercise_count,'correction_justified_without_graph',correction_justified_without_graph,'correction_missing_graph',correction_missing_graph,'source_sites',source_sites,'implication_count',implications,'minimum_implications',min_implications,'maximum_implications',max_implications),'research_guard',jsonb_build_object('structured_trace',true,'distinct_sites_required',3),'implication_guard',jsonb_build_object('minimum_absolute',1,'maximum_absolute',100,'maximum_ratio',0.08,'paragraph_rule','inline_in_paragraph'),'exercise_graph_guard',case when is_exercise_document then jsonb_build_object('statement','ai_choice','correction','required_unless_justified','justification_min_characters',160,'justification_requires_reason',true) else '{}'::jsonb end,'failures',to_jsonb(failures));
end;
$function$;
