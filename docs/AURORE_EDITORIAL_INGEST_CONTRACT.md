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

### Barrière éditoriale scientifique D → Documents en attente

Le passage de l’édition D vers le sas « Documents en attente » est soumis à une barrière pédagogique scientifique indépendante de la complétude du plan C/CX. Avant toute insertion issue de l’éditeur ChatGPT, le contenu final est contrôlé pour les mathématiques, la physique, la chimie et les autres contenus scientifiques quantitatifs couverts par le profil scientifique. Une suite de formules, équations, résultats ou valeurs ne peut pas être considérée comme une explication : les grandeurs ou notions importantes doivent être définies, la loi ou relation utilisée doit être identifiée, les transformations significatives doivent être expliquées, les étapes doivent être reliées par un raisonnement explicite et le résultat doit être interprété.

Le garde-fou analyse les sections instructionnelles du contenu réellement édité et bloque notamment toute section scientifique « formula-only » contenant plusieurs relations sans prose explicative suffisante. Il contrôle aussi la couverture du raisonnement sur l’ensemble du cours ; les sections d’exercices et de corrigés conservent une logique plus dense adaptée à leur nature. Le rapport du garde-fou est enregistré dans les métadonnées de la tâche. En cas d’échec, la tâche reste en D, aucune ligne aurora_generated_documents n’est créée et aucun document ne peut apparaître dans « Documents en attente ».

Cette barrière est appliquée côté base avant insertion, et l’interface D effectue le même contrôle en amont pour fournir immédiatement les corrections nécessaires à l’éditeur. Un contournement du passage C → D ne permet donc pas de contourner la dernière barrière D → Documents en attente.

### Barrière de production PDF

La propriété `pdf_launch_mode = manual` n’est pas seulement descriptive : elle constitue un contrat d’architecture. Le chemin autorisé est `administration → aurora-lualatex-request → GitHub Actions`. Le document ne doit jamais être réclamé par un scheduler, un `push` GitHub, une ingestion ou un trigger de base de données.

Le worker `aurora-lualatex-next` ne doit accepter que les lignes dont les métadonnées portent simultanément `lualatex_requested = true`, `lualatex_status = queued` et `lualatex_launch_source = admin_request`. Le chemin `aurora-lualatex-request` pose explicitement ce dernier marqueur. Après un échec, ces marqueurs ne doivent pas être réinstallés automatiquement.

L’ancien chemin `aurora-lualatex-auto-wake` est retiré du circuit de production et sa version active en Supabase est volontairement inerte : elle renvoie `MANUAL_PDF_ONLY` au lieu de réveiller GitHub. Cette protection doit rester en place même si un ancien Cron ou un ancien appel externe subsiste.

Le workflow réutilisable `.github/workflows/aurora-lualatex-production.yml` ne comporte plus de scheduler. Son étape de revendication est explicitement conditionnée à `workflow_dispatch` ou `workflow_call`, ce qui empêche un simple commit de code de lancer une production. Les tests de syntaxe peuvent continuer à s’exécuter sur un changement du renderer sans réclamer de document.

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

8. avant toute correction GeoGebra, vérifier l’instrument, la variable indépendante, la commande réellement envoyée au moteur et le résultat de `evalCommand` ;
9. consulter la mémoire éditoriale active `pdf_production_protocol`, `pdf_manual_launch_gate`, `geogebra_renderability_contract` et `known_production_failures` avant de toucher au pipeline.

## Diagnostic d’une absence dans le sas

Si un document est présent en base mais absent du sas, vérifier dans cet ordre :

1. `aurora_content_jobs.status` ;
2. `aurora_content_jobs.generated_document_id` ;
3. `aurora_generated_documents.pdf_path` et `pdf_url` ;
4. `created_by` et les politiques RLS de l’utilisateur connecté ;
5. la concordance entre le compteur du sas et sa requête détaillée.

Une absence dans l’interface ne signifie donc pas que le contenu est perdu.

