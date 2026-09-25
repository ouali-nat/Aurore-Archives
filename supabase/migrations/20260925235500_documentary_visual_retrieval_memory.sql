-- Aurore Archives: durable memory rule for reliable Wikimedia retrieval.

insert into public.aurora_editorial_memory
  (rule_key,version,title,priority,mandatory,active,content)
values
(
 'documentary_visual_retrieval',1,
 'Fiabilisation des requêtes Wikimedia dans les cours',
 997,true,true,
 '{
   "scope":"Cours non mathématiques avec visual_plan documentaire.",
   "rules":[
     "Chaque visuel build doit viser un document réellement pertinent pour la section, jamais une image décorative ou seulement vaguement liée.",
     "Les requêtes Wikimedia doivent privilégier les identifiants archivistiques, noms de fichiers connus, catégories, dates et lieux discriminants lorsque disponibles.",
     "Éviter les requêtes trop longues composées de nombreux synonymes ou de formulations éditoriales ; elles peuvent produire des résultats hors sujet ou aucun candidat.",
     "Après sélection, vérifier que le titre, la description ou les catégories du fichier correspondent au sujet pédagogique demandé.",
     "Un visuel manquant ou hors sujet doit entraîner une correction du plan avant PDF ; on ne contourne pas le garde-fou en baissant simplement required."
   ],
   "quality_priority":"relevance_before_decoration"
 }'::jsonb
)
on conflict (rule_key,version) do update set
 title=excluded.title,priority=excluded.priority,mandatory=excluded.mandatory,
 active=true,content=excluded.content,updated_at=now();
