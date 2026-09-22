# Aurore — contrat éditorial v1

## Circuit de production

Le circuit cible est volontairement séparé en deux responsabilités :

1. **Édition** : ChatGPT produit le manuscrit pédagogique structuré.
2. **Production** : Aurore valide le JSON, prépare les ressources, rend le PDF avec le pipeline LuaLaTeX/GeoGebra, vérifie l’artefact, puis laisse la publication à une action humaine.

Aucun moteur de génération de contenu automatique n’est nécessaire pour le rendu PDF.

## Contrat aurora-editorial-1

Le pont aurora-gpt-ingest reçoit notamment :

- ingest_id : identifiant stable et idempotent du document.
- title
- subject
- level
- class_name
- document_type
- prompt : contexte éditorial facultatif.
- classification : catégorie, filière, domaine, formation, spécialité, année, semestre, couleur.
- content_json

content_json doit contenir :

- title
- sections[], avec au minimum title
- sections[].content[]
- sections[].graphs[] pour les graphiques/constructions générés par Aurore
- sections[].visuals[] pour les illustrations documentaires
- corrections[] au besoin

## Visuels

Les illustrations documentaires utilisent type: "wikimedia" et une fonction pédagogique explicite.

Limites du contrat :

- 3 visuels maximum par section
- 8 visuels maximum par document
- 24 graphiques/constructions maximum par document
- les courbes et constructions mathématiques restent dans graphs
- Wikimedia est utilisé lorsqu’une illustration documentaire apporte une information que le graphique/construction ne peut pas fournir

Le document enregistre séparément les visuels demandés, planifiés et réellement récupérés dans metadata.visual_qa.

## Idempotence

ingest_id possède une contrainte unique côté base. Un même document envoyé plusieurs fois ne crée pas de doublon : le pont renvoie l’enregistrement existant.

Le contenu reçoit aussi un SHA-256 enregistré dans les métadonnées.

## Cycle des statuts

- draft : demande non confirmée
- queued : demande confirmée, en attente de l’éditeur
- review : contenu éditorial intégré, contrôle humain / rendu PDF disponibles
- approved : validation du contenu/PDF
- published : publication effectuée
- failed / rejected : arrêt nécessitant une nouvelle action

Le PDF est produit après l’intégration du contenu, jamais comme une étape de génération de texte.

## Intégration d’un futur document

Un futur document suit toujours le même schéma :

**demande → édition ChatGPT → aurora-gpt-ingest → contrôle JSON → ressources/GeoGebra → LuaLaTeX → vérification PDF → contrôle humain → publication**

Le ingest_id doit rester stable pendant les retries réseau.
