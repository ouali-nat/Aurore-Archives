# Aurore — éditeur ChatGPT et circuit Content Factory

Le contenu pédagogique de production est édité dans la conversation ChatGPT connectée à Supabase. Le site Aurore ne choisit pas un fournisseur IA pour rédiger le document : il sert à créer les demandes minimales, enregistrer les chapitres proposés par ChatGPT, enregistrer la proposition éditoriale, recueillir les validations et conserver l’état du travail.

Le flux est : classe + matière → récupération de la tâche par ChatGPT via le connecteur Supabase → proposition de chapitres → choix humain du chapitre dans Aurore → nouvelle récupération par ChatGPT → proposition éditoriale → vérification/validation humaine dans Aurore → récupération de la tâche validée par ChatGPT → rédaction complète du contenu → ingestion par `public.aurora_connector_ingest_editorial_document(jsonb)`.

Le passage D → « Documents en attente » possède en plus un garde-fou scientifique bloquant indépendant du plan C : avant ingestion, et à nouveau côté base au moment de l’insertion, Aurore vérifie le raisonnement réellement présent dans le contenu édité. Pour les mathématiques, la physique, la chimie et les autres contenus scientifiques couverts, les sections instructionnelles portant des relations ou formules doivent contenir des explications, définitions, justifications, transitions de raisonnement et interprétations ; une succession de formules sans explication est refusée. Les sections d’exercices et de corrigés peuvent rester plus denses, selon leur nature pédagogique. Si ce contrôle échoue, D reste bloqué, le rapport est persisté dans metadata.workflow et public.aurora_connector_ingest_editorial_document(jsonb) ne peut pas faire apparaître le document dans le sas.

Le pont `aurora_connector_ingest_editorial_document(jsonb)` reste le point canonique d’entrée du contenu final. Il rattache le contenu au sas Content Factory et force les marqueurs `origin=gpt_editorial_ingest`, `connector_mode=true`, `connector_name=supabase-mcp`, puis conserve le contrat de publication manuelle.

Le PDF est un circuit distinct. L’ingestion éditoriale ne lance pas LuaLaTeX. La production PDF est déclenchée explicitement par l’administration, puis passe par GitHub Actions, GeoGebra/ressources, LuaLaTeX, QA et contrôle humain avant toute publication.

Llama, DeepSeek et Gemini restent disponibles pour l’IA conversationnelle propre au site Aurore. Ils ne doivent pas être appelés par l’espace éditorial ChatGPT et ne doivent pas devenir des éditeurs cachés du contenu documentaire.

Les données d’organisation propres à ce flux sont conservées dans `metadata.workflow` de `public.aurora_content_jobs`. Le protocole courant de l’interface est `aurore-chatgpt-editor-v1`. Les marqueurs de sécurité PDF à conserver sont `pdf_launch_mode=manual`, `manual_pdf_launch_required=true` et `auto_pdf_launch=false`.

L’ancien fichier `js/aurore-content-orchestrator-admin.js` et la fonction Edge `aurora-content-orchestrator` ne constituent plus le circuit éditorial actif. L’interface ne les appelle plus. Ils peuvent rester présents pour compatibilité historique tant qu’aucune dépendance résiduelle n’est supprimée après vérification.
