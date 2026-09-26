# Aurore — Protocole obligatoire d’insertion éditoriale pour les IA

Ce document est la référence opérationnelle pour toute intelligence artificielle qui génère ou injecte un document dans Aurore — Section Archives. Il ne remplace pas le verrou Supabase : il le documente. La règle centrale est que la mémoire doit être récupérée et lue avant la génération finale destinée à l’injection, puis l’IA doit présenter une attestation correspondant à la totalité du paquet mémoire. Une session mémoire est limitée dans le temps, liée à la matière et au type de document, et ne peut être consommée qu’une fois.

## 1. Ordre obligatoire avant génération

L’IA doit d’abord déterminer le document réel : matière, niveau, classe, type de document, objectif pédagogique et éventuelles spécialisations. Elle doit ensuite récupérer la mémoire éditoriale Aurore.

Le paquet mémoire canonique comprend, dans cet ordre :

1. protocole général d’insertion ;
2. mémoire générale éditoriale ;
3. mémoire de structure et routage ;
4. mémoire de famille disciplinaire ;
5. profil de matière ou profil parent lorsque disponible ;
6. sous-profil éventuel ;
7. profil documentaire, par exemple course-v2, exercise-sheet-v2 ou profil adapté ;
8. mémoire spécialisée, par exemple la mémoire Mathématiques ;
9. validateurs liés à la nature du document.

L’IA ne doit pas commencer la génération finale avant d’avoir récupéré ce paquet. La session retournée contient une empreinte de paquet ainsi qu’une attestation cryptographique. Supabase les vérifie au moment de l’injection.

## 2. Où insérer les données

aurora_content_jobs représente la demande et le sas. Il contient la classification, le statut et les instructions, mais n’est pas la source structurée finale du document.

aurora_generated_documents est la destination éditoriale structurée. Le contenu réel du document est stocké dans content_json. Lorsqu’un document provient d’un job existant, il doit être relié par job_id.

L’IA éditoriale ne doit pas fabriquer un PDF final et l’envoyer directement dans Storage. La production PDF est séparée. Une fois le contenu injecté et placé en contrôle, l’administration peut lancer aurora-lualatex-request. Cette étape démarre GitHub Actions puis LuaLaTeX, les constructions GeoGebra et les contrôles QA. La publication reste humaine.

## 3. Structure canonique du JSON

Pour un cours, utiliser au minimum title, introduction et sections. Chaque section doit avoir un titre et un contenu structuré. Les formules importantes doivent être rangées dans les structures dédiées. Les exercices doivent être placés dans sections[].exercises[]. Les constructions mathématiques doivent être dans sections[].graphs. Les visuels documentaires doivent être dans sections[].visuals.

Pour une série d’exercices, le profil exercise-sheet-v2 est obligatoire. Les énoncés vont dans sections[].exercises[]. Les corrections vont dans corrections[]. L’appariement exercice/correction est stable. Il est interdit de cacher les exercices dans un long texte de section.content et il est interdit de placer le corrigé dans la question.

## 4. Cours

Le profil standard d’un cours vise au moins 3 000 mots utiles. Une longueur inférieure doit correspondre à un profil court explicitement justifié. Le volume doit venir de vraies explications, définitions, démonstrations, exemples, applications, interprétations et synthèses. Il est interdit de gonfler le cours par répétition, reformulation artificielle ou duplication d’annexes.

Une notion doit être introduite avant son utilisation importante. Les paramètres et notations doivent être expliqués. Une formule importante doit être interprétable. La discipline conserve sa propre manière de raisonner : le protocole Aurore est commun, mais la structure scientifique, littéraire, linguistique, historique ou informatique n’est pas forcée dans un modèle unique.

## 5. Mathématiques

Pour un cours de mathématiques, chaque section contenant une notion naturellement graphable doit recevoir une décision explicite dans visual_plan : build ou not_needed. Une décision build doit posséder de véritables graph_ids et chaque graphique doit être défini dans la section correspondante.

