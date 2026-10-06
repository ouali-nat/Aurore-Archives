CREATE OR REPLACE FUNCTION public.aurora_guard_c_plan_complete_before_cx()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  wf jsonb := coalesce(new.metadata->'workflow','{}'::jsonb);
  proposal jsonb := wf->'proposal';
  selected jsonb := wf->'selected_chapters';
  required_key text;
  selected_title text;
  selected_chapter text;
  alignment text := btrim(coalesce(proposal->>'chapter_alignment',''));
  new_stage text := coalesce(wf->>'stage','');
  old_stage text := CASE
    WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.metadata->'workflow'->>'stage','')
    ELSE ''
  END;
  proposal_status text := coalesce(wf->>'proposal_status','');
  required_keys text[] := ARRAY[
    'researchMethod','curricularBasis','researchFindings','sources',
    'title','chapter','chapter_alignment','objectives','competencies',
    'prerequisites','progression','architecture','productionStrategy',
    'content','methods','activities','examples','situations','exercises',
    'corrections','differentiation','evaluation','volume','duration',
    'resources','mathGeoGebra','technicalNeeds','pdfFormat',
    'pdfOrientation','pdfPagination','pdfThemeColor','pdfLayout',
    'pdfTypography','pdfFonts','pdfHeaders','pdfResources',
    'qualityMathematicalAccuracy','qualityDisciplinaryProgression',
    'qualityExplicitReasoning','qualityNoRepetition',
    'qualityScientificGuardrails','quality','notes',
    'qualityControlExpected','pdfTypographyControl',
    'pdfHeadersFooters','pdfResourcesQrAnnexes','editorialNotes'
  ];
  missing text[] := ARRAY[]::text[];
  should_enforce boolean := false;
  nested_value text;
