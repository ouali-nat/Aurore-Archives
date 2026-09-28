# Contrat d’ingestion éditoriale Aurore

Ce document est la référence opérationnelle pour toute injection de contenu éditorial dans Aurore — Section Archives.

## Règle fondamentale

Le contenu produit par une assistante éditoriale doit entrer par `public.aurora_connector_ingest_editorial_document(jsonb)`. Il ne faut pas insérer directement une ligne dans `public.aurora_generated_documents`.

Le connecteur prépare le contenu pour le pipeline Aurore. Il ne lance pas le rendu PDF. Le rendu PDF reste une action administrative explicite et manuelle.

## Rattachement obligatoire

Une nouvelle injection doit fournir au moins l’un des deux éléments suivants :

- `job_id` : identifiant d’une demande Content Factory déjà présente dans `public.aurora_content_jobs` ;
- `created_by` : identifiant de l’utilisateur auquel la nouvelle demande Content Factory doit être rattachée.

Pour une demande nouvelle, `created_by` ne doit jamais être laissé vide. Une ingestion sans rattachement doit échouer explicitement. Il ne faut jamais créer silencieusement un contenu avec `created_by = NULL`, car les politiques RLS peuvent alors le rendre invisible à l’administration.

## Cycle de vie attendu

Le chemin normal est :

`Content Factory / brouillon → contenu éditorial reçu → contrôle humain → lancement manuel du PDF → document généré → validation/publication`

L’absence de PDF n’est pas une erreur d’ingestion. Un contenu éditorial correctement reçu peut être en `review` avec `pdf_path` et `pdf_url` nuls. Le sas « Documents en attente » doit le considérer comme prêt pour une production PDF manuelle.

Un échec de rendu PDF ne doit pas entraîner une boucle automatique de régénération. La nouvelle tentative doit être déclenchée depuis l’administration.

## Métadonnées de traçabilité

Les injections éditoriales portent le contrat :

- `workflow_contract = aurora-content-factory-v1`
- `workflow_initial_stage = content_factory`
- `workflow_current_stage = editorial_review`
- `pending_admin_surface = documents_en_attente`
- `pdf_launch_mode = manual`
- `manual_pdf_launch_required = true`
- `auto_pdf_launch = false`

Ces champs servent de repères techniques : ils ne remplacent pas les contrôles de sécurité, de qualité scientifique, de volume, de visualisation ou de publication.

## Checklist pour une future assistante

Avant une ingestion, vérifier :

1. utiliser le RPC du connecteur ;
2. fournir `job_id` pour un brouillon existant, sinon fournir `created_by` ;
3. ne pas lancer le PDF depuis le connecteur ;
4. conserver le contenu dans le sas jusqu’à l’action administrative ;
5. en cas de doublon, respecter `ingest_id` plutôt que recréer un document ;
6. après une production PDF, vérifier le résultat du renderer avant toute nouvelle tentative ;
7. ne jamais contourner les RLS ou les contrôles de rôle pour rendre un document « visible ».

## Diagnostic d’une absence dans le sas

Si un document est présent en base mais absent du sas, vérifier dans cet ordre :

1. `aurora_content_jobs.status` ;
2. `aurora_content_jobs.generated_document_id` ;
3. `aurora_generated_documents.pdf_path` et `pdf_url` ;
4. `created_by` et les politiques RLS de l’utilisateur connecté ;
5. la concordance entre le compteur du sas et sa requête détaillée.

Une absence dans l’interface ne signifie donc pas que le contenu est perdu.

