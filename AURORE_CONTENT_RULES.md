# Aurore — Règles de génération de documents pédagogiques

> Document de référence pour toute génération ou ingestion de contenu destinée aux PDF Aurore — Section Archives.
>
> **Important :** ce document ne modifie pas le renderer PDF, l'authentification, Supabase, Storage, R2, les workflows GitHub Actions ni la logique de publication. Il définit les règles éditoriales à respecter avant l'injection du contenu dans le pipeline de production PDF.

## 1. Socle commun — toutes les matières

1. Respecter strictement la matière, le niveau, la classe, le type de ressource et l'objectif pédagogique demandés.
2. Produire un contenu réellement scolaire et exploitable, sans remplissage artificiel.
3. Ne jamais augmenter artificiellement le nombre de mots par répétitions ou longues explications inutiles.
4. Lorsqu'un document contient des exercices, isoler clairement les questions et sous-questions.
5. Lorsqu'un corrigé est demandé, résoudre réellement les exercices correspondants en conservant les mêmes données, notations et conditions.
6. Utiliser une notation spécialisée valide et compatible avec le renderer Aurore.
7. Ne jamais fabriquer de pseudo-LaTeX, de commandes cassées ou de mélanges incohérents entre Unicode et LaTeX.
8. Ne pas modifier le contenu mathématique ou scientifique valide uniquement pour contourner un problème de rendu : corriger la structure ou le renderer lorsque le problème est technique.
9. Pour un test de rendu PDF, tester réellement les fonctionnalités ciblées. Un document de test de longueur donnée ne doit pas être rempli artificiellement de prose.
10. Vérifier le PDF effectivement produit, et pas uniquement le statut de succès du pipeline.
11. Toute validation humaine et toute publication restent distinctes de la génération. Aucune règle éditoriale ne doit introduire une publication automatique.


## 1 bis. Contrat obligatoire des cours standard

Pour tout document de type **cours**, les règles suivantes sont des barrières de qualité et non de simples recommandations.

1. `content_json.introduction` est obligatoire et doit installer le sujet, les objectifs et les repères du cours.
2. Un cours standard doit contenir **au moins 3000 mots utiles**. Le comptage couvre l’introduction et les blocs textuels de `sections[].content[]`.
3. Une exception de format court n’est autorisée que si elle est déclarée explicitement avec `course_quality.format_profile=short_course` et accompagnée de `course_quality.short_format_reason`.
4. Pour un cours non mathématique, `content_json.visual_plan` est obligatoire. Chaque section reçoit une décision `build` ou `not_needed`; une section `build` référence des visuels Wikimedia identifiés et une section `not_needed` justifie son absence.
5. Au moins un visuel documentaire doit être planifié dans un cours non mathématique. Les limites restent de 3 visuels par section et 8 par document.
6. `no_svg_automatic` ne signifie jamais `no_visual` : cette instruction désactive uniquement la génération automatique d’Aurore SVG. Wikimedia et GeoGebra restent disponibles selon leur contrat propre.
7. Ces contrôles doivent réussir **avant** l’insertion ou la mise en file LuaLaTeX. Une génération PDF réussie ne peut pas compenser un contenu éditorial incomplet.

Le contrôle technique PostgreSQL applique ces règles à toutes les voies d’insertion, y compris les opérations manuelles ou administratives.


### Fiabilité des visuels Wikimedia

Pour les cours non mathématiques, les requêtes Wikimedia doivent privilégier des termes discriminants : nom de fichier ou référence archivistique quand elle est connue, lieu, date, catégorie ou intitulé historique précis. Une requête trop longue et générique peut retourner un document hors sujet ou aucun candidat. La sélection finale doit être vérifiée par son titre, sa description ou ses catégories. Un visuel manquant ou hors sujet doit corriger le plan documentaire avant la production PDF, et non être masqué en passant le visuel de `required` à facultatif.

## 2. Règles spécifiques — Mathématiques

Ces règles s'ajoutent au socle commun uniquement lorsque la matière est **Mathématiques**.

### 2.1 Priorité aux mathématiques

Un document de mathématiques doit privilégier les expressions, calculs, démonstrations, raisonnements, équations et représentations mathématiques. Les explications en français doivent accompagner les mathématiques, pas les remplacer.

### 2.2 Exercices réellement mathématiques

Les exercices doivent demander une activité mathématique réelle : calculer, démontrer, résoudre, déterminer, étudier, justifier, construire, représenter, comparer, interpréter ou déduire.

Éviter les exercices constitués principalement de questions théoriques auxquelles l'élève répondrait par de longs paragraphes.

### 2.3 Une question = une unité visuelle

Chaque question numérotée doit être séparée sur sa propre ligne ou son propre paragraphe.

Les sous-questions correspondant à des étapes distinctes doivent également être séparées.

Ne pas compacter plusieurs questions dans une seule ligne ou un seul paragraphe.

### 2.4 Corrigés avec étapes de calcul

Le corrigé doit montrer les étapes mathématiques essentielles.

Exemple :

$$
f'(x)=2x+3
$$

puis

$$
f'(x)>0 \Longleftrightarrow 2x+3>0
$$

donc

