CREATE OR REPLACE FUNCTION public.aurora_publish_generated_document_to_places(p_generated_document_id bigint, p_targets jsonb, p_notes text DEFAULT NULL::text)
 RETURNS aurora_generated_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_doc public.aurora_generated_documents%ROWTYPE;
  v_target jsonb;
  v_type text;
  v_category text;
  v_node_id uuid;
  v_subject_id uuid;
  v_node public.aurore_pedagogical_nodes%ROWTYPE;
  v_subject public.aurore_pedagogical_subjects%ROWTYPE;
  v_level text;
  v_class text;
  v_filiere text;
  v_existing_id bigint;
  v_document_id bigint;
  v_document_ids bigint[] := ARRAY[]::bigint[];
  v_seen_targets text[] := ARRAY[]::text[];
  v_target_key text;
  v_targets_saved jsonb := '[]'::jsonb;
  v_course_id uuid;
  v_course_pages jsonb;
  v_previous_targets jsonb := '[]'::jsonb;
  v_assisted_meta jsonb;
  v_old_target jsonb;
  v_old_document_id bigint;
  v_published_at timestamptz := now();
BEGIN
  IF NOT private.is_aurora_admin() THEN
    RAISE EXCEPTION 'Accès administrateur requis';
  END IF;

  IF p_targets IS NULL OR jsonb_typeof(p_targets) <> 'array' THEN
    RAISE EXCEPTION 'Choisis au moins un emplacement pédagogique.';
  END IF;
  IF jsonb_array_length(p_targets) > 50 THEN
    RAISE EXCEPTION 'Choisis au maximum 50 emplacements pédagogiques.';
  END IF;

  SELECT * INTO v_doc
  FROM public.aurora_generated_documents
  WHERE id = p_generated_document_id
  FOR UPDATE;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document généré introuvable';
  END IF;

  IF lower(btrim(coalesce(v_doc.document_type, ''))) IN ('page_assistee', 'apercu_assistee', 'apercu_assiste') THEN
    RAISE EXCEPTION 'Publication interdite : une page ou un aperçu isolé ne constitue pas un document complet.';
  END IF;

  IF nullif(btrim(coalesce(v_doc.pdf_path, '')), '') IS NULL
     OR nullif(btrim(coalesce(v_doc.pdf_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Publication impossible : le PDF complet doit d’abord être généré et enregistré.';
  END IF;

  IF lower(btrim(coalesce(v_doc.metadata->>'origin', ''))) = 'edition_assistee'
     AND NOT (
       lower(btrim(coalesce(v_doc.document_type, ''))) = 'cours_assiste'
       AND v_doc.pdf_path LIKE 'aurora-assisted-final-pdfs/%'
       AND nullif(btrim(coalesce(v_doc.metadata->>'assisted_final', '')), '') IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Publication refusée : seule la version globale fusionnée de l’édition assistée peut être publiée.';
  END IF;

  IF v_doc.status NOT IN ('generated', 'review', 'approved', 'published') THEN
    RAISE EXCEPTION 'Publication impossible depuis le statut %', v_doc.status;
  END IF;

  v_previous_targets := CASE
    WHEN jsonb_typeof(v_doc.metadata #> '{publication,targets}') = 'array'
      THEN v_doc.metadata #> '{publication,targets}'
    ELSE '[]'::jsonb
  END;

  IF lower(btrim(coalesce(v_doc.metadata->>'origin', ''))) = 'edition_assistee' THEN
    BEGIN
      IF jsonb_typeof(v_doc.metadata->'assisted_final') = 'object' THEN
        v_assisted_meta := v_doc.metadata->'assisted_final';
      ELSIF jsonb_typeof(v_doc.metadata->'assisted_final') = 'string' THEN
        v_assisted_meta := (v_doc.metadata->>'assisted_final')::jsonb;
      END IF;
      v_course_id := nullif(v_assisted_meta->>'course_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_course_id := NULL;
    END;

    IF v_course_id IS NOT NULL THEN
      SELECT pages INTO v_course_pages
      FROM public.aurora_assisted_courses
      WHERE id = v_course_id
      FOR UPDATE;
      IF jsonb_typeof(v_course_pages #> '{course,workflow,publication_targets}') = 'array' THEN
        v_previous_targets := v_course_pages #> '{course,workflow,publication_targets}';
      END IF;
    END IF;
  END IF;

  FOR v_target IN SELECT value FROM jsonb_array_elements(p_targets)
  LOOP
    BEGIN
      v_node_id := nullif(v_target->>'node_id', '')::uuid;
      v_subject_id := nullif(v_target->>'subject_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Un emplacement ou une matière sélectionnée est invalide.';
    END;

    IF v_node_id IS NULL OR v_subject_id IS NULL THEN
      RAISE EXCEPTION 'Chaque emplacement doit comporter une matière et un nœud pédagogique.';
    END IF;

    v_type := CASE lower(btrim(coalesce(v_target->>'resource_type', '')))
      WHEN 'fiche de cours' THEN 'Fiche de cours'
      WHEN 'fiche de révision' THEN 'Fiche de révision'
      WHEN 'fiche de revision' THEN 'Fiche de révision'
      WHEN 'exercices' THEN 'Exercices'
      WHEN 'exercice' THEN 'Exercices'
      WHEN 'devoir' THEN 'Devoir'
      WHEN 'document' THEN 'Document'
      WHEN 'qcm' THEN 'QCM'
      ELSE NULL
    END;
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'Type de ressource invalide : %', coalesce(v_target->>'resource_type', '(vide)');
    END IF;

    v_category := 'Documents';
    v_target_key := v_node_id::text || '|' || v_subject_id::text || '|' || v_type;
    IF v_target_key = ANY(v_seen_targets) THEN
      CONTINUE;
    END IF;
    v_seen_targets := array_append(v_seen_targets, v_target_key);

    SELECT * INTO v_node
    FROM public.aurore_pedagogical_nodes
    WHERE id = v_node_id AND active = true;
    IF v_node.id IS NULL THEN
      RAISE EXCEPTION 'Emplacement pédagogique introuvable ou désactivé.';
    END IF;

    SELECT * INTO v_subject
    FROM public.aurore_pedagogical_subjects
    WHERE id = v_subject_id AND active = true;
    IF v_subject.id IS NULL THEN
      RAISE EXCEPTION 'Matière introuvable ou désactivée.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.aurore_pedagogical_node_subjects ns
      WHERE ns.node_id = v_node_id AND ns.subject_id = v_subject_id
    ) THEN
      RAISE EXCEPTION 'La matière % n’est pas associée à l’emplacement %.', v_subject.name, v_node.name;
    END IF;

    WITH RECURSIVE ancestors AS (
      SELECT n.id, n.parent_id, n.name, n.node_type, n.legacy_path, n.metadata, 0 AS depth
      FROM public.aurore_pedagogical_nodes n
      WHERE n.id = v_node_id AND n.active = true
      UNION ALL
      SELECT p.id, p.parent_id, p.name, p.node_type, p.legacy_path, p.metadata, a.depth + 1
      FROM public.aurore_pedagogical_nodes p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE p.active = true AND a.depth < 20
    )
    SELECT
      (SELECT name FROM ancestors WHERE node_type = 'level' ORDER BY depth LIMIT 1),
      (SELECT name FROM ancestors WHERE node_type = 'class' ORDER BY depth LIMIT 1),
      (
        SELECT CASE
          WHEN upper(btrim(name)) IN ('A','B','C','D','E','F','F1','F2','F3','F4','G','G1','G2','H') THEN upper(btrim(name))
          WHEN upper(btrim(coalesce(metadata->'compat'->>'sigle',''))) IN ('A','B','C','D','E','F','F1','F2','F3','F4','G','G1','G2','H') THEN upper(btrim(metadata->'compat'->>'sigle'))
          ELSE NULL
        END
        FROM ancestors
        WHERE node_type = 'series'
        ORDER BY depth
        LIMIT 1
      )
    INTO v_level, v_class, v_filiere;

    v_level := coalesce(nullif(btrim(v_level), ''), 'Culture générale');

    v_existing_id := NULL;
    IF v_course_id IS NOT NULL THEN
      SELECT nullif(item->>'document_id', '')::bigint INTO v_existing_id
      FROM jsonb_array_elements(v_previous_targets) item
      WHERE item->>'node_id' = v_node_id::text
        AND item->>'subject_id' = v_subject_id::text
        AND item->>'resource_type' = v_type
        AND nullif(item->>'document_id', '') IS NOT NULL
      LIMIT 1;
    END IF;

    IF v_existing_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public."Document" d
      WHERE d.id = v_existing_id
        AND d."Source" = 'Aurore — Content Factory'
    ) THEN
      v_existing_id := NULL;
    END IF;

    -- Older publications used the legacy RPC and left Genre unset. Reuse
    -- the previous Document ID when the selected pedagogical placement matches.
    IF v_existing_id IS NULL AND v_doc.published_document_id IS NOT NULL THEN
      SELECT d.id INTO v_existing_id
      FROM public."Document" d
      WHERE d.id = v_doc.published_document_id
        AND d."Source" = 'Aurore — Content Factory'
        AND d."Niveau" IS NOT DISTINCT FROM v_level
        AND d."Classe" IS NOT DISTINCT FROM v_class
        AND d."Filiere" IS NOT DISTINCT FROM v_filiere
        AND d."Matière" IS NOT DISTINCT FROM v_subject.name
        AND d."Catégorie" IS NOT DISTINCT FROM v_category
        AND (d."Genre" IS NULL OR d."Genre" IS NOT DISTINCT FROM v_type)
        AND coalesce(d."Publie", false) = true
        AND NOT (d.id = ANY(v_document_ids))
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_existing_id IS NULL THEN
      SELECT d.id INTO v_existing_id
      FROM public."Document" d
      WHERE lower(btrim(coalesce(d."Titre", ''))) = lower(btrim(v_doc.title))
        AND d."Niveau" IS NOT DISTINCT FROM v_level
        AND d."Classe" IS NOT DISTINCT FROM v_class
        AND d."Filiere" IS NOT DISTINCT FROM v_filiere
        AND d."Matière" IS NOT DISTINCT FROM v_subject.name
        AND d."Catégorie" IS NOT DISTINCT FROM v_category
        AND (d."Genre" IS NOT DISTINCT FROM v_type OR d."Genre" IS NULL)
        AND NOT (d.id = ANY(v_document_ids))
        AND d."Source" = 'Aurore — Content Factory'
        AND coalesce(d."Publie", false) = true
      ORDER BY d.id DESC
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public."Document" SET
        "Titre" = v_doc.title,
        "Niveau" = v_level,
        "Classe" = v_class,
        "Filiere" = v_filiere,
        "Matière" = v_subject.name,
        "Catégorie" = v_category,
        "Genre" = v_type,
        "Fichier_url" = v_doc.pdf_url,
        "Auteur" = 'Aurore',
        "Publie" = true,
        "Source" = 'Aurore — Content Factory',
        "Droits_confirmes" = true,
        "Telechargement_autorise" = true
      WHERE id = v_existing_id
      RETURNING id INTO v_document_id;
    ELSE
      INSERT INTO public."Document" (
        "Titre", "Niveau", "Classe", "Filiere", "Matière", "Catégorie",
        "Auteur", "Fichier_url", "Publie", "Source", "Droits_confirmes",
        "Genre", "Telechargement_autorise", "Mis_en_avant"
      ) VALUES (
        v_doc.title, v_level, v_class, v_filiere, v_subject.name, v_category,
        'Aurore', v_doc.pdf_url, true, 'Aurore — Content Factory', true,
        v_type, true, false
      )
      RETURNING id INTO v_document_id;
    END IF;

    v_document_ids := array_append(v_document_ids, v_document_id);
    v_targets_saved := v_targets_saved || jsonb_build_array(jsonb_build_object(
      'node_id', v_node_id,
      'legacy_path', v_node.legacy_path,
      'node_name', v_node.name,
      'subject_id', v_subject_id,
      'subject', v_subject.name,
      'resource_type', v_type,
      'category', v_category,
      'document_id', v_document_id
    ));
  END LOOP;

  -- Réconcilier les emplacements : une destination retirée n'est plus publiée,
  -- sauf si un autre document ou un autre cours la référence toujours.
  FOR v_old_target IN
    SELECT value FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_previous_targets) = 'array' THEN v_previous_targets ELSE '[]'::jsonb END
    )
  LOOP
    BEGIN
      v_old_document_id := nullif(v_old_target->>'document_id', '')::bigint;
    EXCEPTION WHEN OTHERS THEN
      v_old_document_id := NULL;
    END;

    IF v_old_document_id IS NOT NULL
       AND NOT (v_old_document_id = ANY(v_document_ids)) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.aurora_generated_documents other
        WHERE other.id <> v_doc.id
          AND other.status = 'published'
          AND (
            other.published_document_id = v_old_document_id
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(other.metadata #> '{publication,document_ids}') = 'array'
                    THEN other.metadata #> '{publication,document_ids}'
                  ELSE '[]'::jsonb
                END
              ) AS published_ids(value)
              WHERE published_ids.value #>> '{}' = v_old_document_id::text
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.aurora_assisted_courses other_course
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(other_course.pages #> '{course,workflow,publication_targets}') = 'array'
              THEN other_course.pages #> '{course,workflow,publication_targets}'
            ELSE '[]'::jsonb
          END
        ) AS course_targets(value)
        WHERE (v_course_id IS NULL OR other_course.id <> v_course_id)
          AND course_targets.value->>'document_id' = v_old_document_id::text
      ) THEN
        UPDATE public."Document"
        SET "Publie" = false
        WHERE id = v_old_document_id
          AND "Source" = 'Aurore — Content Factory'
          AND coalesce("Publie", false) = true;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.aurora_generated_documents
  SET status = CASE WHEN coalesce(array_length(v_document_ids, 1), 0) > 0 THEN 'published' ELSE 'review' END,
      published_document_id = CASE WHEN coalesce(array_length(v_document_ids, 1), 0) > 0 THEN v_document_ids[1] ELSE NULL END,
      validation_notes = coalesce(p_notes, validation_notes),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'publication', jsonb_build_object(
          'document_ids', to_jsonb(v_document_ids),
          'targets', v_targets_saved,
          'published_at', CASE WHEN coalesce(array_length(v_document_ids, 1), 0) > 0 THEN v_published_at ELSE NULL END,
          'updated_at', v_published_at,
          'notes', nullif(btrim(coalesce(p_notes, '')), '')
        )
      ),
      updated_at = v_published_at
  WHERE id = v_doc.id
  RETURNING * INTO v_doc;

  UPDATE public.aurora_content_jobs
  SET status = CASE WHEN coalesce(array_length(v_document_ids, 1), 0) > 0 THEN 'published' ELSE 'review' END,
      updated_at = v_published_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'published_document_ids', to_jsonb(v_document_ids),
        'published_at', v_published_at
      )
  WHERE id = v_doc.job_id;

  IF v_course_id IS NOT NULL THEN
    UPDATE public.aurora_assisted_courses
    SET pages = jsonb_set(
      coalesce(pages, '{}'::jsonb),
      '{course,workflow}',
      coalesce(pages #> '{course,workflow}', '{}'::jsonb) || jsonb_build_object(
        'publication_targets', v_targets_saved,
        'published_document_ids', to_jsonb(v_document_ids),
        'last_published_at', v_published_at
      ),
      true
    ),
    updated_at = v_published_at
    WHERE id = v_course_id;
  END IF;

  RETURN v_doc;
END;
$function$
;

-- QR resolver for assisted PDFs: expose only an ID that is currently public.
CREATE OR REPLACE FUNCTION public.aurora_resolve_assisted_public_document(p_course_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT generated.published_document_id
  FROM public.aurora_generated_documents AS generated
  JOIN public."Document" AS published
    ON published.id = generated.published_document_id
   AND coalesce(published."Publie", false) = true
  WHERE generated.status = 'published'
    AND lower(coalesce(generated.metadata->>'origin', '')) = 'edition_assistee'
    AND jsonb_typeof(generated.metadata->'assisted_final') = 'object'
    AND generated.metadata->'assisted_final'->>'course_id' = p_course_id::text
  ORDER BY generated.updated_at DESC, generated.id DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.aurora_resolve_assisted_public_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aurora_resolve_assisted_public_document(uuid) TO anon, authenticated;
