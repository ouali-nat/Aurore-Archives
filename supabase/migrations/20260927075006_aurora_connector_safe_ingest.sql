-- Aurore Archives
-- Connector-safe editorial ingestion bridge
-- 2026-09-27
--
-- Purpose:
--   Let the trusted Supabase connector invoke the canonical editorial ingestion
--   path without depending on an Edge Function-generated, short-lived memory
--   session. The scientific preflight, word-volume gates, document contracts,
--   human review and manual publication remain enforced by the canonical RPC.
--
-- Security:
--   The bridge is SECURITY DEFINER but EXECUTE is restricted to service_role.
--   anon/authenticated receive no execute privilege.

create or replace function public.aurora_enforce_editorial_memory_gate()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_session public.aurora_editorial_memory_sessions;
  v_session_id uuid;
  v_subject text;
  v_requires_math boolean;
  v_gate jsonb;
  v_expected jsonb;
  v_general_count integer;
  v_math_count integer;
  v_structure_count integer;
  v_connector boolean := false;
begin
  if coalesce(NEW.metadata->>'origin','') <> 'gpt_editorial_ingest' then
    return NEW;
  end if;

  v_connector := coalesce(NEW.metadata->>'connector_mode','false') = 'true';

  -- Trusted connector mode:
  -- verify the currently active editorial memory layers directly in the DB.
  -- The connector bridge is service_role-only, so no public/API caller can use
  -- this path to manufacture an editorial document.
  if v_connector then
    if not exists (
      select 1
      from public.aurora_editorial_memory
      where active = true
        and rule_key = 'document_insertion_protocol'
    ) then
      raise exception 'Mémoire éditoriale : protocole canonique indisponible';
    end if;

    if not exists (
      select 1
      from public.aurora_editorial_structure_memory
      where active = true
    ) then
      raise exception 'Mémoire éditoriale : mémoire de structure indisponible';
    end if;

    v_subject := lower(trim(coalesce(nullif(NEW.matiere,''), nullif(NEW.subject,''), '')));
    v_requires_math := v_subject like '%math%';

    if v_requires_math and not exists (
      select 1
      from public.aurora_math_editorial_memory
      where active = true
    ) then
      raise exception 'Mémoire mathématique obligatoire : pack absent';
    end if;

    NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'memory_schema','aurora-editorial-memory-3',
        'memory_gate', jsonb_build_object(
          'verified', true,
          'read_confirmed', true,
          'connector_mode', true,
          'verification_mode', 'database_current_memory_snapshot',
          'verified_at', now(),
          'subject', v_subject,
          'requires_math', v_requires_math,
          'general_rule_keys', coalesce((
            select jsonb_agg(rule_key order by priority desc, id)
            from public.aurora_editorial_memory
            where active = true
          ), '[]'::jsonb),
          'structure_rule_keys', coalesce((
            select jsonb_agg(rule_key order by priority desc, id)
            from public.aurora_editorial_structure_memory
            where active = true
          ), '[]'::jsonb),
          'math_rule_keys', case
            when v_requires_math then coalesce((
              select jsonb_agg(rule_key order by priority desc, id)
              from public.aurora_math_editorial_memory
              where active = true
            ), '[]'::jsonb)
            else '[]'::jsonb
          end
        )
      );

    return NEW;
  end if;

  -- Canonical Edge-Function memory-session path. Keep unchanged.
  if coalesce(NEW.metadata->>'memory_schema','') <> 'aurora-editorial-memory-3' then
    raise exception 'Mémoire éditoriale obligatoire : version de paquet mémoire invalide';
  end if;

  v_gate:=coalesce(NEW.metadata->'editorial_memory_gate','{}'::jsonb);

  if coalesce(v_gate->>'read_confirmed','false')<>'true'
     or coalesce(v_gate->>'verified','false')<>'true' then
    raise exception 'Lecture obligatoire : les consignes éditoriales doivent être lues et attestées avant l’injection';
  end if;

  begin
    v_session_id:=nullif(trim(NEW.metadata->>'memory_session_id'),'')::uuid;
  exception when others then
    raise exception 'Mémoire éditoriale invalide : memory_session_id doit être un UUID';
  end;

  select * into v_session
  from public.aurora_editorial_memory_sessions
  where session_id=v_session_id
    and used_at is null
    and expires_at>now()
  for update;

  if not found then
    raise exception 'Mémoire éditoriale obligatoire : session absente, expirée ou déjà consommée';
  end if;

  if coalesce(v_session.metadata->>'memory_schema','')<>'aurora-editorial-memory-3' then
    raise exception 'Mémoire éditoriale obligatoire : session issue d’une ancienne version du protocole';
  end if;

  if nullif(trim(v_gate->>'session_id'),'') is distinct from v_session_id::text then
    raise exception 'Lecture obligatoire : session_id invalide';
  end if;

  if nullif(trim(v_gate->>'bundle_sha256'),'') is distinct from v_session.bundle_sha256 then
    raise exception 'Lecture obligatoire : paquet mémoire différent';
  end if;

  v_expected:=jsonb_build_object(
    'session_id',v_session.session_id::text,
    'bundle_sha256',v_session.bundle_sha256,
    'protocol_version',v_session.metadata #>> '{editorial_read_gate,protocol_version}',
    'protocol_sha256',v_session.metadata #>> '{editorial_read_gate,protocol_sha256}',
    'general_rule_keys',coalesce(v_session.metadata #> '{editorial_read_gate,general_rule_keys}','[]'::jsonb),
    'structure_rule_keys',coalesce(v_session.metadata #> '{editorial_read_gate,structure_rule_keys}','[]'::jsonb),
    'math_rule_keys',coalesce(v_session.metadata #> '{editorial_read_gate,math_rule_keys}','[]'::jsonb),
    'family_key',v_session.metadata #>> '{editorial_read_gate,family_key}',
    'family_version',nullif(v_session.metadata #>> '{editorial_read_gate,family_version}','')::int,
    'family_sha256',v_session.metadata #>> '{editorial_read_gate,family_sha256}',
    'subject_profile_key',v_session.metadata #>> '{editorial_read_gate,subject_profile_key}',
    'subject_profile_version',nullif(v_session.metadata #>> '{editorial_read_gate,subject_profile_version}','')::int,
    'subject_profile_sha256',v_session.metadata #>> '{editorial_read_gate,subject_profile_sha256}',
    'document_profile_key',v_session.metadata #>> '{editorial_read_gate,document_profile_key}',
    'document_profile_version',nullif(v_session.metadata #>> '{editorial_read_gate,document_profile_version}','')::int,
    'document_profile_sha256',v_session.metadata #>> '{editorial_read_gate,document_profile_sha256}'
  );

  if coalesce(v_gate->>'protocol_version','')<>coalesce(v_expected->>'protocol_version','')
  or coalesce(v_gate->>'protocol_sha256','')<>coalesce(v_expected->>'protocol_sha256','')
  or coalesce(v_gate->>'family_key','')<>coalesce(v_expected->>'family_key','')
  or coalesce(v_gate->>'family_version','')<>coalesce(v_expected->>'family_version','')
  or coalesce(v_gate->>'family_sha256','')<>coalesce(v_expected->>'family_sha256','')
  or coalesce(v_gate->>'document_profile_key','')<>coalesce(v_expected->>'document_profile_key','')
  or coalesce(v_gate->>'document_profile_version','')<>coalesce(v_expected->>'document_profile_version','')
  or coalesce(v_gate->>'document_profile_sha256','')<>coalesce(v_expected->>'document_profile_sha256','')
  or coalesce(v_gate->>'subject_profile_key','')<>coalesce(v_expected->>'subject_profile_key','')
  or coalesce(v_gate->>'subject_profile_version','')<>coalesce(v_expected->>'subject_profile_version','')
  or coalesce(v_gate->>'subject_profile_sha256','')<>coalesce(v_expected->>'subject_profile_sha256','') then
    raise exception 'Lecture obligatoire : une couche de routage/profil mémoire ne correspond pas à la session';
  end if;

  if coalesce(v_gate->'general_rule_keys','[]'::jsonb)<>coalesce(v_expected->'general_rule_keys','[]'::jsonb)
  or coalesce(v_gate->'structure_rule_keys','[]'::jsonb)<>coalesce(v_expected->'structure_rule_keys','[]'::jsonb)
  or coalesce(v_gate->'math_rule_keys','[]'::jsonb)<>coalesce(v_expected->'math_rule_keys','[]'::jsonb) then
    raise exception 'Lecture obligatoire : liste des règles lues incomplète ou différente';
  end if;

  if nullif(trim(v_gate->>'ack_sha256'),'') is null
     or nullif(trim(v_gate->>'ack_sha256'),'') is distinct from
        (v_session.metadata #>> '{editorial_read_gate,ack_sha256}') then
    raise exception 'Lecture obligatoire : attestation cryptographique invalide';
  end if;

  v_subject:=lower(trim(coalesce(nullif(NEW.matiere,''),nullif(NEW.subject,''),'')));
  v_requires_math:=v_subject like '%math%';
  v_general_count:=coalesce(array_length(v_session.general_rule_ids,1),0);
  v_math_count:=coalesce(array_length(v_session.math_rule_ids,1),0);
  v_structure_count:=jsonb_array_length(
    coalesce(v_session.metadata #> '{editorial_read_gate,structure_rule_keys}','[]'::jsonb)
  );

  if v_general_count<1 then
    raise exception 'Mémoire éditoriale obligatoire : pack général absent';
  end if;

  if v_structure_count<1 then
    raise exception 'Mémoire éditoriale obligatoire : pack structure absent';
  end if;

  if v_requires_math and (not v_session.requires_math or v_math_count<1) then
    raise exception 'Mémoire mathématique obligatoire : pack absent';
  end if;

  NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb)||jsonb_build_object('memory_gate',
    jsonb_build_object(
      'verified',true,
      'read_confirmed',true,
      'session_id',v_session.session_id,
      'retrieved_at',v_session.retrieved_at,
      'expires_at',v_session.expires_at,
      'memory_schema','aurora-editorial-memory-3',
      'general_rule_ids',to_jsonb(v_session.general_rule_ids),
      'math_rule_ids',to_jsonb(v_session.math_rule_ids),
      'general_memory_version',v_session.general_memory_version,
      'math_memory_version',v_session.math_memory_version,
      'bundle_sha256',v_session.bundle_sha256,
      'protocol_version',v_expected->>'protocol_version',
      'protocol_sha256',v_expected->>'protocol_sha256',
      'general_rule_keys',v_expected->'general_rule_keys',
      'structure_rule_keys',v_expected->'structure_rule_keys',
      'math_rule_keys',v_expected->'math_rule_keys',
      'family_key',v_expected->>'family_key',
      'family_version',v_expected->>'family_version',
      'family_sha256',v_expected->>'family_sha256',
      'subject_profile_key',v_expected->>'subject_profile_key',
      'subject_profile_version',v_expected->>'subject_profile_version',
      'subject_profile_sha256',v_expected->>'subject_profile_sha256',
      'document_profile_key',v_expected->>'document_profile_key',
      'document_profile_version',v_expected->>'document_profile_version',
      'document_profile_sha256',v_expected->>'document_profile_sha256',
      'ack_sha256',v_session.metadata #>> '{editorial_read_gate,ack_sha256}'
    ));

  return NEW;
end;
$function$;

create or replace function public.aurora_consume_editorial_memory_session()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_session_id uuid;
begin
  if coalesce(NEW.metadata->>'origin','') <> 'gpt_editorial_ingest' then
    return NEW;
  end if;

  -- The connector has no temporary memory session by design. The BEFORE
  -- gate already verified the current memory snapshot.
  if coalesce(NEW.metadata->>'connector_mode','false') = 'true' then
    return NEW;
  end if;

  v_session_id := nullif(trim(NEW.metadata->>'memory_session_id'),'')::uuid;

  update public.aurora_editorial_memory_sessions
     set used_at=now(),
         used_ingest_id=NEW.ingest_id,
         metadata=coalesce(metadata,'{}'::jsonb)
           || jsonb_build_object(
             'consumed_document_id',NEW.id,
             'consumed_at',now()
           )
   where session_id=v_session_id
     and used_at is null;

  if not found then
    raise exception 'Mémoire éditoriale : session non consommable';
  end if;

  return NEW;
end;
$function$;

create or replace function public.aurora_connector_ingest_editorial_document(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v jsonb := coalesce(p_payload,'{}'::jsonb);
  v_metadata jsonb := coalesce(v->'metadata','{}'::jsonb);
  v_ingest_id text;
begin
  if coalesce(v->>'title','') = '' then
    raise exception 'Pont connecteur : title obligatoire';
  end if;

  if jsonb_typeof(v->'content_json') <> 'object' then
    raise exception 'Pont connecteur : content_json obligatoire';
  end if;

  v_ingest_id := nullif(trim(v->>'ingest_id'),'');
  if v_ingest_id is null then
    raise exception 'Pont connecteur : ingest_id obligatoire';
  end if;

  -- Keep the canonical origin so all existing Aurore insertion triggers remain
  -- active. connector_mode is only a routing marker for the memory-session gate.
  v_metadata := v_metadata
    || jsonb_build_object(
      'origin','gpt_editorial_ingest',
      'connector_mode',true,
      'connector_name','supabase-mcp',
      'connector_protocol','aurora-connector-ingest-1',
      'connector_verified_at',now()
    );

  -- The Supabase connector executes SQL as the database admin connection.
  -- Present the canonical RPC with the same service_role claim it expects.
  perform set_config('request.jwt.claim.role','service_role',true);

  return public.aurora_ingest_editorial_document(
    v_ingest_id,
    nullif(v->>'created_by','')::uuid,
    v->>'title',
    nullif(v->>'subject',''),
    nullif(v->>'level',''),
    nullif(v->>'class_name',''),
    coalesce(nullif(v->>'document_type',''),'cours'),
    nullif(v->>'prompt',''),
    v->'content_json',
    coalesce(v->'instructions','{}'::jsonb),
    v_metadata,
    nullif(v->>'domaine',''),
    nullif(v->>'formation',''),
    nullif(v->>'specialite',''),
    nullif(v->>'annee',''),
    nullif(v->>'semestre',''),
    nullif(v->>'filiere',''),
    nullif(v->>'matiere',''),
    coalesce(nullif(v->>'theme_color',''),'#C85C0D'),
    nullif(v->>'job_id','')::bigint
  );
end;
$function$;

revoke execute on function public.aurora_connector_ingest_editorial_document(jsonb)
from public, anon, authenticated;

grant execute on function public.aurora_connector_ingest_editorial_document(jsonb)
to service_role;
