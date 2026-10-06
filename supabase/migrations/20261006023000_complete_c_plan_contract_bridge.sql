CREATE OR REPLACE FUNCTION public.aurora_normalize_c_plan_field_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  wf jsonb := coalesce(new.metadata->'workflow','{}'::jsonb);
  proposal jsonb := wf->'proposal';
  stage text := coalesce(wf->>'stage','');
  v text;
  nested jsonb;
BEGIN
  IF stage NOT IN ('proposal_review','admin_validation','edition_ready')
     OR jsonb_typeof(proposal) <> 'object' THEN
    RETURN new;
  END IF;

  IF btrim(coalesce(proposal->>'chapter_alignment','')) = '' THEN
    v := btrim(coalesce(proposal->>'chapterAlignment',proposal->>'alignement_chapitre',''));
    IF v <> '' THEN proposal := jsonb_set(proposal,'{chapter_alignment}',to_jsonb(v),true); END IF;
  END IF;

  IF jsonb_typeof(proposal->'pdfTypography')='object' THEN
    v := btrim(coalesce(
      proposal->'pdfTypography'->>'value',
      proposal->'pdfTypography'->>'details',
      proposal->'pdfTypography'->>'text',
      proposal->'pdfTypography'->>'notes',''
    ));
  ELSE
    v := btrim(coalesce(proposal->>'pdfTypography',''));
  END IF;
  nested := CASE
    WHEN jsonb_typeof(proposal->'pdfTypographyControl')='object' THEN proposal->'pdfTypographyControl'
    ELSE '{}'::jsonb
  END;
  IF v = '' THEN
    v := btrim(coalesce(nested->>'value',nested->>'details',nested->>'text',nested->>'notes',''));
    IF v <> '' THEN proposal := jsonb_set(proposal,'{pdfTypography}',to_jsonb(v),true); END IF;
  END IF;
  IF v <> '' THEN
    nested := jsonb_set(nested,'{status}',to_jsonb('complete'::text),true);
    nested := jsonb_set(nested,'{value}',to_jsonb(v),true);
    nested := jsonb_set(nested,'{details}',to_jsonb(v),true);
    proposal := jsonb_set(proposal,'{pdfTypographyControl}',nested,true);
  END IF;

  v := btrim(coalesce(proposal->>'pdfHeaders',''));
  nested := CASE
    WHEN jsonb_typeof(proposal->'pdfHeadersFooters')='object' THEN proposal->'pdfHeadersFooters'
    ELSE '{}'::jsonb
  END;
  IF v = '' THEN
    v := btrim(coalesce(nested->>'value',nested->>'details',nested->>'text',nested->>'notes',''));
    IF v <> '' THEN proposal := jsonb_set(proposal,'{pdfHeaders}',to_jsonb(v),true); END IF;
  ELSE
    nested := jsonb_set(nested,'{status}',to_jsonb('complete'::text),true);
    nested := jsonb_set(nested,'{value}',to_jsonb(v),true);
    nested := jsonb_set(nested,'{details}',to_jsonb(v),true);
    proposal := jsonb_set(proposal,'{pdfHeadersFooters}',nested,true);
  END IF;

  v := btrim(coalesce(proposal->>'pdfResources',''));
  nested := CASE
    WHEN jsonb_typeof(proposal->'pdfResourcesQrAnnexes')='object' THEN proposal->'pdfResourcesQrAnnexes'
    ELSE '{}'::jsonb
  END;
  IF v = '' THEN
    v := btrim(coalesce(nested->>'value',nested->>'details',nested->>'text',nested->>'notes',''));
    IF v <> '' THEN proposal := jsonb_set(proposal,'{pdfResources}',to_jsonb(v),true); END IF;
  ELSE
    nested := jsonb_set(nested,'{status}',to_jsonb('complete'::text),true);
    nested := jsonb_set(nested,'{value}',to_jsonb(v),true);
    nested := jsonb_set(nested,'{details}',to_jsonb(v),true);
    proposal := jsonb_set(proposal,'{pdfResourcesQrAnnexes}',nested,true);
  END IF;

  nested := CASE
    WHEN jsonb_typeof(proposal->'editorialNotes')='object' THEN proposal->'editorialNotes'
    ELSE '{}'::jsonb
  END;
  v := btrim(coalesce(proposal->>'notes',''));
  IF v = '' THEN
    v := btrim(coalesce(nested->>'notes',nested->>'value',nested->>'details',nested->>'text',''));
    IF v <> '' THEN proposal := jsonb_set(proposal,'{notes}',to_jsonb(v),true); END IF;
  ELSE
    nested := jsonb_set(nested,'{status}',to_jsonb('complete'::text),true);
    nested := jsonb_set(nested,'{notes}',to_jsonb(v),true);
    proposal := jsonb_set(proposal,'{editorialNotes}',nested,true);
  END IF;

  new.metadata := jsonb_set(coalesce(new.metadata,'{}'::jsonb),'{workflow,proposal}',proposal,true);
  RETURN new;
END;
$function$;