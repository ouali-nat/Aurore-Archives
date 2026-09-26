# Architecture mémoire éditoriale Aurore

La mémoire éditoriale d’Aurore est organisée en couches afin de ne pas enfermer le système dans une liste fixe de matières.

## 1. Mémoire éditoriale générale

La table `aurora_editorial_memory` contient les règles communes à tous les documents : qualité pédagogique, structure générale, exercices et corrections, politique visuelle, QA PDF, métadonnées et idempotence.

## 2. Mémoire de structure et de rangement

La table `aurora_editorial_structure_memory` est la fondation du « plan de classement » éditorial. Elle devra décrire les types de blocs Aurore, leurs emplacements JSON autorisés, leurs champs obligatoires, leurs relations, les combinaisons interdites et les validations structurelles. Cette couche est indépendante des matières.

La couche est maintenant utilisée pour les profils disciplinaires actifs. Le profil Physique-Chimie est le premier profil spécialisé bloquant et porte les contraintes quantitatives nécessaires à la génération de cours scientifiques.

## 3. Profils disciplinaires extensibles

La table `aurora_editorial_subject_profiles` représente une discipline sans imposer une liste fermée. Chaque profil possède une famille disciplinaire, peut hériter d’un autre profil et passe par les états `draft`, `partial`, `ready` ou `retired`.

La table `aurora_editorial_subject_aliases` permet de rattacher différentes appellations à une même discipline. Cela permettra par exemple de reconnaître des variantes de nom sans dupliquer les règles.

## 4. Ordre futur de chargement

Lorsqu’un éditeur demande la mémoire, le système devra charger :

1. les règles générales Aurore ;
2. les règles de structure/rangement ;
3. le profil de famille disciplinaire ;
4. le profil de matière ;
5. les éventuels sous-profils spécialisés ;
6. les règles de validation correspondantes.

Une matière inconnue ne devra pas provoquer l’invention silencieuse de règles. Elle pourra utiliser les règles générales et être signalée comme profil disciplinaire non spécialisé jusqu’à création et validation de son profil.

## 5. Principe d’extensibilité

L’ajout d’une nouvelle matière doit consister à créer un nouveau profil et ses alias, sans modifier le moteur de mémoire général. Les familles disciplinaires servent à mutualiser les règles lorsque plusieurs matières partagent des contraintes, tout en permettant des spécialisations.

## 6. Sécurité

Ces tables sont destinées au moteur interne de mémoire et ne sont pas exposées aux rôles `anon` ou `authenticated`. Elles sont protégées par RLS et réservées au service interne.

## 5. Verrou de lecture avant progression

La récupération de la mémoire ne constitue plus seulement une information disponible pour l’éditeur : elle ouvre une session à usage unique portant l’empreinte exacte du paquet de règles. Avant de produire ou d’injecter le contenu, l’éditeur doit fournir editorial_memory_ack avec les éléments correspondant à cette session et une attestation cryptographique liée au jeton de session. L’absence ou l’incohérence de cette preuve arrête la progression.

Le même verrou est appliqué dans aurora-gpt-ingest et au niveau du trigger PostgreSQL sur aurora_generated_documents. Le renderer PDF n’est pas concerné par cette modification : il reçoit uniquement du contenu ayant déjà franchi la barrière éditoriale.

Le profil Physique-Chimie est résolu par matière ou alias et est inclus dans le paquet mémoire. Pour les cours de Physique, Chimie, Physique-Chimie, Sciences physiques et PC, son absence bloque la récupération et donc la génération.
