# Aurore Archives — plan de correction publication / QR

## Objectif

Corriger les liens de publication et le comportement des QR sans casser les publications existantes, sans supprimer d'objets PDF et sans modifier les données de production pendant la phase de préparation.

## Constat vérifié le 21 octobre 2026

- Le bucket Supabase Storage `Pdfs` est privé.
- Les entrées de bibliothèque 325 et 326 sont publiées et leur `Fichier_url` est une URL Supabase contenant un jeton.
- L'entrée 320 utilise une URL d'hôte R2.
- Le document généré 2265 est au statut `review` tout en référençant l'entrée de bibliothèque 325. Il faut comprendre cette divergence avant de migrer les statuts.
- La fonction Edge déployée `aurora-document-verify` répond `not_found` lorsqu'un document généré n'est plus au statut `published`, sans indiquer qu'il a été remplacé.
- Le code source de cette fonction Edge déployée n'a pas été trouvé dans le dépôt GitHub lors de l'audit. Ne pas modifier directement la fonction de production avant d'avoir récupéré et versionné son code.
- La fonction `aurora-assisted-pdf-finalize` conserve un proxy legacy vers le domaine `aurore-section-archives.com`, différent du domaine de production confirmé `aurore-section-archivescom.vercel.app`. Vérifier l'usage réel du chemin legacy avant toute modification.
- Le workflow GeoGebra échoue au stade de découverte des tâches avec HTTP 401 ; le workflow a été réorganisé sur cette branche afin de vérifier Supabase avant l'installation coûteuse de Chromium.

## Matrice de tests QR à exécuter avant publication

| Cas | Données de test | Résultat attendu |
| --- | --- | --- |
| Publication courante | Identifiant d'un document publié et fichier disponible | Vérification positive, titre/version corrects et lien de lecture fonctionnel |
| Brouillon/non public | Document existant non publié | Statut explicite « non public », aucune URL de téléchargement divulguée |
| Document remplacé | Ancienne édition reliée à une nouvelle édition publiée | Message « version remplacée » avec lien vers la version courante |
| Fichier manquant | Publication dont l'objet PDF n'existe plus | Erreur de disponibilité explicite, sans fausse validation |
| URL signée expirée | Publication dont l'URL signée a expiré mais dont l'objet existe toujours | Le QR reste valide et le serveur génère un accès frais |
| Mauvais identifiant | Identifiant mal formé ou inconnu | Réponse invalide/introuvable contrôlée, sans détail interne |
| Édition corrigée | Ancien QR papier après publication de la correction | L'ancien QR dirige vers la page stable qui signale le remplacement |
| Intégrité PDF | Objet accessible mais contenu qui n'est pas un PDF valide | Vérification négative, aucune annonce de document vérifié |

## Règles de migration proposées

1. Ne pas supprimer ni écraser les fichiers historiques.
2. Garder un identifiant stable de document/QR qui résout toujours vers la version courante.
3. Enregistrer chaque édition publiée comme une version immuable et relier explicitement `replaces_version_id` et `current_version_id` (noms indicatifs, à adapter au schéma final).
4. Séparer les états de génération, de contrôle éditorial et de publication.
5. Ne pas persister une URL signée courte durée comme unique référence publique. Stocker le chemin de l'objet et produire une URL fraîche au moment de la lecture.
6. Ne jamais considérer une URL comme preuve de publication : le statut et l'association de publication doivent être validés côté serveur.
7. Faire une sauvegarde vérifiable et un essai de migration sur une copie avant tout changement de schéma en production.

## Conditions avant fusion ou déploiement

- [ ] Le code source de `aurora-document-verify` est récupéré et versionné.
- [ ] La règle métier est fixée pour les cas où une même entrée de bibliothèque est mise à jour versus créée comme nouvelle version.
- [ ] Les tests de la matrice QR passent sur des données de test.
- [ ] Les URL R2 et Supabase existantes sont couvertes.
- [ ] Le workflow GeoGebra passe la découverte Supabase et ses tests.
- [ ] Une revue confirme qu'aucune modification de production ni suppression de PDF n'est requise pour tester.
- [ ] Déploiement progressif et plan de retour arrière documentés.

## Hors périmètre de cette branche

Aucune migration Supabase, aucun changement de données, aucune suppression d'objet de stockage et aucun déploiement de production. Cette branche prépare une correction réversible et une liste de tests.
