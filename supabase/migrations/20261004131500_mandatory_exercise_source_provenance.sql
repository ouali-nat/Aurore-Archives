-- Mandatory external provenance for every exercise and correction block.
-- Exercises must be sourced externally and editorially transformed; AI-only fabrication is blocked.
create or replace function public.aurora_exercise_source_guard(p_metadata jsonb)
returns void language plpgsql set search_path to 'public','pg_temp' as $function$
declare
  v_prov jsonb := coalesce(p_metadata->'provenance','{}'::jsonb);
  v_ex jsonb := coalesce(v_prov->'exercise_source','{}'::jsonb);
  v_corr jsonb := coalesce(v_prov->'correction_source','{}'::jsonb);
  v_transform jsonb := coalesce(v_prov->'transformation','{}'::jsonb);
  v_url text; v_params jsonb; v_count integer; v_host text;
begin
  if jsonb_typeof(p_metadata) <> 'object' or jsonb_typeof(v_prov) <> 'object' then
    raise exception 'EXERCISE_SOURCE_BLOCKED: metadata de provenance obligatoire';
  end if;

  foreach v_url in array array[
    nullif(trim(v_ex->>'url'),''),
    nullif(trim(v_corr->>'url'),'')
  ] loop
    if v_url is null or v_url !~* '^https://[^[:space:]]+$' then
      raise exception 'EXERCISE_SOURCE_BLOCKED: chaque exercice et chaque correction doit posséder une source HTTPS fiable identifiable';
    end if;
    v_host := lower(regexp_replace(regexp_replace(v_url,'^https://',''),'[/:?#].*$',''));
    if v_host in ('aurore-archives.com','auroresectionarchives.com','localhost') or v_host like '%.vercel.app' then
      raise exception 'EXERCISE_SOURCE_BLOCKED: la source doit être externe à Aurore';
    end if;
  end loop;

  if nullif(trim(v_ex->>'title'),'') is null or nullif(trim(v_ex->>'site'),'') is null then
    raise exception 'EXERCISE_SOURCE_BLOCKED: titre et site de la source de l''énoncé obligatoires';
  end if;
  if nullif(trim(v_corr->>'title'),'') is null or nullif(trim(v_corr->>'site'),'') is null then
    raise exception 'EXERCISE_SOURCE_BLOCKED: titre et site de la source de la correction obligatoires';
  end if;
  if nullif(trim(v_ex->>'retrieved_at'),'') is null or nullif(trim(v_corr->>'retrieved_at'),'') is null then
    raise exception 'EXERCISE_SOURCE_BLOCKED: date de récupération obligatoire pour les deux sources';
  end if;

  if coalesce(v_prov->>'derived_from_external_source','false') <> 'true' then
    raise exception 'EXERCISE_SOURCE_BLOCKED: l''exercice doit être dérivé d''une source externe, pas créé ex nihilo';
  end if;
  if coalesce(v_transform->>'applied','false') <> 'true' then
    raise exception 'EXERCISE_SOURCE_BLOCKED: la transformation éditoriale des paramètres de l''exercice est obligatoire';
  end if;

  v_params := coalesce(v_transform->'parameters_changed','{}'::jsonb);
  if jsonb_typeof(v_params) <> 'object' or v_params = '{}'::jsonb then
    raise exception 'EXERCISE_SOURCE_BLOCKED: les paramètres modifiés doivent être explicitement tracés';
  end if;
  select count(*) into v_count from jsonb_each_text(v_params) where nullif(trim(value),'') is not null;
  if v_count < 1 then
    raise exception 'EXERCISE_SOURCE_BLOCKED: au moins un paramètre modifié doit être renseigné';
  end if;
  if nullif(trim(v_transform->>'method'),'') is null then
    raise exception 'EXERCISE_SOURCE_BLOCKED: méthode de transformation éditoriale obligatoire';
  end if;
end;
$function$;

create or replace function public.aurora_exercise_series_item_guard()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
declare
  v_words integer; v_qnums integer[] := '{}'; v_match text[]; v_idx integer; v_corr_words integer;
begin
  if nullif(trim(coalesce(new.titre,'')),'') is null then raise exception 'EXERCISE_SERIES_BLOCKED: titre de l’exercice obligatoire'; end if;
  if nullif(trim(coalesce(new.enonce,'')),'') is null then raise exception 'EXERCISE_SERIES_BLOCKED: énoncé obligatoire'; end if;
  v_words := cardinality(regexp_split_to_array(regexp_replace(trim(new.enonce),'[[:space:]]+',' ','g'),' '));
  if v_words < 100 then raise exception 'EXERCISE_SERIES_BLOCKED: énoncé inférieur à 100 mots (% mots)',v_words; end if;
  for v_match in select regexp_matches(new.enonce,'(^|[\\n\\r])[[:space:]]*([0-9]+)[.)-][[:space:]]+','gm') loop
    v_qnums := array_append(v_qnums,(v_match[2])::integer);
  end loop;
  if cardinality(v_qnums) < 2 then raise exception 'EXERCISE_SERIES_BLOCKED: au moins deux questions numérotées, chacune commençant sur une nouvelle ligne, sont obligatoires'; end if;
  for v_idx in 1..cardinality(v_qnums) loop
    if v_qnums[v_idx] <> v_idx then raise exception 'EXERCISE_SERIES_BLOCKED: numérotation des questions invalide (attendu %, trouvé %)',v_idx,v_qnums[v_idx]; end if;
  end loop;
  if nullif(trim(coalesce(new.correction,'')),'') is null then raise exception 'EXERCISE_SERIES_BLOCKED: un corrigé correspondant est obligatoire'; end if;
  v_corr_words := cardinality(regexp_split_to_array(regexp_replace(trim(new.correction),'[[:space:]]+',' ','g'),' '));
  if v_corr_words < 200 then raise exception 'EXERCISE_SERIES_BLOCKED: corrigé inférieur à 200 mots (% mots)',v_corr_words; end if;
  if new.position is null or new.position < 1 then raise exception 'EXERCISE_SERIES_BLOCKED: position d’exercice invalide'; end if;
  perform public.aurora_exercise_source_guard(new.metadata);
  return new;
end;
$function$;
