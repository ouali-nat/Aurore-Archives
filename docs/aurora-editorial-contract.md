
# Aurore — contrat éditorial v2

## Circuit de production

Le circuit sépare volontairement deux responsabilités : ChatGPT prépare le manuscrit pédagogique structuré, puis Aurore valide le JSON et assure la production PDF avec le pipeline LuaLaTeX/GeoGebra. La publication reste une action humaine.

## Mémoire obligatoire avant injection

Avant toute injection provenant de l’édition ChatGPT, l’assistante doit appeler la fonction Edge aurora-editorial-memory avec la matière et le type de document. Le service récupère la mémoire générale Aurore et, lorsque la matière est Mathématiques, récupère également la mémoire spécialisée Mathématiques.

Le service ouvre alors une session mémoire à usage unique, valable pendant une fenêtre limitée. La réponse fournit les règles nécessaires, leurs versions, une empreinte du paquet mémoire et un session_id. L’assistante doit transmettre ce session_id dans memory_session_id lors de l’appel suivant à aurora-gpt-ingest.

L’ingestion refuse l’appel si la session est absente, expirée, déjà consommée ou incompatible avec la matière. Une seconde barrière existe directement sur aurora_generated_documents : toute insertion portant l’origine gpt_editorial_ingest sans session mémoire valide est bloquée par la base.

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

## Idempotence et traçabilité

ingest_id reste stable pendant les retries réseau et empêche la duplication. Lorsqu’un document est injecté, Aurore conserve dans metadata.memory_gate la preuve de la session mémoire utilisée : identifiant de session, versions des mémoires, identifiants des règles et empreinte du paquet mémoire.

La table aurora_editorial_memory_sessions conserve l’historique technique de chaque récupération et empêche la réutilisation d’une session consommée.

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
