# Mon Organisateur

Application personnelle (PWA) pour centraliser projets, tâches et journée. Gratuite, sans serveur, en français, installable sur Android et sur ordinateur.

## Étape 1 (actuelle)

- Projets (nom, description, couleur, date de dernière activité)
- Tâches : échéance, heure, priorité, sous-tâches, tâches journalières et hebdomadaires
- Saisie rapide en français : `Réviser stats demain 18h !! #cours`, `Réunion bureau chaque lundi 18h`
- Rangement automatique dans les projets, qui apprend de chaque correction (calcul 100 % local)
- Page Aujourd'hui, mode sombre, export et import d'une sauvegarde
- Notifications simples (rappel à l'heure prévue, résumé du jour)

## Où sont mes données ?

Uniquement dans le navigateur de chaque appareil (IndexedDB). Rien n'est envoyé nulle part. La synchronisation via Google Drive arrive à l'étape 2.

## Mise en ligne (GitHub Pages, gratuit)

1. Sur GitHub : **Settings > Pages**.
2. Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
3. Après une à deux minutes, l'application est disponible sur `https://andj04.github.io/mon-organisateur/`.

## Installer sur Android

Ouvrir l'adresse dans Chrome, menu ⋮ puis **Ajouter à l'écran d'accueil** (ou **Installer l'application**).

## Développement

- Lancer en local : `npm start` puis ouvrir `http://localhost:8080`
- Tests de la logique (saisie rapide, rangement, récurrence) : `npm test`
