-- Aurore Archives: align course and exercise editorial presentation with the validated reference.
-- Editorial layer only. No renderer, PDF lifecycle, auth, storage, or publication changes.

update public.aurora_editorial_memory
set active=false, updated_at=now()
where rule_key='exercise_series_profile' and active=true;

insert into public.aurora_editorial_memory
(rule_key,version,title,priority,mandatory,active,content)
values
('exercise_series_profile',3,'Profil éditorial renforcé — exercices Maths et Physique-Chimie, présentation de référence',1985,true,true,
'{
  "scope":["exercices","séries d’exercices","devoirs","séries corrigées","corrigés"],
  "principle":"La présentation doit reprendre le niveau de construction pédagogique obtenu dans le cours de référence : chaque exercice doit être un objet d’apprentissage complet, progressif, lisible et réellement résolu.",
  "maths_and_physchem":{
    "required_when_subject":["Mathématiques","Physique-Chimie","Physique","Chimie","Sciences physiques","PC"],
    "structure":["objectif ou compétence mobilisée","énoncé contextualisé lorsque pertinent","questions numérotées et isolées","progression du simple vers le raisonnement","correction rattachée exactement aux questions","calculs et transformations isolés","résultat explicite","interprétation ou conclusion"]
  },
  "presentation_rules":[
    "Chaque exercice commence par un objectif pédagogique identifiable, explicite ou naturellement déductible de l’énoncé.",
    "Un exercice substantiel doit comporter plusieurs étapes réellement utiles lorsque le sujet s’y prête : identification, méthode, calcul ou raisonnement, vérification et conclusion.",
    "Chaque question numérotée constitue une unité visuelle distincte.",
    "Chaque sous-question correspondant à une étape différente doit être séparée.",
    "Les calculs importants doivent être présentés sur des lignes ou blocs distincts et non noyés dans la prose.",
    "La correction doit conserver les mêmes données, notations, conditions et numéros de questions que l’énoncé.",
    "Une correction doit montrer le raisonnement et les étapes essentielles, pas seulement la réponse finale.",
    "Les résultats numériques doivent comporter leur unité lorsque la grandeur en possède une et être interprétés lorsque cela est pertinent.",
    "Les propriétés, théorèmes, lois ou relations utilisées doivent être identifiés lorsqu’ils sont nécessaires à la compréhension.",
    "Les exemples de calcul doivent être réellement effectués.",
    "La difficulté doit progresser à l’intérieur de l’exercice lorsque cela améliore l’apprentissage.",
    "Les exercices doivent être variés par compétence et non par simple changement artificiel de nombres.",
    "Le corrigé doit pouvoir être utilisé comme support d’apprentissage autonome par un élève."
  ],
  "maths":[
    "Utiliser du LaTeX mathématique authentique et exploitable.",
    "Isoler les manipulations mathématiques importantes ligne par ligne.",
    "Utiliser implication ou équivalence uniquement lorsque le raisonnement les justifie.",
    "Pour une démonstration, montrer les étapes et les justifications.",
    "Utiliser GeoGebra uniquement lorsqu’une représentation apporte une vraie valeur mathématique."
  ],
  "physique_chimie":[
    "Articuler relation ou équation, grandeurs et unités, transformation ou établissement, application numérique ou bilan, résultat avec unité et interprétation.",
    "Montrer les substitutions numériques et transformations d’unités lorsqu’elles sont nécessaires.",
    "Pour une loi ou une relation, expliquer son usage et ses conditions lorsque pertinent.",
    "Pour les bilans et réactions chimiques, conserver explicitement les éléments utiles au niveau visé.",
    "Pour une expérience ou situation physique, distinguer données, modèle, calcul, résultat et interprétation.",
    "Utiliser GeoGebra uniquement lorsqu’une représentation quantitative apporte une vraie valeur."
  ],
  "quality_over_quantity":{
    "required_exercise_count":"2 à 4 exercices substantiels selon le sujet et le niveau.",
    "anti_patterns":["20 exercices superficiels","découpage artificiel","corrections d’une ligne","prose de remplissage","répétition du même calcul","formules décoratives"]
  }
}'::jsonb)
on conflict(rule_key,version) do update set
 title=excluded.title,priority=excluded.priority,mandatory=excluded.mandatory,active=true,content=excluded.content,updated_at=now();

