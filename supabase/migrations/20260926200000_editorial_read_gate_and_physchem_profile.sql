-- Aurore Archives: mandatory editorial read attestation and Physique-Chimie quantitative profile.
-- Editorial layer only: no LuaLaTeX, PDF renderer, GitHub Actions, publication or auth changes.

insert into public.aurora_editorial_memory
  (rule_key,version,title,priority,mandatory,active,content)
values
(
  'editorial_read_gate',1,'Lecture obligatoire des consignes avant génération',1005,true,true,
  jsonb_build_object(
    'hard_gate',true,
    'before_content_generation',jsonb_build_array(
      'récupérer la mémoire éditoriale active',
      'lire les règles générales et le profil disciplinaire applicable',
      'accuser réception de la lecture avec la session mémoire et les identifiants de règles',
      'ne produire ni n’injecter de contenu avant validation de cette attestation'
    ),
    'acknowledgement','editorial_memory_ack',
    'required_fields',jsonb_build_array(
      'read_confirmed','session_id','bundle_sha256','general_rule_keys','math_rule_keys',
      'subject_profile_key','subject_profile_version','ack_sha256'
    ),
    'security_binding','L’attestation est liée à la session et à son paquet mémoire par une empreinte SHA-256 ; une simple déclaration textuelle ne suffit pas.',
    'failure','Toute absence, incohérence, expiration ou consommation de session bloque la progression.'
  )
)
on conflict (rule_key,version) do update
set title=excluded.title,priority=excluded.priority,mandatory=excluded.mandatory,active=true,
    content=excluded.content,updated_at=now();

insert into public.aurora_editorial_subject_profiles
  (subject_key,subject_name,family_key,version,status,active,content)
values
(
  'physique-chimie','Physique-Chimie','sciences',1,'ready',true,
  jsonb_build_object(
    'schema_version','physique-chimie-editorial-profile-1',
    'hard_gate',true,
    'mode','quantitative_calculatoire',
    'principle','La prose soutient le raisonnement scientifique ; elle ne remplace pas les formules, relations, calculs, bilans et démonstrations.',
    'generation_structure',jsonb_build_array(
      'relation ou équation','définition des grandeurs et unités',
      'transformation mathématique ou établissement','application numérique ou bilan',
      'résultat avec unité','interprétation scientifique'
    ),
    'constraints',jsonb_build_object(
      'minimum_scientific_relations',8,
      'minimum_calculation_blocks',6,
      'minimum_demonstration_blocks',2,
      'minimum_scientific_block_ratio',0.55,
      'maximum_narrative_only_block_ratio',0.25
    ),
    'rules',jsonb_build_array(
      'Toute notion quantitative importante doit être traitée par ses relations, équations ou bilans lorsqu’ils existent.',
      'Les transformations, substitutions, calculs et unités doivent apparaître explicitement lorsqu’ils sont pertinents.',
      'Une démonstration ou un établissement important ne doit pas être remplacé par une conclusion verbale.',
      'Les applications numériques doivent montrer les données utilisées, la relation mobilisée et le résultat interprété.',
      'Les réactions chimiques et bilans doivent être présentés explicitement lorsque le sujet les implique.',
      'GeoGebra doit être considéré lorsque la représentation d’une relation quantitative, d’une trajectoire ou d’un phénomène dynamique apporte une vraie valeur pédagogique.',
      'Wikimedia reste documentaire : il ne remplace jamais le travail scientifique et n’est utilisé que lorsqu’il apporte un contexte, une observation ou une source pertinente.',
      'La prose de liaison doit rester courte et fonctionnelle ; elle ne doit pas être utilisée pour atteindre artificiellement le volume minimal de mots.'
    ),
    'anti_patterns',jsonb_build_array(
      'cours de physique-chimie rédigé comme un cours de littérature avec quelques formules ajoutées',
      'longues explications sans relation, calcul, unité, bilan ou raisonnement scientifique',
      'formule donnée sans manipulation ni application lorsqu’une démonstration ou un calcul est attendu',
      'répétition de conclusions pour augmenter le volume'
    )
  )
)
on conflict (subject_key) do update
set subject_name=excluded.subject_name,family_key=excluded.family_key,version=excluded.version,
    status=excluded.status,active=true,content=excluded.content,updated_at=now();

insert into public.aurora_editorial_subject_aliases(alias,subject_key,active,metadata)
values
  ('physique-chimie','physique-chimie',true,'{}'::jsonb),
  ('physique chimie','physique-chimie',true,'{}'::jsonb),
  ('physique','physique-chimie',true,'{}'::jsonb),
  ('chimie','physique-chimie',true,'{}'::jsonb),
  ('sciences physiques','physique-chimie',true,'{}'::jsonb),
  ('pc','physique-chimie',true,'{}'::jsonb)
on conflict (alias) do update
set subject_key=excluded.subject_key,active=true,metadata=excluded.metadata;

