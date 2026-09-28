# Aurore — éditeur ChatGPT et circuit Content Factory

Le contenu pédagogique de production est édité dans la conversation ChatGPT connectée à Supabase. Le site Aurore ne choisit pas un fournisseur IA pour rédiger le document : il sert à créer les demandes minimales, enregistrer les chapitres proposés par ChatGPT, enregistrer la proposition éditoriale, recueillir les validations et conserver l’état du travail.

Le flux est : classe + matière → récupération de la tâche par ChatGPT via le connecteur Supabase → proposition de chapitres → choix humain du chapitre dans Aurore → nouvelle récupération par ChatGPT → proposition éditoriale → vérification/validation humaine dans Aurore → récupération de la tâche validée par ChatGPT → rédaction complète du contenu → ingestion par `public.aurora_connector_ingest_editorial_document(jsonb)`.

Le pont `aurora_connector_ingest_editorial_document(jsonb)` reste le point canonique d’entrée du contenu final. Il rattache le contenu au sas Content Factory et force les marqueurs `origin=gpt_editorial_ingest`, `connector_mode=true`, `connector_name=supabase-mcp`, puis conserve le contrat de publication manuelle.

Le PDF est un circuit distinct. L’ingestion éditoriale ne lance pas LuaLaTeX. La production PDF est déclenchée explicitement par l’administration, puis passe par GitHub Actions, GeoGebra/ressources, LuaLaTeX, QA et contrôle humain avant toute publication.

Llama, DeepSeek et Gemini restent disponibles pour l’IA conversationnelle propre au site Aurore. Ils ne doivent pas être appelés par l’espace éditorial ChatGPT et ne doivent pas devenir des éditeurs cachés du contenu documentaire.

Les données d’organisation propres à ce flux sont conservées dans `metadata.workflow` de `public.aurora_content_jobs`. Le protocole courant de l’interface est `aurore-chatgpt-editor-v1`. Les marqueurs de sécurité PDF à conserver sont `pdf_launch_mode=manual`, `manual_pdf_launch_required=true` et `auto_pdf_launch=false`.

L’ancien fichier `js/aurore-content-orchestrator-admin.js` et la fonction Edge `aurora-content-orchestrator` ne constituent plus le circuit éditorial actif. L’interface ne les appelle plus. Ils peuvent rester présents pour compatibilité historique tant qu’aucune dépendance résiduelle n’est supprimée après vérification.
