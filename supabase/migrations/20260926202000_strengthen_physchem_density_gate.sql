-- Aurore Archives: strengthen the Physique-Chimie editorial density profile.
-- Editorial layer only. No renderer, PDF lifecycle, auth, or GitHub Actions changes.

update public.aurora_editorial_subject_profiles
set version=2,
    content=jsonb_build_object(
      'schema_version','physique-chimie-editorial-profile-1',
      'hard_gate',true,
      'mode','quantitative_calculatoire',
      'principle','La prose soutient le raisonnement scientifique ; elle ne remplace pas les formules, relations, calculs, bilans et démonstrations.',
      'generation_structure',jsonb_build_array(
        'relation ou équation','définition des grandeurs et unités',
        'transformation mathématique ou établissement','application numérique ou bilan',
        'résultat avec unité','interprétation scientifique'
      ),
      'constraints',jsonb_build_object(
        'minimum_scientific_relations',8,
        'minimum_calculation_blocks',6,
        'minimum_demonstration_blocks',2,
        'minimum_scientific_block_ratio',0.55,
        'minimum_scientific_word_ratio',0.70,
        'minimum_quantitative_work_word_ratio',0.35,
        'maximum_narrative_only_word_ratio',0.25,
        'maximum_narrative_only_block_ratio',0.25
      ),
      'rules',jsonb_build_array(
        'Toute notion quantitative importante doit être traitée par ses relations, équations ou bilans lorsqu’ils existent.',
        'Les transformations, substitutions, calculs et unités doivent apparaître explicitement lorsqu’ils sont pertinents.',
        'Une démonstration ou un établissement important ne doit pas être remplacé par une conclusion verbale.',
        'Les applications numériques doivent montrer les données utilisées, la relation mobilisée et le résultat interprété.',
        'Les réactions chimiques et bilans doivent être présentés explicitement lorsque le sujet les implique.',
        'GeoGebra doit être considéré lorsque la représentation d’une relation quantitative, d’une trajectoire ou d’un phénomène dynamique apporte une vraie valeur pédagogique.',
        'Wikimedia reste documentaire : il ne remplace jamais le travail scientifique et n’est utilisé que lorsqu’il apporte un contexte, une observation ou une source pertinente.',
        'La prose de liaison doit rester courte et fonctionnelle ; elle ne doit pas être utilisée pour atteindre artificiellement le volume minimal de mots.',
        'Les formules, calculs ou démonstrations doivent être distribués dans des blocs scientifiques distincts plutôt que noyés dans des paragraphes narratifs.'
      ),
      'anti_patterns',jsonb_build_array(
        'cours de physique-chimie rédigé comme un cours de littérature avec quelques formules ajoutées',
        'longues explications sans relation, calcul, unité, bilan ou raisonnement scientifique',
        'formule donnée sans manipulation ni application lorsqu’une démonstration ou un calcul est attendu',
        'répétition de conclusions pour augmenter le volume',
        'bloc majoritairement narratif contenant une seule formule pour se faire compter comme contenu scientifique'
      )
    ),
    updated_at=now()
where subject_key='physique-chimie';
