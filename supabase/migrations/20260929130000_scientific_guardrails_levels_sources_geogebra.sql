-- Scientific guardrails by educational level, research provenance, GeoGebra and implication density.
insert into public.aurora_editorial_memory(rule_key,version,title,priority,mandatory,active,content)
values('scientific_guardrails_by_level',1,'Garde-fous scientifiques gradués',2025,true,true,
jsonb_build_object('schema_version','scientific-guardrails-levels-1','hard_gate',true,
'levels',jsonb_build_object('maternelle',jsonb_build_object('latex_min',0,'geogebra_min',0,'source_sites_min',0),'primaire',jsonb_build_object('latex_min',400,'geogebra_min',2,'source_sites_min',3),'college',jsonb_build_object('latex_min',500,'geogebra_min',2,'source_sites_min',3),'lycee',jsonb_build_object('latex_min',1200,'geogebra_min',2,'source_sites_min',3),'superieur',jsonb_build_object('latex_min',1200,'geogebra_min',2,'source_sites_min',3)),
'implication_policy',jsonb_build_object('maximum_absolute',100,'maximum_ratio',0.08),'research_policy',jsonb_build_object('minimum_distinct_sites',3,'require_structured_trace',true,'count_domains_not_urls',true)))
on conflict(rule_key,version) do update set title=excluded.title,priority=excluded.priority,mandatory=excluded.mandatory,active=true,content=excluded.content,updated_at=now();

create or replace function public.aurora_scientific_preflight(p_subject text,p_document_type text,p_content_json jsonb,p_level text,p_class_name text,p_research jsonb)
returns jsonb language plpgsql stable set search_path='public','pg_temp' as $$
declare
 s text:=lower(coalesce(p_subject,'')); l text:=lower(coalesce(p_level,'')); c text:=lower(coalesce(p_class_name,'')); raw text:=coalesce(p_content_json::text,'');
 scientific boolean:=s~'math|physique|chimie|sciences[[:space:]-]*physiques|(^|[[:space:]])pc([[:space:]]|$)|biolog|svt|statist|scien';
 maternelle boolean:=l~'maternelle' or c~'maternelle'; primary_level boolean:=l~'primaire|elementaire|élémentaire' or c~'(^|[[:space:]-])(cp|ce1|ce2|cm1|cm2)([[:space:]-]|$)';
 college boolean:=l~'college|collège|post[[:space:]-]*primaire' or c~'(^|[[:space:]-])(6e|5e|4e|3e|6eme|5eme|4eme|3eme|6ème|5ème|4ème|3ème)([[:space:]-]|$)';
 lycee boolean:=l~'lycee|lycée|secondaire.*2nd|secondaire.*cycle' or c~'seconde|2nde|2de|premiere|première|1ere|1re|terminale|tle';
 higher boolean:=l~'univers|superieur|supérieur|licence|master|doctor|bts|dut|deug|ingenieur|ingénieur|formation[[:space:]-]*professionnelle' or c~'licence|master|doctor|bts|dut|deug|ingenieur|ingénieur';
 minlatex int:=0; latex_count int:=0; graph_count int:=0; source_sites int:=0; implications int:=0; max_implications int:=0; failures text[]:=array[]::text[]; base jsonb; research jsonb:=coalesce(p_research,'{}'::jsonb);
