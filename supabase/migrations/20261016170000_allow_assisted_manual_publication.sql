-- L'éditeur assisté produit un PDF global en attente de validation humaine.
-- Le trigger autorisait son état "review", mais bloquait le passage à "published"
-- même lorsque la publication est faite explicitement par le RPC admin et que les
-- marqueurs de publication/validation manuelle sont présents. Ouvrir uniquement
-- cette transition vérifiée; les cours ordinaires restent soumis à la self-review.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$and lower(coalesce(new.status,'')) = 'review'$old$;
  v_new text := $new$and (
       lower(coalesce(new.status,'')) = 'review'
       OR (
         lower(coalesce(new.status,'')) = 'published'
         AND CASE
           WHEN jsonb_typeof(new.metadata->'publication') <> 'object' THEN false
           WHEN jsonb_typeof(new.metadata->'publication'->'targets') <> 'array' THEN false
           WHEN jsonb_typeof(new.metadata->'publication'->'document_ids') <> 'array' THEN false
           ELSE
             jsonb_array_length(new.metadata->'publication'->'targets') > 0
             AND jsonb_array_length(new.metadata->'publication'->'document_ids') > 0
             AND nullif(trim(coalesce(new.metadata->'publication'->>'published_at','')),'') IS NOT NULL
             AND new.published_document_id IS NOT NULL
         END
       )
     )$new$;
BEGIN
  SELECT pg_get_functiondef('public.aurora_enforce_editorial_self_review()'::regprocedure)
    INTO v_definition;

  IF position(v_old IN v_definition) = 0 THEN
    IF position(v_new IN v_definition) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Échec du patch : condition attendue absente dans aurora_enforce_editorial_self_review.';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$migration$;