$$
x>-\frac{3}{2}.
$$

Ne pas remplacer un calcul attendu par une simple conclusion verbale.

### 2.5 Implications et équivalences

Utiliser les symboles logiques lorsqu'ils correspondent réellement au raisonnement :

$$
\Longrightarrow,\quad
\Longleftarrow,\quad
\Longleftrightarrow,\quad
\Rightarrow,\quad
\iff.
$$

Ne jamais ajouter ces symboles mécaniquement pour décorer le document.

### 2.6 LaTeX mathématique

Employer du véritable LaTeX compatible avec le renderer Aurore pour les expressions mathématiques.

Éviter les indices/exposants Unicode lorsqu'une notation LaTeX appropriée est attendue.

Ne jamais produire de commandes fragmentées, échappées incorrectement ou inventées.

### 2.7 Diversité pour les tests

Lorsqu'un test doit évaluer le moteur mathématique, utiliser une diversité adaptée au niveau :

- fractions et simplifications ;
- puissances, indices et racines ;
- valeurs absolues ;
- équations et inéquations ;
- systèmes ;
- fonctions ;
- limites ;
- dérivées ;
- variations ;
- primitives ;
- logarithmes ;
- exponentielles ;
- suites ;
- probabilités ;
- nombres complexes ;
- raisonnements par implication ou équivalence ;
- tableaux et représentations ;
- géométrie ou GeoGebra lorsque pertinent.

Ne jamais introduire une notion hors programme uniquement pour tester le renderer.

### 2.8 GeoGebra

GeoGebra doit être utilisé lorsqu'il apporte une vraie valeur mathématique : construction, représentation, exploration ou vérification géométrique/fonctionnelle.

Il ne doit pas être ajouté artificiellement uniquement pour démontrer que GeoGebra fonctionne.

### 2.9 Longueur des tests

Pour un test annoncé à 3000 mots, privilégier un contenu mathématiquement dense : exercices réels, calculs, démonstrations et corrigés.

Un document de 3000 mots ne doit pas devenir un cours de prose de 3000 mots.

La priorité est :

**moins de commentaires, plus de mathématiques ; moins de prose, plus de calculs ; chaque question isolée ; chaque étape importante démontrée ; LaTeX valide ; résultat final vérifié dans le PDF.**

## 3. Modules futurs par matière

Les règles spécifiques aux autres matières doivent rester indépendantes du module Mathématiques.

### Physique-Chimie

Ajouter séparément les règles concernant les formules physiques, unités SI, conversions, lois, équations, bilans, réactions chimiques, protocoles, mesures, incertitudes, schémas et interprétation des résultats.

### SVT

Ajouter séparément les règles concernant observations, expériences, schémas biologiques, mécanismes, cycles, documents scientifiques, tableaux, vocabulaire scientifique et interprétation.

### Français

Ajouter séparément les règles concernant compréhension, analyse de texte, grammaire, conjugaison, vocabulaire, argumentation, dissertation, commentaire, rédaction et citations.

### Histoire-Géographie

Ajouter séparément les règles concernant chronologie, dates, acteurs, documents historiques, cartes, études de cas, causes, conséquences, contextualisation et compositions.

### Anglais

Ajouter séparément les règles concernant compréhension, vocabulaire, grammaire, expression écrite, traduction et production en langue anglaise.

## 4. Isolation des matières

Le module actif est déterminé par la matière du document.

- Mathématiques → socle commun + module Mathématiques.
- Physique-Chimie → socle commun + module Physique-Chimie.
- SVT → socle commun + module SVT.
- Français → socle commun + module Français.
- Histoire-Géographie → socle commun + module Histoire-Géographie.
- Anglais → socle commun + module Anglais.

Une règle spécifique à une matière ne doit jamais être appliquée par défaut à une autre matière.

## 5. Évolution

Une nouvelle règle générale ne doit entrer dans le socle commun que si elle est réellement valable pour toutes les matières.

Une règle qui concerne une seule discipline doit être ajoutée à son module.

Cette organisation permet d'enrichir progressivement Aurore sans réécrire ou fragiliser les règles des autres disciplines.


## 12. Barrière mémoire avant injection

Avant toute génération destinée à l’ingestion Aurore, l’assistante doit récupérer la mémoire éditoriale générale via le service aurora-editorial-memory. Lorsque la matière est Mathématiques, le même appel récupère également le module Mathématiques.

La réponse ouvre une session mémoire à usage unique. L’assistante doit conserver le session_id et le memory_session_token et les transmettre dans memory_session_id et memory_session_token à aurora-gpt-ingest. Une session absente, expirée, déjà consommée ou incompatible avec la matière doit arrêter l’ingestion.

Cette exigence est appliquée à deux niveaux : le pont aurora-gpt-ingest refuse les appels sans session valide, et PostgreSQL bloque directement toute nouvelle insertion issue de gpt_editorial_ingest sans mémoire vérifiée. Les versions des mémoires et l’empreinte du paquet utilisé sont enregistrées avec le document.

Pour Mathématiques, le document ne peut être inséré que si la mémoire générale et la mémoire Mathématiques ont toutes deux été récupérées dans la même session.