begin
 if p_content_json is null or jsonb_typeof(p_content_json)<>'object' then return jsonb_build_object('status','blocked','contract_version','scientific-preflight-2','failures',jsonb_build_array('content_json doit être un objet JSON.')); end if;
 if not scientific or maternelle then return jsonb_build_object('status','pass','contract_version','scientific-preflight-2','scope',case when maternelle then 'maternelle-exempt' else 'non-scientific' end,'metrics',jsonb_build_object('latex_conversion_elements',public.aurora_count_scientific_latex_elements(p_content_json),'geogebra_graphs',0,'source_sites',0,'implication_count',0)); end if;
 if primary_level then minlatex:=400; elsif college then minlatex:=500; elsif lycee or higher then minlatex:=1200; else minlatex:=1200; end if;
 latex_count:=public.aurora_count_scientific_latex_elements(p_content_json);
 base:=public.aurora_scientific_preflight(p_subject,p_document_type,p_content_json);
 if jsonb_typeof(base->'failures')='array' then select coalesce(array_agg(value::text),array[]::text[]) into failures from jsonb_array_elements_text(base->'failures'); end if;
 if latex_count<minlatex then failures:=array_append(failures,format('SCI-LATEX-LEVEL : %s éléments LaTeX ; minimum %s requis pour %s.',latex_count,minlatex,coalesce(p_level,'niveau non précisé'))); end if;
 select count(*) into graph_count from jsonb_array_elements(coalesce(p_content_json->'sections','[]'::jsonb)) sec cross join lateral jsonb_array_elements(coalesce(sec->'graphs','[]'::jsonb)) g where lower(coalesce(g->>'type',''))='geogebra' or lower(coalesce(g->>'instrument',g->>'graph_type','')) in ('function2d','complex_plane','parametric2d','parametric3d','surface3d','geometry2d','geometry3d','geogebra');
 if graph_count<2 then failures:=array_append(failures,format('SCI-GEOGEBRA-001 : %s construction(s) GeoGebra ; minimum 2 requis.',graph_count)); end if;
 implications=(length(raw)-length(replace(raw,'\\Rightarrow','')))/length('\\Rightarrow')+(length(raw)-length(replace(raw,'\\Longrightarrow','')))/length('\\Longrightarrow')+(length(raw)-length(replace(raw,'\\implies','')))/length('\\implies')+(length(raw)-length(replace(raw,'\\Longimplies','')))/length('\\Longimplies')+(length(raw)-length(replace(raw,'⇒','')))/length('⇒')+(length(raw)-length(replace(raw,'⟹','')))/length('⟹');
 max_implications:=least(100,greatest(1,ceil(latex_count*0.08)::int));
 if implications>max_implications then failures:=array_append(failures,format('SCI-IMPLICATION-001 : %s implications ; plafond %s pour %s éléments LaTeX.',implications,max_implications,latex_count)); end if;
 with urls as (
  select trim(coalesce(v->>'url',case when jsonb_typeof(v)='string' then v#>>'{}' else '' end)) url from jsonb_array_elements(case when jsonb_typeof(research->'sources')='array' then research->'sources' else '[]'::jsonb end) v
  union all select trim(coalesce(v->>'url',case when jsonb_typeof(v)='string' then v#>>'{}' else '' end)) from jsonb_array_elements(case when jsonb_typeof(research->'source_urls')='array' then research->'source_urls' else '[]'::jsonb end) v
 ), hosts as (select distinct lower(regexp_replace(regexp_replace(url,'^https?://',''),'[/?#].*$','')) host from urls where url~*'^https?://[^/]+')
 select count(*) into source_sites from hosts where host<>'' and host<>'localhost';
 if source_sites<3 then failures:=array_append(failures,format('SCI-SOURCES-001 : %s site(s) source distinct(s) ; minimum 3 requis.',source_sites)); end if;
 return jsonb_build_object('status',case when cardinality(failures)=0 then 'pass' else 'blocked' end,'contract_version','scientific-preflight-2','subject',p_subject,'level',p_level,'class_name',p_class_name,'metrics',jsonb_build_object('latex_conversion_elements',latex_count,'minimum_latex_conversion_elements',minlatex,'geogebra_graphs',graph_count,'minimum_geogebra_graphs',2,'source_sites',source_sites,'minimum_source_sites',3,'implication_count',implications,'maximum_implications',max_implications),'research_guard',jsonb_build_object('structured_trace',true,'distinct_sites_required',3),'failures',to_jsonb(failures));
end;$$;

create or replace function public.aurora_enforce_scientific_content_contract() returns trigger language plpgsql set search_path='public','pg_temp' as $$
declare origin text:=lower(coalesce(new.metadata->>'origin','')); report jsonb; research jsonb:='{}'::jsonb;
begin
 if origin<>'gpt_editorial_ingest' then return new; end if;
 if tg_op='UPDATE' and new.content_json is not distinct from old.content_json and new.subject is not distinct from old.subject and new.document_type is not distinct from old.document_type and new.matiere is not distinct from old.matiere and new.level is not distinct from old.level and new.class_name is not distinct from old.class_name then return new; end if;
 if new.job_id is not null then select coalesce(metadata->'workflow'->'chapter_research','{}'::jsonb) into research from public.aurora_content_jobs where id=new.job_id; end if;
 report:=public.aurora_scientific_preflight(new.matiere,new.document_type,new.content_json,new.level,new.class_name,research);
 if report->>'status'<>'pass' then raise exception 'Préflight scientifique Aurore bloqué : %',coalesce(report->>'failures','[]'); end if;
 new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('scientific_preflight',report||jsonb_build_object('checked_at',now()));
 return new;
end;$$;
