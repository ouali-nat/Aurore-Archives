-- Aurore: C plan completeness guard v2
create or replace function public.aurora_guard_c_plan_complete_before_cx()
returns trigger language plpgsql set search_path to ''
as $function$
declare
 wf jsonb:=coalesce(new.metadata->'workflow','{}'::jsonb); proposal jsonb:=wf->'proposal'; selected jsonb:=wf->'selected_chapters'; required_key text;
 required_keys text[]:=array['researchMethod','curricularBasis','researchFindings','sources','title','chapter','objectives','competencies','prerequisites','progression','architecture','productionStrategy','content','methods','activities','examples','situations','exercises','corrections','differentiation','evaluation','volume','duration','resources','mathGeoGebra','technicalNeeds','pdfFormat','pdfOrientation','pdfPagination','pdfThemeColor','pdfLayout','pdfTypography','pdfFonts','pdfHeaders','pdfResources','qualityMathematicalAccuracy','qualityDisciplinaryProgression','qualityExplicitReasoning','qualityNoRepetition','qualityScientificGuardrails','quality','notes','qualityControlExpected','pdfTypographyControl','pdfHeadersFooters','pdfResourcesQrAnnexes','editorialNotes'];
 chapter_name text; selected_title text; selected_chapter text;
begin
 if coalesce(wf->>'stage','') in ('proposal_review','admin_validation','edition_ready') then
  if jsonb_typeof(proposal)<>'object' then raise exception 'C_GUARD_BLOCKED: workflow.proposal obligatoire avant CX.'; end if;
  foreach required_key in array required_keys loop
   if not (proposal ? required_key) then raise exception 'C_GUARD_BLOCKED: champ C obligatoire absent: %',required_key; end if;
   if required_key in ('qualityControlExpected','pdfTypographyControl','pdfHeadersFooters','pdfResourcesQrAnnexes','editorialNotes') then
    if jsonb_typeof(proposal->required_key)<>'object' then raise exception 'C_GUARD_BLOCKED: champ C % doit être un objet.',required_key; end if;
   elsif btrim(coalesce(proposal->>required_key,''))='' then raise exception 'C_GUARD_BLOCKED: champ C obligatoire vide: %',required_key; end if;
  end loop;
  if jsonb_typeof(selected)<>'array' or jsonb_array_length(selected)=0 then raise exception 'C_GUARD_BLOCKED: sélection B obligatoire.'; end if;
  chapter_name:=lower(btrim(coalesce(proposal->>'chapter','')));
  for selected_title,selected_chapter in select lower(btrim(coalesce(value->>'title',value->>'name',''))),lower(btrim(coalesce(value->>'chapter',''))) from jsonb_array_elements(selected) loop
   if selected_title='' and selected_chapter='' then raise exception 'C_GUARD_BLOCKED: entrée de sélection B sans titre ni chapitre.'; end if;
   if selected_title<>'' and position(selected_title in chapter_name)=0 and (selected_chapter='' or position(selected_chapter in chapter_name)=0) then raise exception 'C_GUARD_BLOCKED: chapter ne couvre pas la sélection B.'; end if;
  end loop;
  if length(btrim(coalesce(proposal->>'researchMethod','')))<20 then raise exception 'C_GUARD_BLOCKED: researchMethod insuffisant.'; end if;
  if length(btrim(coalesce(proposal->>'curricularBasis','')))<20 then raise exception 'C_GUARD_BLOCKED: curricularBasis insuffisant.'; end if;
  if length(btrim(coalesce(proposal->>'researchFindings','')))<40 then raise exception 'C_GUARD_BLOCKED: researchFindings insuffisant.'; end if;
  if length(btrim(coalesce(proposal->>'sources','')))<20 then raise exception 'C_GUARD_BLOCKED: sources insuffisantes.'; end if;
  if length(btrim(coalesce(proposal->>'quality','')))<40 then raise exception 'C_GUARD_BLOCKED: quality insuffisant.'; end if;
  if length(btrim(coalesce(proposal->>'notes','')))<10 then raise exception 'C_GUARD_BLOCKED: notes obligatoires.'; end if;
  if lower(coalesce(proposal->'qualityControlExpected'->>'status',''))<>'complete' or btrim(coalesce(proposal->'qualityControlExpected'->>'mathematical_accuracy',''))='' or btrim(coalesce(proposal->'qualityControlExpected'->>'disciplinary_progression',''))='' or btrim(coalesce(proposal->'qualityControlExpected'->>'explicit_reasoning',''))='' or btrim(coalesce(proposal->'qualityControlExpected'->>'no_repetition',''))='' or btrim(coalesce(proposal->'qualityControlExpected'->>'scientific_guardrails',''))='' then raise exception 'C_GUARD_BLOCKED: qualityControlExpected incomplet.'; end if;
  if lower(coalesce(proposal->'pdfTypographyControl'->>'status',''))<>'complete' or btrim(coalesce(proposal->'pdfTypographyControl'->>'details',''))='' then raise exception 'C_GUARD_BLOCKED: pdfTypographyControl incomplet.'; end if;
  if lower(coalesce(proposal->'pdfHeadersFooters'->>'status',''))<>'complete' or btrim(coalesce(proposal->'pdfHeadersFooters'->>'details',''))='' then raise exception 'C_GUARD_BLOCKED: pdfHeadersFooters incomplet.'; end if;
  if lower(coalesce(proposal->'pdfResourcesQrAnnexes'->>'status',''))<>'complete' or btrim(coalesce(proposal->'pdfResourcesQrAnnexes'->>'details',''))='' then raise exception 'C_GUARD_BLOCKED: pdfResourcesQrAnnexes incomplet.'; end if;
  if lower(coalesce(proposal->'editorialNotes'->>'status',''))<>'complete' or btrim(coalesce(proposal->'editorialNotes'->>'notes',''))='' then raise exception 'C_GUARD_BLOCKED: editorialNotes incomplet.'; end if;
  if lower(coalesce(wf->>'plan_version',''))<>'c-plan-guardrails-v2' then raise exception 'C_GUARD_BLOCKED: version du plan C non certifiée.'; end if;
 end if;
 return new;
end;
$function$;