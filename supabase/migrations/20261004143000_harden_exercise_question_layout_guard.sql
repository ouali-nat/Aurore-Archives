-- Harden exercise question layout: every question must start on its own line
-- and numbering must be explicit and sequential.
create or replace function public.aurora_exercise_question_layout_guard(p_enonce text)
returns void language plpgsql set search_path to 'public','pg_temp' as $function$
declare
  v_qnums integer[] := '{}';
  v_match text[];
  v_idx integer;
  v_line text;
begin
  if nullif(trim(coalesce(p_enonce,'')),'') is null then
    raise exception 'EXERCISE_SERIES_BLOCKED: énoncé obligatoire';
  end if;

  for v_match in
    select regexp_matches(
      p_enonce,
      '(^|[\n\r])[[:space:]]*([0-9]+)[.)-][[:space:]]+',
      'gm'
    )
  loop
    v_qnums := array_append(v_qnums,(v_match[2])::integer);
  end loop;

  if cardinality(v_qnums) < 2 then
    raise exception
      'EXERCISE_SERIES_BLOCKED: au moins deux questions numérotées, chacune sur sa propre ligne, sont obligatoires';
  end if;

  for v_idx in 1..cardinality(v_qnums) loop
    if v_qnums[v_idx] <> v_idx then
      raise exception
        'EXERCISE_SERIES_BLOCKED: numérotation des questions invalide (attendu %, trouvé %)',
        v_idx,v_qnums[v_idx];
    end if;
  end loop;

  for v_line in
    select regexp_split_to_table(replace(p_enonce, chr(13), ''), chr(10))
  loop
    if v_line ~ '[^[:space:]][[:space:]]+[0-9]+[.)-][[:space:]]+' then
      raise exception
        'EXERCISE_SERIES_BLOCKED: chaque question doit commencer sur une nouvelle ligne; aucune question numérotée ne peut être collée à la précédente';
    end if;
  end loop;
end;
$function$;
