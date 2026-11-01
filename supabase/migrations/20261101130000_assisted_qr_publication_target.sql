-- Resolve an assisted course QR into either its current public document or
-- the generated-document ID needed to continue publication from Content Factory.
CREATE OR REPLACE FUNCTION public.aurora_resolve_assisted_qr_target(p_course_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH candidates AS (
    SELECT
      generated.id AS generated_document_id,
      generated.updated_at,
      published.id AS public_document_id
    FROM public.aurora_generated_documents AS generated
    LEFT JOIN public."Document" AS published
      ON published.id = generated.published_document_id
     AND coalesce(published."Publie", false) = true
    WHERE generated.status IN ('generated', 'review', 'approved', 'published')
      AND lower(coalesce(generated.metadata->>'origin', '')) = 'edition_assistee'
      AND jsonb_typeof(generated.metadata->'assisted_final') = 'object'
      AND generated.metadata->'assisted_final'->>'course_id' = p_course_id::text
  )
  SELECT jsonb_build_object(
    'status', CASE WHEN candidates.public_document_id IS NOT NULL THEN 'published' ELSE 'unpublished' END,
    'document_id', candidates.public_document_id,
    'generated_document_id', CASE WHEN candidates.public_document_id IS NULL THEN candidates.generated_document_id ELSE NULL END
  )
  FROM candidates
  ORDER BY (candidates.public_document_id IS NOT NULL) DESC,
           candidates.updated_at DESC,
           candidates.generated_document_id DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.aurora_resolve_assisted_qr_target(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aurora_resolve_assisted_qr_target(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.aurora_resolve_assisted_qr_target(uuid) IS
  'Resolve an assisted-course QR to a published public Document ID, or to the generated-document ID for its protected Content Factory publication link.';