Les notions typiquement graphables comprennent les fonctions, courbes, droites, coniques, transformations, intersections, tangentes, asymptotes, suites lorsque la représentation est utile, systèmes, lieux géométriques, courbes paramétriques, surfaces et objets 3D lorsque le moteur les supporte.

Si une fonction est centrale et que sa construction est possible et pédagogiquement utile, elle doit être envisagée systématiquement. Il ne s’agit pas d’un quota. Une construction est ajoutée parce qu’elle explique quelque chose.

Chaque graphique doit avoir un identifiant stable, un titre, un rôle pédagogique et un instrument reconnu. Pour une fonction 2D, l’expression doit être exploitable et les bornes cohérentes. Pour une construction paramétrique, les expressions et les bornes du paramètre doivent être valides. Pour un objet 3D, les données doivent être suffisamment structurées pour le moteur. Une fenêtre trop grande ou trop petite peut rendre le résultat illisible.

La règle de fidélité est : expression du cours = données du graphique = asset GeoGebra = figure finale du PDF. Il est interdit de modifier une expression mathématique pour faciliter le rendu. Un graphique déclaré mais non construit, non récupérable ou non inséré doit être considéré comme une erreur de production.

## 6. Physique-Chimie et autres matières

Les règles générales restent identiques, mais la famille disciplinaire ajoute ses contraintes. En Physique-Chimie, privilégier lois, grandeurs, unités, calculs, démonstrations, interprétations et schémas utiles. En SVT, distinguer observations, mécanismes, interprétations et conclusions. Dans les langues, respecter le niveau, le lexique, la grammaire et séparer activités et corrections. Dans les humanités, distinguer notions, documents, faits, interprétations et argumentation. En informatique, privilégier algorithmes, code, étapes reproductibles et tests.

Lorsqu’une matière n’a pas encore de profil spécialisé, utiliser la famille générique et signaler le manque. Ne jamais inventer silencieusement une règle de matière.

## 7. PDF

Le PDF n’est pas le résultat direct de l’IA éditoriale. Le document éditorial doit d’abord être accepté dans aurora_generated_documents, puis le PDF est lancé manuellement par l’administration. Le pipeline utilise GitHub Actions et LuaLaTeX, avec production et contrôle des assets GeoGebra et QA.

Il faut corriger d’abord le contenu source lorsqu’une erreur structurelle est identifiée. Le renderer ne doit pas être modifié pour masquer un JSON mal structuré.

## 8. Erreurs connues

Les erreurs historiques ont été intégrées à la mémoire : exercices cachés dans section.content, cours sans introduction, mauvais type de contenu, JSON techniquement valide mais PDF pédagogiquement insuffisant, syntaxe LaTeX mal formée, graphiques déclarés sans assets utilisables, cours trop courts ou gonflés artificiellement.

Ces cas servent de règles de prévention. Lorsqu’un problème survient, vérifier d’abord la classification, la structure JSON, le profil documentaire et les données de construction avant de toucher au renderer.

## 9. Règle de non-contournement

Une IA ne doit jamais sauter la récupération de mémoire en envoyant directement un document vers la table de production. Le point d’entrée éditorial prévu est aurora-gpt-ingest. La session doit être valide, non expirée, non consommée et adaptée à la matière et au type de document. La base PostgreSQL vérifie elle-même la session et l’attestation.

Une ancienne session, une attestation calculée sur un sous-ensemble des règles, un profil documentaire différent, une famille différente ou une empreinte de paquet incohérente doivent provoquer un refus.

La chaîne officielle est :

IA → récupération mémoire → lecture → attestation complète → génération JSON → validation → aurora-gpt-ingest → Supabase → contrôle humain → lancement PDF manuel → GitHub Actions → LuaLaTeX/GeoGebra/QA → Content Factory → validation → publication.

Toute future extension de matière, de document ou de règle doit respecter ce même ordre et ne doit pas désactiver la barrière mémoire.