BEGIN
  IF new_stage IN ('proposal_review','admin_validation','edition_ready') THEN
    should_enforce :=
      TG_OP = 'INSERT'
      OR old_stage NOT IN ('proposal_review','admin_validation','edition_ready')
      OR proposal_status IN ('ready_for_admin_validation','validated_for_editing');
  END IF;

  IF should_enforce THEN
    IF jsonb_typeof(proposal) <> 'object' THEN
      RAISE EXCEPTION 'C_GUARD_BLOCKED: workflow.proposal obligatoire avant CX.';
    END IF;

    FOREACH required_key IN ARRAY required_keys LOOP
      IF NOT (proposal ? required_key) THEN
        missing := array_append(missing, required_key);
      ELSIF required_key IN (
        'qualityControlExpected','pdfTypographyControl',
        'pdfHeadersFooters','pdfResourcesQrAnnexes','editorialNotes'
      ) THEN
        IF jsonb_typeof(proposal->required_key) <> 'object' THEN
          missing := array_append(missing, required_key);
        ELSE
          nested_value := btrim(coalesce(
            proposal->required_key->>'value',
            proposal->required_key->>'details',
            proposal->required_key->>'text',
            proposal->required_key->>'notes',
            ''
          ));
          IF lower(coalesce(proposal->required_key->>'status','')) <> 'complete'
             OR nested_value = '' THEN
            missing := array_append(missing, required_key);
          END IF;
        END IF;
      ELSIF btrim(coalesce(proposal->>required_key,'')) = '' THEN
        missing := array_append(missing, required_key);
      ELSIF lower(btrim(coalesce(proposal->>required_key,''))) IN (
        'à compléter','a completer','à préciser','a preciser',
        'à renseigner','a renseigner','n/a','na',
        'non défini','non defini','non renseigné','non renseigne',
        'à déterminer','a determiner'
      ) THEN
        missing := array_append(missing, required_key);
      END IF;
    END LOOP;

    IF jsonb_typeof(selected) <> 'array' OR jsonb_array_length(selected) = 0 THEN
      missing := array_append(missing, 'selected_chapters');
    ELSE
      IF alignment = '' THEN
        missing := array_append(missing, 'chapter_alignment');
      ELSE
        FOR selected_title, selected_chapter IN
          SELECT lower(btrim(coalesce(value->>'title',value->>'name',''))),
                 lower(btrim(coalesce(value->>'chapter','')))
          FROM jsonb_array_elements(selected)
        LOOP
          IF selected_title = '' AND selected_chapter = '' THEN
            missing := array_append(missing, 'selected_chapters');
          ELSIF
            (selected_title <> '' AND position(selected_title in lower(alignment)) = 0)
            AND (selected_chapter = '' OR position(selected_chapter in lower(alignment)) = 0)
          THEN
            missing := array_append(missing, 'chapter_alignment');
          END IF;
        END LOOP;
      END IF;
    END IF;

    IF length(btrim(coalesce(proposal->>'researchMethod',''))) < 20 THEN missing := array_append(missing, 'researchMethod'); END IF;
    IF length(btrim(coalesce(proposal->>'curricularBasis',''))) < 20 THEN missing := array_append(missing, 'curricularBasis'); END IF;
    IF length(btrim(coalesce(proposal->>'researchFindings',''))) < 40 THEN missing := array_append(missing, 'researchFindings'); END IF;
    IF length(btrim(coalesce(proposal->>'sources',''))) < 20 THEN missing := array_append(missing, 'sources'); END IF;
    IF length(btrim(coalesce(proposal->>'quality',''))) < 40 THEN missing := array_append(missing, 'quality'); END IF;
    IF length(btrim(coalesce(proposal->>'notes',''))) < 10 THEN missing := array_append(missing, 'notes'); END IF;

    IF lower(coalesce(proposal->'qualityControlExpected'->>'status','')) <> 'complete'
       OR btrim(coalesce(proposal->'qualityControlExpected'->>'mathematical_accuracy','')) = ''
       OR btrim(coalesce(proposal->'qualityControlExpected'->>'disciplinary_progression','')) = ''
       OR btrim(coalesce(proposal->'qualityControlExpected'->>'explicit_reasoning','')) = ''
       OR btrim(coalesce(proposal->'qualityControlExpected'->>'no_repetition','')) = ''
       OR btrim(coalesce(proposal->'qualityControlExpected'->>'scientific_guardrails','')) = ''
    THEN missing := array_append(missing, 'qualityControlExpected'); END IF;

    IF lower(coalesce(proposal->'pdfTypographyControl'->>'status','')) <> 'complete'
       OR btrim(coalesce(
         proposal->'pdfTypographyControl'->>'value',
         proposal->'pdfTypographyControl'->>'details',
         proposal->'pdfTypographyControl'->>'text',''
       )) = ''
    THEN missing := array_append(missing, 'pdfTypographyControl'); END IF;

    IF lower(coalesce(proposal->'pdfHeadersFooters'->>'status','')) <> 'complete'
       OR btrim(coalesce(
         proposal->'pdfHeadersFooters'->>'value',
         proposal->'pdfHeadersFooters'->>'details',
         proposal->'pdfHeadersFooters'->>'text',
         proposal->'pdfHeadersFooters'->>'notes',''
       )) = ''
    THEN missing := array_append(missing, 'pdfHeadersFooters'); END IF;

    IF lower(coalesce(proposal->'pdfResourcesQrAnnexes'->>'status','')) <> 'complete'
       OR btrim(coalesce(
         proposal->'pdfResourcesQrAnnexes'->>'value',
         proposal->'pdfResourcesQrAnnexes'->>'details',
         proposal->'pdfResourcesQrAnnexes'->>'text',
         proposal->'pdfResourcesQrAnnexes'->>'notes',''
       )) = ''
    THEN missing := array_append(missing, 'pdfResourcesQrAnnexes'); END IF;

    IF lower(coalesce(proposal->'editorialNotes'->>'status','')) <> 'complete'
       OR btrim(coalesce(
         proposal->'editorialNotes'->>'notes',
         proposal->'editorialNotes'->>'value',
         proposal->'editorialNotes'->>'details',
         proposal->'editorialNotes'->>'text',''
       )) = ''
    THEN missing := array_append(missing, 'editorialNotes'); END IF;

    IF btrim(coalesce(proposal->>'pdfHeaders','')) = '' THEN missing := array_append(missing, 'pdfHeaders'); END IF;
    IF btrim(coalesce(proposal->>'pdfResources','')) = '' THEN missing := array_append(missing, 'pdfResources'); END IF;
    IF coalesce(wf->>'plan_version','') <> 'c-plan-guardrails-v2' THEN missing := array_append(missing, 'plan_version'); END IF;

    missing := ARRAY(
      SELECT DISTINCT x FROM unnest(missing) AS u(x)
      WHERE btrim(coalesce(x,'')) <> ''
    );

    IF coalesce(array_length(missing,1),0) > 0 THEN
      RAISE EXCEPTION 'C_GUARD_BLOCKED: champs C incomplets: %',
        array_to_string(
          ARRAY(
            SELECT CASE x
              WHEN 'chapter_alignment' THEN 'chapter_alignment — Alignement B → C'
              WHEN 'pdfHeadersFooters' THEN 'pdfHeadersFooters — En-têtes / pieds de page PDF'
              WHEN 'pdfResourcesQrAnnexes' THEN 'pdfResourcesQrAnnexes — Ressources PDF / QR / annexes'
              WHEN 'pdfHeaders' THEN 'pdfHeaders — En-têtes / pieds de page PDF'
              WHEN 'pdfResources' THEN 'pdfResources — Ressources PDF / QR / annexes'
              WHEN 'selected_chapters' THEN 'selected_chapters — sélection B'
              WHEN 'qualityControlExpected' THEN 'qualityControlExpected — contrôle qualité attendu'
              WHEN 'pdfTypographyControl' THEN 'pdfTypographyControl — contrôle typographique PDF'
              WHEN 'editorialNotes' THEN 'editorialNotes — notes éditoriales'
              WHEN 'plan_version' THEN 'plan_version — version certifiée'
              ELSE x END
            FROM unnest(missing) AS m(x)
          ), ', '
        );
    END IF;
  END IF;

  RETURN new;
END;
$function$;