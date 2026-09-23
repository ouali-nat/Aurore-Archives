create or replace function public.aurora_cancel_content_job(p_job_id bigint)
returns public.aurora_content_jobs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.aurora_content_jobs;
  v_metadata jsonb;
  v_now timestamptz := now();
begin
  if not private.is_aurora_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select *
    into v_job
    from public.aurora_content_jobs
   where id = p_job_id
   for update;

  if v_job.id is null then
    raise exception 'Job Content Factory introuvable';
  end if;

  if v_job.generated_document_id is not null then
    raise exception 'Ce job possède déjà un document PDF associé';
  end if;

  if v_job.status not in ('draft','queued','processing') then
    raise exception 'Aucune génération Content Factory active pour le job %', p_job_id;
  end if;

  v_metadata := coalesce(v_job.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'generation_cancel_requested', true,
      'generation_cancel_requested_at', v_now,
      'generation_cancelled', true,
      'generation_cancelled_at', v_now,
      'generation_stage', 'Génération annulée par l’administration'
    );

  update public.aurora_content_jobs
     set status = 'cancelled',
         error_message = 'Génération annulée par un administrateur',
         metadata = v_metadata,
         updated_at = v_now
   where id = p_job_id
   returning * into v_job;

  return v_job;
end;
$function$;

revoke execute on function public.aurora_cancel_content_job(bigint) from public, anon;
grant execute on function public.aurora_cancel_content_job(bigint) to authenticated;

create or replace function public.aurora_finish_content_job(
  p_job_id bigint,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_status not in ('generated','review','failed') then
    raise exception 'Statut final invalide';
  end if;

  update public.aurora_content_jobs
     set status = p_status,
         error_message = p_error,
         updated_at = now()
   where id = p_job_id
     and status <> 'cancelled';
end;
$function$;