create or replace function public.aurora_enforce_editorial_memory_gate()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $function$
declare
  v_session public.aurora_editorial_memory_sessions;
  v_session_id uuid;
  v_subject text;
  v_requires_math boolean;
  v_general_count integer;
  v_math_count integer;
  v_gate jsonb;
  v_expected_ack text;
begin
  if coalesce(NEW.metadata->>'origin','') <> 'gpt_editorial_ingest' then return NEW; end if;

  if coalesce(trim(NEW.metadata->>'memory_session_id'),'')='' then
    raise exception 'Mémoire éditoriale obligatoire : aucune session mémoire n’a été fournie';
  end if;

  begin
    v_session_id := (NEW.metadata->>'memory_session_id')::uuid;
  exception when others then
    raise exception 'Mémoire éditoriale invalide : memory_session_id doit être un UUID';
  end;

  v_gate := coalesce(NEW.metadata->'editorial_memory_gate','{}'::jsonb);
  if coalesce(v_gate->>'read_confirmed','false') <> 'true'
     or coalesce(v_gate->>'verified','false') <> 'true' then
    raise exception 'Lecture obligatoire : les consignes éditoriales n’ont pas été validées avant injection';
  end if;

  if nullif(trim(v_gate->>'session_id'),'') is distinct from v_session_id::text then
    raise exception 'Lecture obligatoire : la session attestée ne correspond pas à la session d’injection';
  end if;

  select * into v_session
  from public.aurora_editorial_memory_sessions
  where session_id=v_session_id and used_at is null and expires_at>now()
  for update;

  if not found then
    raise exception 'Mémoire éditoriale obligatoire : session absente, expirée ou déjà consommée';
  end if;

  if nullif(trim(v_gate->>'bundle_sha256'),'') is distinct from v_session.bundle_sha256 then
    raise exception 'Lecture obligatoire : le paquet mémoire attesté ne correspond pas à la session';
  end if;

  v_expected_ack := v_session.metadata #>> '{editorial_read_gate,ack_sha256}';
  if nullif(trim(v_gate->>'ack_sha256'),'') is null
     or nullif(trim(v_gate->>'ack_sha256'),'') is distinct from v_expected_ack then
    raise exception 'Lecture obligatoire : l’attestation cryptographique est invalide';
  end if;

  if coalesce(v_session.metadata #>> '{editorial_read_gate,subject_profile_key}','') <>
     coalesce(v_gate->>'subject_profile_key','') then
    raise exception 'Lecture obligatoire : le profil disciplinaire attesté ne correspond pas à la session';
  end if;

  if coalesce(v_session.metadata #>> '{editorial_read_gate,subject_profile_version}','') <>
     coalesce(v_gate->>'subject_profile_version','') then
    raise exception 'Lecture obligatoire : la version du profil disciplinaire attestée ne correspond pas à la session';
  end if;

  v_subject := lower(trim(coalesce(nullif(NEW.matiere,''),nullif(NEW.subject,''),'')));
  v_requires_math := v_subject like '%math%';

  v_general_count := coalesce(array_length(v_session.general_rule_ids,1),0);
  v_math_count := coalesce(array_length(v_session.math_rule_ids,1),0);

  if v_general_count<1 then
    raise exception 'Mémoire éditoriale obligatoire : le pack général n’a pas été récupéré';
  end if;

  if v_requires_math and (not v_session.requires_math or v_math_count<1) then
    raise exception 'Mémoire mathématique obligatoire : le pack Mathématiques n’a pas été récupéré';
  end if;

  if lower(trim(coalesce(v_session.requested_subject,'')))<>v_subject
     and not (v_requires_math and lower(trim(coalesce(v_session.requested_subject,''))) like '%math%') then
    raise exception 'Mémoire éditoriale incompatible avec la matière demandée';
  end if;

  NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object(
    'memory_gate',jsonb_build_object(
      'verified',true,'read_confirmed',true,'session_id',v_session.session_id,
      'retrieved_at',v_session.retrieved_at,'expires_at',v_session.expires_at,
      'general_rule_ids',to_jsonb(v_session.general_rule_ids),
      'math_rule_ids',to_jsonb(v_session.math_rule_ids),
      'general_memory_version',v_session.general_memory_version,
      'math_memory_version',v_session.math_memory_version,
      'bundle_sha256',v_session.bundle_sha256,'ack_sha256',v_expected_ack,
      'subject_profile_key',v_session.metadata #>> '{editorial_read_gate,subject_profile_key}',
      'subject_profile_version',v_session.metadata #>> '{editorial_read_gate,subject_profile_version}'
    )
  );
  return NEW;
end;
$function$;

drop trigger if exists aurora_generated_documents_memory_gate on public.aurora_generated_documents;
create trigger aurora_generated_documents_memory_gate
before insert on public.aurora_generated_documents
for each row execute function public.aurora_enforce_editorial_memory_gate();
