-- Aurore Archives: keep one canonical course quality trigger.
-- The older v1 trigger predated the canonical course_quality_gate metadata.
-- Applied to production Supabase as course_quality_single_canonical_trigger_20260925.

drop trigger if exists trg_aurora_course_quality_v1
on public.aurora_generated_documents;

-- Populate the persisted quality proof for the repaired Hitler course.
update public.aurora_generated_documents d
set metadata = coalesce(d.metadata,'{}'::jsonb)
  || jsonb_build_object(
       'course_quality_gate',
       public.aurora_validate_course_quality(
         d.content_json,d.title,coalesce(d.subject,d.matiere,''),d.document_type,coalesce(d.metadata,'{}'::jsonb)
       )
     ),
    updated_at=now()
where d.id=372;
