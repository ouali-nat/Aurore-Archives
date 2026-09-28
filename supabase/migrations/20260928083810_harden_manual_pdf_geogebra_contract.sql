-- Durcissement du contrat Aurore : PDF manuel obligatoire et prévention de
-- la régression GeoGebra observée sur #488.
-- Cette migration ne modifie aucun contenu éditorial existant.

UPDATE public.aurora_editorial_memory
   SET active = false, updated_at = now()
 WHERE rule_key = 'pdf_production_protocol'
   AND active = true;

INSERT INTO public.aurora_editorial_memory (
  rule_key, version, title, priority, mandatory, active, content
)
SELECT
  'pdf_production_protocol',
  COALESCE(MAX(version),0) + 1,
  'Contrat PDF Aurore — lancement manuel, aucune réactivation automatique',
  2050,
  true,
  true,
  jsonb_build_object(
    'scope','Toute production PDF des documents éditoriaux Aurore.',
    'golden_rule','Un document éditorial en review reste dans le sas. Aucun statut metadata ne doit, à lui seul, provoquer une production PDF.',
    'manual_entrypoint','Le seul chemin applicatif de mise en file est aurora-lualatex-request, déclenché explicitement depuis l’administration après contrôle humain.',
    'forbidden_auto_paths',jsonb_build_array(
      'cron -> aurora-lualatex-auto-wake',
      'ingestion -> GitHub Actions',
      'trigger DB -> GitHub Actions',
      'push GitHub -> claim automatique',
      'schedule GitHub -> claim automatique',
      'assistant -> lancement ou relance PDF'
    ),
    'renderer_gate','aurora-lualatex-next ne doit réclamer qu’un document explicitement marqué lualatex_requested=true, lualatex_status=queued et lualatex_launch_source=admin_request.',
    'retry_rule','Après un échec, conserver le document en review/failed et attendre une nouvelle action administrative explicite. Ne jamais réenfiler automatiquement.',
    'audit_fields',jsonb_build_object(
      'pdf_launch_mode','manual',
      'manual_pdf_launch_required',true,
      'auto_pdf_launch',false
    )
  )
FROM public.aurora_editorial_memory
WHERE rule_key = 'pdf_production_protocol';

UPDATE public.aurora_editorial_memory
   SET active = false, updated_at = now()
 WHERE rule_key = 'geogebra_renderability_contract'
   AND active = true;

INSERT INTO public.aurora_editorial_memory (
  rule_key, version, title, priority, mandatory, active, content
)
SELECT
  'geogebra_renderability_contract',
  COALESCE(MAX(version),0) + 1,
  'Contrat GeoGebra renforcé — variable de function2d et validation de construction',
  2010,
  true,
  true,
  jsonb_build_object(
    'scope','Toute visualisation GeoGebra rendue server-side.',
    'function2d_rule','Une expression function2d éditoriale peut utiliser t comme variable indépendante. Le renderer adapte la commande GeoGebra vers f(x)=... sans réécrire le contenu éditorial canonique.',
    'document_488_incident','#488 déclarait 1000*exp(-0.231049*t), 800*exp(-0.1732868*t) et exp(-0.00012097*t). Le renderer construisait f(x)=...t, ce qui invalidait les constructions.',
    'api_validation_rule','La réussite de evalCommand doit être contrôlée explicitement. getObjectNumber seul ne constitue pas une preuve suffisante de la construction attendue.',
    'failure_rule','Une commande GeoGebra refusée doit être enregistrée avec la commande fautive et l’index du graphe. Ne jamais masquer une commande invalide derrière un simple délai.',
    'qa_order',jsonb_build_array(
      'instrument',
      'expression canonique',
      'adaptation de variable',
      'résultat evalCommand',
      'asset généré',
      'inclusion LaTeX',
      'présence PDF'
    )
  )
FROM public.aurora_editorial_memory
WHERE rule_key = 'geogebra_renderability_contract';

INSERT INTO public.aurora_editorial_memory (
  rule_key, version, title, priority, mandatory, active, content
)
VALUES (
  'pdf_manual_launch_gate',
  1,
  'Barrière absolue — aucune assistante ne lance ou relance automatiquement le PDF',
  2200,
  true,
  true,
  jsonb_build_object(
    'applies_to','Toutes les assistantes, agents, scripts et intégrations Aurore.',
    'allowed','Préparer, vérifier, corriger et déposer un contenu éditorial dans Content Factory.',
    'not_allowed','Appeler ou déclencher aurora-lualatex-request, aurora-lualatex-auto-wake ou le dispatcher GitHub sans une action administrative explicite.',
    'after_failure','Un échec de production ne justifie jamais un retry automatique. Le document reste disponible pour l’administration.',
    'no_bypass','Ne jamais contourner RLS, le contrôle de rôle ou le sas pour rendre un document visible ou lançable.'
  )
);
