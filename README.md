# Mon Organisateur

Application personnelle (PWA) pour centraliser projets, tâches, emploi du temps, mails et relances. Gratuite, en français, installable sur Android et sur ordinateur. Hébergée sur Vercel.

## Fonctionnalités

- **Projets et tâches** : échéances, priorités, sous-tâches, tâches journalières et hebdomadaires, tâches bloquées. Saisie rapide en français (`Réunion bureau chaque lundi 18h #asso !!`).
- **Rangement automatique** dans les projets, qui apprend de chaque correction (calcul 100 % local).
- **Aujourd'hui** : cours du jour, tâches, relances, mails importants, projets négligés.
- **Agenda** : vues jour, semaine, mois. Import de l'emploi du temps Excel (lu sur l'appareil, dates erronées de l'école corrigées automatiquement) ou PDF (lu par Gemini), avec vérification avant validation.
- **Rappels** : alerte quand un projet n'a plus d'activité (seuil réglable par projet), notifications, envoi d'un rappel vers Google Agenda.
- **Mails** (lecture seule) : Gmail et Outlook. Un mail devient une tâche (avec lien vers le mail), un événement (dates détectées) ou une relance.
- **Assistant** (Gemini) : questions sur tes tâches, projets et agenda. Il ne reçoit que des titres, dates et noms, jamais le contenu des mails.
- **Revue hebdomadaire**, **relances**, **idées**, **recherche globale**, **mode sombre**, **synchronisation Google Drive**, export et import.

## Configuration (à faire une seule fois)

Toutes ces valeurs se règlent dans Vercel : **Project > Settings > Environment Variables**, puis **Redeploy**.

| Variable | Rôle | Secrète ? |
|---|---|---|
| `GEMINI_API_KEY` | Clé Gemini (Google AI Studio) | Oui, ne quitte jamais le serveur |
| `APP_PASSWORD` | Mot de passe que tu choisis, à saisir dans Réglages > Assistant | Oui |
| `GEMINI_MODEL` | Facultatif : modèle(s) Gemini, séparés par des virgules | Non |
| `GOOGLE_CLIENT_ID` | Identifiant OAuth Google (Drive, Gmail, Agenda) | Non |
| `GOOGLE_CLIENT_SECRET` | Secret OAuth Google : connexion longue durée, sans reconnexion | Oui |
| `MICROSOFT_CLIENT_ID` | Identifiant d'application Microsoft (Outlook) | Non |

### 1. Assistant Gemini

1. Crée une clé sur https://aistudio.google.com/apikey avec mathieut157@gmail.com.
2. Dans Vercel, ajoute `GEMINI_API_KEY` et `APP_PASSWORD`.
3. Dans l'application : Réglages > Assistant, saisis le mot de passe, puis **Tester**.

Le serveur essaie plusieurs modèles si l'un a atteint son quota gratuit. Les quotas gratuits changent souvent : vérifie-les dans AI Studio.

### 2. Google (synchro Drive, Gmail, Google Agenda)

1. Va sur https://console.cloud.google.com avec mathieut157@gmail.com et crée un projet.
2. **APIs & Services > Library** : active **Google Drive API**, **Gmail API** et **Google Calendar API**.
3. **OAuth consent screen** : type **External**, statut **Testing**. Dans **Test users**, ajoute `mathieut157@gmail.com` et `traoreandjou@gmail.com`.
4. **Credentials > Create credentials > OAuth client ID** : type **Web application**. Dans **Authorized JavaScript origins**, ajoute l'adresse exacte de l'application (par exemple `https://mon-organisateur-ten.vercel.app`, et ton domaine personnel s'il y en a un).
5. Dans **Authorized redirect URIs**, ajoute `https://<ton-adresse>/auth.html` pour chaque adresse de l'application.
6. Copie le **Client ID** dans `GOOGLE_CLIENT_ID` et le **Client secret** dans `GOOGLE_CLIENT_SECRET`.
7. Pour que la connexion n'expire pas au bout de 7 jours, passe le projet **En production** (Audience > Publish app).

À savoir : l'application n'étant pas vérifiée par Google, un écran « Google n'a pas validé cette application » s'affiche à la connexion (clique sur **Continuer**). Avec `GOOGLE_CLIENT_SECRET`, l'autorisation est renouvelée automatiquement par le serveur ; sans lui, elle dure une heure.

### Nouvel appareil

Ouvre l'application, Réglages > Synchronisation > **Activer avec Google Drive**. Comptes mail, mot de passe de l'assistant, réglages et historique de l'assistant arrivent automatiquement.

### 3. Outlook (adresse de l'école)

1. Va sur https://entra.microsoft.com > **App registrations > New registration**.
2. Types de comptes : **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI : plateforme **Single-page application (SPA)**, adresse `https://<ton-adresse>/auth.html`.
4. **API permissions** : `Mail.Read`, `User.Read`, `offline_access` (Microsoft Graph, Delegated).
5. Copie l'**Application (client) ID** dans `MICROSOFT_CLIENT_ID`.

Ton école peut bloquer l'accès des applications non approuvées. Dans ce cas, transfère les mails importants vers Gmail.

## Données et confidentialité

- Les données sont sur l'appareil (IndexedDB). Avec la synchro, une copie est rangée dans un dossier caché de ton Google Drive.
- Les mails restent sur chaque appareil (seuls les comptes et leurs autorisations sont synchronisés, dans le dossier caché de ton Drive). L'assistant ne reçoit que l'expéditeur, l'objet et un court extrait, et seulement si tu l'autorises.
- La clé Gemini reste sur le serveur Vercel.

## Développement

- Tests : `npm test`
- Lancement local (sans les fonctions serveur) : `npm start` puis `http://localhost:8080`
