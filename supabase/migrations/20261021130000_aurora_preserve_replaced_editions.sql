-- Preserve historical QR references when a new generated edition reuses the same public Document row.
-- This migration is intentionally staged in the review branch; it has not been applied to Supabase production.
ALTER TABLE public.aurora_generated_documents
  DROP CONSTRAINT IF EXISTS aurora_generated_documents_status_check;

ALTER TABLE public.aurora_generated_documents
  ADD CONSTRAINT aurora_generated_documents_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'generated'::text, 'review'::text, 'approved'::text,
    'published'::text, 'replaced'::text, 'rejected'::text, 'failed'::text
  ]));

CREATE OR REPLACE FUNCTION public.aurora_mark_replaced_generated_editions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status = 'published'
     AND NEW.published_document_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.published_document_id IS DISTINCT FROM NEW.published_document_id
     ) THEN
    UPDATE public.aurora_generated_documents AS old_edition
    SET status = 'replaced',
        metadata = coalesce(old_edition.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'replaced_by_generated_document_id', NEW.id,
            'replacement', jsonb_build_object(
              'replaced_by_generated_document_id', NEW.id,
              'replaced_at', now(),
              'public_document_id', NEW.published_document_id
            )
          ),
        updated_at = now()
    WHERE old_edition.id <> NEW.id
      AND old_edition.status = 'published'
      AND old_edition.published_document_id = NEW.published_document_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aurora_mark_replaced_generated_editions
  ON public.aurora_generated_documents;

CREATE TRIGGER trg_aurora_mark_replaced_generated_editions
AFTER INSERT OR UPDATE OF status, published_document_id
ON public.aurora_generated_documents
FOR EACH ROW
EXECUTE FUNCTION public.aurora_mark_replaced_generated_editions();
