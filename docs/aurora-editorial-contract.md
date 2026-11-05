
# Aurore — contrat éditorial v2

## Circuit de production

Le circuit sépare volontairement deux responsabilités : ChatGPT prépare le manuscrit pédagogique structuré, puis Aurore valide le JSON et assure la production PDF avec le pipeline LuaLaTeX/GeoGebra. La publication reste une action humaine.

## Mémoire obligatoire avant injection

Avant toute injection provenant de l’édition ChatGPT, l’assistante doit appeler la fonction Edge aurora-editorial-memory avec la matière et le type de document. Le service récupère la mémoire générale Aurore et, lorsque la matière est Mathématiques, récupère également la mémoire spécialisée Mathématiques.

Le service ouvre alors une session mémoire à usage unique, valable pendant une fenêtre limitée. La réponse fournit les règles nécessaires, leurs versions, une empreinte du paquet mémoire, le profil disciplinaire actif et un session_id. L’assistante doit lire ce paquet avant de produire le contenu, puis transmettre le session_id et le memory_session_token dans memory_session_id et memory_session_token ainsi qu’une attestation editorial_memory_ack lors de l’appel suivant à aurora-gpt-ingest.

L’attestation doit correspondre à la session, à l’empreinte du paquet, aux identifiants de règles reçus et au profil disciplinaire ; une empreinte SHA-256 liée à la session empêche une simple déclaration textuelle de contourner cette étape. Tant que l’attestation n’est pas valide, l’ingestion refuse de progresser. Une seconde barrière existe directement sur aurora_generated_documents : toute insertion portant l’origine gpt_editorial_ingest sans session mémoire et preuve de lecture valides est bloquée par la base.

Pour les Mathématiques, l’insertion est bloquée tant qu’une mémoire générale et la mémoire Mathématiques n’ont pas toutes deux été récupérées dans la même session.

## Mémoire générale Aurore

La table aurora_editorial_memory contient les règles versionnées relatives à la chaîne éditoriale, à la structure des cours, à la qualité pédagogique, aux exercices et corrigés, aux graphiques/visuels, au contrôle PDF et à la traçabilité.

## Mémoire Mathématiques

La table aurora_math_editorial_memory contient les règles spécifiques aux documents mathématiques : séparation des blocs, formules, syntaxe LaTeX sûre, progression pédagogique, anti-patterns connus et contrôle qualité du PDF.

La mémoire mathématique reprend notamment les leçons de la production du document 364 : une validité JSON minimale ne garantit pas une bonne composition PDF ; les formules importantes doivent être suffisamment structurées, les blocs trop monolithiques doivent être évités et les répétitions doivent être détectées avant rendu.

## Contrat aurora-editorial-1

Le pont conserve les champs établis par le contrat précédent : ingest_id, title, subject, level, class_name, document_type, prompt, classification et content_json.

content_json doit contenir title, sections[] avec au minimum title, sections[].content[], sections[].graphs[] pour les graphiques/constructions, sections[].visuals[] pour les illustrations documentaires et corrections[] au besoin.

## Visuels

Les illustrations documentaires utilisent type wikimedia et une fonction pédagogique explicite. Les limites restent de 3 visuels maximum par section, 8 visuels maximum par document et 24 graphiques/constructions maximum par document.


## Barrière qualité des cours

Pour document_type=cours, le contrat est désormais bloquant sur plusieurs axes avant insertion : une introduction pédagogique explicite d’au moins 80 caractères, au moins 3000 mots utiles pour un cours standard, et, hors Mathématiques, un plan documentaire Wikimedia explicite couvrant chaque section. Pour les matières Physique, Chimie, Physique-Chimie, Sciences physiques ou PC, le profil disciplinaire physique-chimie impose en plus une structure quantitative et calculatoire : relations/formules, calculs/manipulations, démonstrations ou établissements et une densité scientifique minimale contrôlée à la fois par blocs et par volume de mots (au moins 70 % des mots dans des blocs scientifiques et au moins 35 % dans des blocs de calcul/manipulation ou démonstration), avec rejet si le contenu reste principalement narratif.

Le seul raccourci autorisé est un format court explicitement déclaré avec `course_quality.format_profile=short_course` et une justification `course_quality.short_format_reason` d’au moins 30 caractères. Il est interdit de déduire ou de déclarer silencieusement une exception.

Le contrôle est appliqué par PostgreSQL sur les insertions et les changements de contenu d’un cours, quelle que soit la voie de création. Les documents directs, administratifs ou manuels ne peuvent donc plus contourner la barrière éditoriale.

## Séparation stricte des moteurs visuels

