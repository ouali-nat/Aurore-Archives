-- Reconnecter la file Content Factory au worker éditorial automatique.
-- Le renderer LuaLaTeX reste séparé et inchangé.
create or replace function public.aurora_content_jobs_auto_wake()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  publishable_key text;
begin
  if new.status = 'queued'
     and (tg_op = 'INSERT' or old.status is distinct from 'queued') then
    publishable_key := coalesce(
      nullif(current_setting('app.settings.aurore_publishable_key', true), ''),
      'sb_publishable_ZAMaja5K7r9VseM5_cbkvA_PhLuhNNS'
    );
    perform net.http_post(
      url := 'https://tdeotqfsbvouresfhkab.supabase.co/functions/v1/aurora-content-auto-wake',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', publishable_key
      ),
      body := jsonb_build_object(
        'type', tg_op,
        'table', 'aurora_content_jobs',
        'schema', 'public',
        'job_id', new.id
      ),
      timeout_milliseconds := 2000
    );
  end if;
  return new;
end;
$function$;

select cron.alter_job(
  1,
  command := $cmd$
    select net.http_post(
      url := 'https://tdeotqfsbvouresfhkab.supabase.co/functions/v1/aurora-content-auto-wake',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', coalesce(
          nullif(current_setting('app.settings.aurore_publishable_key', true), ''),
          'sb_publishable_ZAMaja5K7r9VseM5_cbkvA_PhLuhNNS'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 2000
    );
  $cmd$
);