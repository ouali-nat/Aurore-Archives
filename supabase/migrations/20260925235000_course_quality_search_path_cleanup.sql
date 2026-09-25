-- Aurore Archives: security-linter cleanup for the canonical course-quality functions.

alter function public.aurora_validate_course_quality(jsonb,text,text,text,jsonb)
  set search_path = public, pg_temp;

alter function public.aurora_enforce_course_quality()
  set search_path = public, pg_temp;

-- Canonical quality rule remains enforced by the single trigger:
-- aurora_generated_documents_course_quality.
