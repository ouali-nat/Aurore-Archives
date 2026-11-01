-- Content Factory must expose only complete documents, never page-level PDF fragments.
CREATE OR REPLACE FUNCTION public.admin_list_aurora_generated_documents()
 RETURNS SETOF public.aurora_generated_documents
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT d.*
  FROM public.aurora_generated_documents AS d
  WHERE public.is_admin()
    AND d.status IN ('generated', 'review', 'approved', 'published')
    AND lower(btrim(coalesce(d.document_type, ''))) NOT IN ('page_assistee', 'apercu_assiste', 'apercu_assistee', 'preview_assistee')
    AND lower(btrim(coalesce(d.document_type, ''))) !~ '(^|[_ -])(page|fragment|apercu|preview)([_ -]|$)'
    AND nullif(btrim(coalesce(d.pdf_path, '')), '') IS NOT NULL
    AND nullif(btrim(coalesce(d.pdf_url, '')), '') IS NOT NULL
    -- Never return the intermediate storage prefix used by the page renderer.
    AND d.pdf_path NOT LIKE 'aurora-content-pages/%'
    AND d.pdf_path !~ '(^|/)page-[0-9]+[.]pdf$'
    AND coalesce(d.metadata->>'admin_deleted', 'false') <> 'true'
    AND coalesce(d.metadata->>'is_page', 'false') <> 'true'
    AND coalesce(d.metadata->>'is_preview', 'false') <> 'true'
    AND coalesce(d.metadata->>'preview_only', 'false') <> 'true'
    AND (
      lower(btrim(coalesce(d.metadata->>'origin', ''))) <> 'edition_assistee'
      OR (
        lower(btrim(coalesce(d.document_type, ''))) = 'cours_assiste'
        AND d.pdf_path LIKE 'aurora-assisted-final-pdfs/%'
        AND jsonb_typeof(d.metadata->'assisted_final') = 'object'
        AND coalesce(d.metadata->'assisted_final'->>'page_count', '') ~ '^[1-9][0-9]*$'
        AND nullif(btrim(coalesce(d.metadata->'assisted_final'->>'fingerprint', '')), '') IS NOT NULL
        AND coalesce(d.metadata->'assisted_final'->>'pdf_path', '') = d.pdf_path
      )
    )
  ORDER BY d.id DESC;
$function$;
