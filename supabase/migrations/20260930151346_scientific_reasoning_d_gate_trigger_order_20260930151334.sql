-- Aurore Archives — D scientific reasoning gate: trigger order hardening.
-- 00_connector_normalize doit d'abord canoniser le contenu ; le garde-fou D
-- doit ensuite s'exécuter avant les autres contrôles métier, notamment avant
-- le préflight scientifique générique, afin de rendre le diagnostic pédagogique
-- prioritaire et d'empêcher toute insertion d'un contenu insuffisamment expliqué.

drop trigger if exists aurora_generated_documents_scientific_reasoning_d
on public.aurora_generated_documents;

drop trigger if exists aurora_generated_documents_01_scientific_reasoning_d
on public.aurora_generated_documents;

create trigger aurora_generated_documents_01_scientific_reasoning_d
before insert or update of content_json, subject, matiere, document_type, level, class_name, metadata
on public.aurora_generated_documents
for each row execute function public.aurora_enforce_scientific_reasoning_d_gate();