update public.aurora_editorial_subject_profiles
set version=3,
content=jsonb_build_object(
 'schema_version','physique-chimie-editorial-profile-2',
 'hard_gate',true,
 'mode','quantitative_calculatoire',
 'reference_presentation','Appliquer au cours de Physique-Chimie la même qualité de construction que le cours de référence : progression réelle, notions construites avant leur mobilisation, relations et équations expliquées, manipulations isolées, applications numériques réellement calculées, interprétation, conditions de validité, erreurs fréquentes et synthèse.',
 'generation_structure',jsonb_build_array(
   'introduction et objectifs','prérequis ou repères','notion/loi/phénomène',
   'définition des grandeurs et unités','relation ou équation',
   'établissement ou démonstration lorsque pertinent','exemple réellement calculé',
   'application','interprétation','limites/conditions de validité','synthèse'
 ),
 'constraints',jsonb_build_object(
   'minimum_scientific_relations',8,'minimum_calculation_blocks',6,
   'minimum_demonstration_blocks',2,'minimum_scientific_block_ratio',0.55,
   'minimum_scientific_word_ratio',0.70,'minimum_quantitative_work_word_ratio',0.35,
   'maximum_narrative_only_word_ratio',0.25,'maximum_narrative_only_block_ratio',0.25
 ),
 'rules',jsonb_build_array(
   'La prose soutient le raisonnement scientifique et ne remplace jamais les relations, calculs, bilans ou démonstrations.',
   'Chaque grande partie doit apporter une notion ou compétence identifiable.',
   'Une notion importante est construite avant d’être utilisée.',
   'Les formules sont accompagnées de la définition des grandeurs et unités lorsqu’elles sont nécessaires.',
   'Les transformations, substitutions, calculs et unités apparaissent explicitement lorsqu’ils sont pertinents.',
   'Les applications numériques montrent les données, la relation, la substitution, le résultat avec unité et son interprétation.',
   'Une démonstration ou un établissement important ne doit pas être remplacé par une conclusion verbale.',
   'Les réactions chimiques et bilans sont présentés explicitement lorsque le sujet les implique.',
   'Les erreurs fréquentes, limites et conditions de validité sont signalées lorsqu’elles sont pédagogiquement pertinentes.',
   'Les formules, calculs et démonstrations sont distribués en blocs lisibles.',
   'GeoGebra est utilisé uniquement lorsqu’il apporte une vraie valeur pédagogique.',
   'Aucun remplissage narratif ne sert à atteindre le volume minimal.'
 ),
 'anti_patterns',jsonb_build_array(
   'cours de physique-chimie rédigé comme un cours littéraire avec quelques formules',
   'longues explications sans relation, calcul, unité, bilan ou raisonnement scientifique',
   'formule donnée sans manipulation ou application lorsqu’un calcul est attendu',
   'exemples annoncés mais non calculés','répétition de conclusions pour augmenter le volume',
   'bloc majoritairement narratif contenant une seule formule'
 )
)
where subject_key='physique-chimie';

update public.aurora_editorial_memory
set active=false,updated_at=now()
where rule_key='course_quality_contract' and active=true;

insert into public.aurora_editorial_memory
(rule_key,version,title,priority,mandatory,active,content)
values
('course_quality_contract',3,'Contrat qualité bloquant des cours — présentation pédagogique de référence',998,true,true,
'{
 "scope":"Tous les documents document_type=cours.",
 "hard_gate":true,
 "minimum_useful_words":3000,
 "introduction":{"required":true,"minimum_characters":80},
 "presentation_reference":[
   "Construire une progression pédagogique réelle adaptée au sujet et au niveau.",
   "Présenter une notion avant de la mobiliser.",
   "Articuler lorsque pertinent définition/principe, explication, formulation scientifique ou formule, interprétation, exemple réellement développé, application, conditions de validité et synthèse.",
   "Isoler les calculs et manipulations importantes.",
   "Utiliser de vraies formules LaTeX lorsqu’une notation mathématique ou scientifique est requise.",
   "Ne jamais atteindre le volume par répétitions, paraphrases artificielles ou prose générique.",
   "Adapter la structure à la discipline : la qualité de présentation est commune, le contenu scientifique reste spécifique à chaque matière."
 ],
 "short_course_exception":{"allowed":true,"format_profile":"short_course","reason_field":"course_quality.short_format_reason","minimum_reason_characters":30,"silent_exception_forbidden":true}
}'::jsonb)
on conflict(rule_key,version) do update set
 title=excluded.title,priority=excluded.priority,mandatory=excluded.mandatory,active=true,content=excluded.content,updated_at=now();
