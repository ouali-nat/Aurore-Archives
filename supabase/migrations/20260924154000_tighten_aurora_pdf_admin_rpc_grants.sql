-- Keep production/archive RPCs callable only by authenticated administrators.
revoke execute on function public.aurora_start_pdf_production_attempt(bigint) from anon, public;
grant execute on function public.aurora_start_pdf_production_attempt(bigint) to authenticated;
revoke execute on function public.aurora_archive_generated_document(bigint) from anon, public;
grant execute on function public.aurora_archive_generated_document(bigint) to authenticated;