`no_svg_automatic` signifie uniquement qu’aucune génération automatique d’Aurore SVG ne doit être lancée. Cela ne désactive ni Wikimedia Commons ni GeoGebra. Pour un cours documentaire, le plan Wikimedia reste obligatoire ; pour les représentations scientifiques calculables, GeoGebra reste indépendant et peut être combiné avec Wikimedia.

## Idempotence et traçabilité

ingest_id reste stable pendant les retries réseau et empêche la duplication. Lorsqu’un document est injecté, Aurore conserve dans metadata.memory_gate la preuve de la session mémoire utilisée : identifiant de session, versions des mémoires, identifiants des règles et empreinte du paquet mémoire.

La table aurora_editorial_memory_sessions conserve l’historique technique de chaque récupération et empêche la réutilisation d’une session consommée.

## Barrière scientifique finale D → Documents en attente

Le contenu scientifique final est soumis à un garde-fou indépendant au dernier passage de D vers « Documents en attente ». Cette vérification est exécutée sur le `content_json` réellement destiné à l’ingestion, et non sur la seule fiche C. Ainsi, un éventuel contournement de C → D ne permet pas de faire entrer dans le sas un cours scientifique qui serait resté une suite de formules ou de résultats.

Pour les Mathématiques, la Physique, la Chimie, la Physique-Chimie et les autres documents scientifiques couverts, le contrôle exige des traces de définition/identification, d’explication, de méthode, de raisonnement étape par étape, d’exemple/application et d’interprétation. Il détecte notamment les lacunes entre blocs mathématiques, les séquences de formules sans liaison explicative et l’absence de vocabulaire de raisonnement. Le préflight scientifique canonique est enrichi par `public.aurora_scientific_reasoning_preflight(...)`, puis le trigger PostgreSQL sur `aurora_generated_documents` transforme tout échec en refus d’insertion.

Le bouton D ne constitue donc qu’un déclencheur de contrôle : la véritable autorité est la barrière serveur. Une édition refusée reste en D, reçoit le diagnostic des contrôles échoués et doit être corrigée avant toute entrée dans le circuit PDF manuel.

## Cycle des statuts

draft : demande non confirmée.
queued : demande confirmée, en attente.
review : contenu éditorial intégré, contrôle humain / rendu PDF disponibles.
approved : validation du contenu/PDF.
published : publication effectuée.
failed / rejected : arrêt nécessitant une nouvelle action.

Le PDF est produit après l’intégration du contenu, jamais comme une étape de génération de texte.

## Intégration d’un futur document

récupération mémoire → édition ChatGPT → validation JSON → aurora-gpt-ingest avec session mémoire → sas administratif → ressources/GeoGebra → LuaLaTeX → vérification PDF → contrôle humain → publication.

La récupération mémoire n’est donc plus une simple recommandation éditoriale : elle constitue une précondition technique d’insertion pour les documents issus de l’édition ChatGPT.

## Présentation de référence — cours PC et exercices Maths/PC

Le niveau de construction pédagogique validé sur le cours de référence devient un principe transversal de présentation pour les **cours de Physique-Chimie** et pour les **exercices de Mathématiques et de Physique-Chimie**, sans transformer leur contenu en copie du cours de référence.

Pour un cours de Physique-Chimie, la progression doit construire les notions avant leur mobilisation et articuler, lorsque pertinent, phénomène ou problème, définition, relation ou loi, grandeurs et unités, établissement ou démonstration, exemple réellement calculé, application, interprétation, conditions de validité et synthèse. Les calculs, substitutions, bilans et résultats sont isolés et lisibles. La prose sert de liaison et ne sert jamais à fabriquer artificiellement le volume.

Pour les exercices de Mathématiques et de Physique-Chimie, chaque exercice doit être un véritable objet d’apprentissage. Il comporte un objectif identifiable, un énoncé structuré en questions et sous-questions séparées, une progression interne lorsque le sujet s’y prête et un corrigé correspondant exactement aux mêmes données et notations. Les corrections montrent les étapes essentielles du raisonnement et des calculs, avec résultats, unités et interprétation lorsque pertinents. En Mathématiques, le LaTeX authentique, les manipulations ligne par ligne et les implications/équivalences justifiées sont privilégiés. En Physique-Chimie, la chaîne relation → grandeurs/unités → transformation → application numérique/bilan → résultat → interprétation est appliquée lorsqu’elle est pertinente.

Le contrat privilégie 2 à 4 exercices substantiels et complets plutôt qu’une accumulation de mini-exercices. Les graphiques GeoGebra restent conditionnés par leur valeur pédagogique et doivent être réellement rendables puis vérifiés dans le PDF ; une déclaration JSON ne constitue pas une preuve de rendu.
