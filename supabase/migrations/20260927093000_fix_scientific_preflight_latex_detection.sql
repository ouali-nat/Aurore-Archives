-- Aurore Archives
-- Fix scientific preflight LaTeX delimiter detection.
-- The canonical JSON contains one literal backslash before \(, \), \[ and \].
-- The previous detector searched for two consecutive backslashes and therefore
-- reported valid LaTeX blocks as zero.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='aurora_scientific_preflight'
  limit 1;

  if v_def is null then
    raise exception 'aurora_scientific_preflight introuvable';
  end if;

  v_def := replace(
    v_def,
    'v_slash text := chr(92)||chr(92);',
    'v_slash text := chr(92);'
  );

  execute v_def;
end $$;
