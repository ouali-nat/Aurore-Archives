# Aurore — organisation éditoriale et circuit PDF

Ce workflow sépare l’éditeur des documents du moteur conversationnel du site.

Pour une production documentaire, l’éditeur est ChatGPT, dans une conversation dédiée. Il prépare la classe, la matière, les chapitres, la proposition éditoriale et enfin le contenu structuré.

Le site n’appelle aucun moteur conversationnel d’Aurore pour fabriquer le document. Le rôle de Llama, DeepSeek ou Gemini reste celui du système conversationnel Aurore sur le site.

Le panneau administratif conserve une seule demande Content Factory. Le parcours est : classe + matière → chapitres ChatGPT → chapitre choisi → proposition ChatGPT → validation humaine → contenu complet ChatGPT → ingestion Aurore → PDF manuel.

Les données d’organisation sont conservées dans metadata.workflow. Les réponses éditoriales importées restent révisables et ne valent pas validation tant que l’administrateur ne l’a pas explicitement validée.

Le contenu final doit passer par aurora-gpt-ingest ou aurora-connector-ingest, puis par public.aurora_connector_ingest_editorial_document(jsonb). L’ingestion ne génère pas le PDF.

Le PDF reste séparé : administration → aurora-lualatex-request → GitHub Actions → GeoGebra/ressources → LuaLaTeX → QA → contrôle humain → publication.

Un échec PDF ne doit jamais relancer automatiquement l’éditeur ChatGPT. Toute nouvelle tentative est une action explicite de l’administration.
