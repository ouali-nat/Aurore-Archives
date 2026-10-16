-- Keep all Content Factory publications in the public "Documents" category.
-- Preserve the resource type separately; it must not route the PDF to "Devoirs".
-- Also mirror Section A's matieresAvecAutres() fallback in the relational catalog.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_autres_id uuid;
BEGIN
  SELECT pg_get_functiondef(
    'public.aurora_publish_generated_document_to_places(bigint,jsonb,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$v_category := CASE WHEN v_type IN ('Exercices', 'Devoir') THEN 'Devoirs' ELSE 'Documents' END;$old$;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Pattern de catégorie non trouvé dans aurora_publish_generated_document_to_places ; migration interrompue sans modification.';
  END IF;
  v_new := replace(v_definition, v_old, 'v_category := ''Documents'';');
  IF v_new = v_definition THEN
    RAISE EXCEPTION 'La fonction de publication multi-emplacements n’a pas été modifiée.';
  END IF;
  EXECUTE v_new;

  SELECT pg_get_functiondef(
    'public.aurora_publish_generated_document(bigint,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$v_category := coalesce(
    nullif(trim(coalesce(v_job.instructions->>'category','')), ''),
    nullif(trim(coalesce(v_job.metadata->>'category','')), ''),
    case when lower(coalesce(v_doc.document_type,'')) in ('devoir','exercice','devoirs') then 'Devoirs' else 'Documents' end
  );$old$;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Pattern de catégorie non trouvé dans aurora_publish_generated_document ; migration interrompue sans modification.';
  END IF;
  v_new := replace(v_definition, v_old, 'v_category := ''Documents'';');
  IF v_new = v_definition THEN
    RAISE EXCEPTION 'La fonction de publication directe n’a pas été modifiée.';
  END IF;
  EXECUTE v_new;

  INSERT INTO public.aurore_pedagogical_subjects
    (name, code, subject_key, sort_order, active, source, metadata)
  VALUES
    ('Autres', 'Au', 'autres',
     COALESCE((SELECT max(sort_order) + 1 FROM public.aurore_pedagogical_subjects), 0),
     true, 'legacy',
     jsonb_build_object('shared_catalog_fallback', 'matieresAvecAutres'))
  ON CONFLICT (subject_key) DO UPDATE
    SET name = 'Autres',
        code = COALESCE(public.aurore_pedagogical_subjects.code, EXCLUDED.code),
        active = true,
        source = 'legacy',
        metadata = public.aurore_pedagogical_subjects.metadata || EXCLUDED.metadata,
        updated_at = now()
  RETURNING id INTO v_autres_id;

  INSERT INTO public.aurore_pedagogical_node_subjects (node_id, subject_id, sort_order)
  SELECT
    n.id,
    v_autres_id,
    COALESCE((
      SELECT max(existing.sort_order) + 1
      FROM public.aurore_pedagogical_node_subjects existing
      WHERE existing.node_id = n.id
    ), 0)
  FROM public.aurore_pedagogical_nodes n
  WHERE n.active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.aurore_pedagogical_nodes child
      WHERE child.parent_id = n.id
        AND child.active = true
    )
  ON CONFLICT (node_id, subject_id) DO NOTHING;
END;
$migration$;
