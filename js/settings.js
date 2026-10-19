// Écran Réglages : profil, apparence, synchronisation, assistant, emploi du temps, notifications, données.
import { state, local, appPassword } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { timeAgo } from './dates.js';
import { notifPermission, notifSupported } from './notify.js';

function syncCard() {
  const s = state.sync;
  const on = state.settings.syncEnabled;
  let status;
  if (!on) status = 'Désactivée : tes données restent sur cet appareil.';
  else if (s.status === 'syncing') status = 'Synchronisation en cours…';
  else if (s.status === 'reconnect') status = 'Connexion expirée. Clique sur « Reconnecter » pour reprendre.';
  else if (s.status === 'error') status = `Erreur : ${esc(s.error)}`;
  else status = `Avec ${esc(state.settings.driveEmail)} · dernière synchro ${esc(timeAgo(s.lastSync))}`;
  return `
  <section class="group">
    <h3 class="group-title">Synchronisation</h3>
    <div class="card form-card">
      <div class="setting-row">
        <div>${icon('repeat')}<div><strong>Google Drive</strong><p>${status}</p></div></div>
        ${on ? `<span class="sync-dot ${s.status}"></span>` : ''}
      </div>
      <div class="row-gap wrap">
        ${!on ? `<button class="btn primary" data-action="sync-connect">${icon('repeat')}Activer avec Google Drive</button>` : ''}
        ${on && s.status === 'reconnect' ? `<button class="btn primary" data-action="sync-connect">Reconnecter</button>` : ''}
        ${on && s.status !== 'reconnect' ? `<button class="btn" data-action="sync-now">${icon('repeat')}Synchroniser maintenant</button>` : ''}
        ${on ? '<button class="btn ghost danger" data-action="sync-off">Désactiver</button>' : ''}
      </div>
      <p class="fine">${icon('shield')}Tes données sont rangées dans un dossier caché de ton Drive, visible uniquement par cette application. Sur un nouvel appareil, active simplement la synchro avec le même compte : comptes mail, mot de passe de l'assistant, réglages et historique arrivent tout seuls.</p>
    </div>
  </section>`;
}

const toggle = (key, title, text) => `
  <div class="setting-row">
    <div><div><strong>${title}</strong><p>${text}</p></div></div>
    <label class="switch"><input type="checkbox" data-toggle-setting="${key}" ${state.shared.prefs[key] ? 'checked' : ''}><i></i></label>
  </div>`;

export function settingsView(theme) {
  const perm = notifPermission();
  const s = state.stats;
  const totalAuto = s.autoKept + s.autoFixed;
  const notifOn = state.settings.notifications && perm === 'granted';
  const tt = state.shared.timetable;
  let notifStatus;
  if (!notifSupported()) notifStatus = 'Ton navigateur ne gère pas les notifications.';
  else if (perm === 'denied') notifStatus = 'Bloquées dans les réglages du navigateur. Autorise-les dans les paramètres du site pour les activer.';
  else if (notifOn) notifStatus = 'Activées : rappels à l\'heure prévue, relances du jour et résumé du matin.';
  else notifStatus = 'Désactivées.';

  const themeBtn = (k, label, ic) => `<button class="${theme === k ? 'on' : ''}" data-action="set-theme" data-key="${k}">${icon(ic)}${label}</button>`;
  const hasPass = Boolean(appPassword());

  return `
  <div class="page-head"><h1>Réglages</h1></div>

  <section class="group">
    <h3 class="group-title">Profil</h3>
    <div class="card form-card">
      <label class="field"><span>Ton prénom (pour l'accueil)</span>
        <input data-setting="name" value="${esc(state.shared.name)}" placeholder="Prénom" autocomplete="given-name"></label>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Apparence</h3>
    <div class="card form-card">
      <div class="segmented wide">${themeBtn('auto', 'Auto', 'monitor')}${themeBtn('light', 'Clair', 'sun')}${themeBtn('dark', 'Sombre', 'moon')}</div>
    </div>
  </section>

  ${syncCard()}

  <section class="group">
    <h3 class="group-title">Assistant</h3>
    <div class="card form-card">
      <label class="field"><span>Mot de passe de l'assistant</span>
        <input type="password" data-local="app-password" placeholder="${hasPass ? 'Enregistré (synchronisé entre tes appareils)' : 'Celui choisi dans Vercel (APP_PASSWORD)'}" autocomplete="new-password"></label>
      <div class="row-gap wrap">${hasPass ? `<button class="btn" data-action="test-assistant">${icon('sparkles')}Tester</button>` : ''}</div>
      ${toggle('briefing', 'Résumé du matin', 'Chaque jour, une carte en haut de la page Aujourd\'hui : cours, priorités, retards et relances.')}
      ${toggle('mailConsent', 'Autoriser l\'assistant à lire mes mails', 'Uniquement l\'expéditeur, l\'objet, la date et les 200 premiers caractères, pour te proposer des tâches. Le mail complet n\'est jamais envoyé.')}
      ${state.shared.prefs.mailConsent ? toggle('autoMailTasks', 'Analyser automatiquement les nouveaux mails', 'Au plus toutes les 2 heures, pour économiser ton quota gratuit de Gemini.') : ''}
      <p class="fine">${icon('shield')}La clé Gemini est rangée sur le serveur Vercel, jamais dans l'application. Ce mot de passe empêche d'autres personnes de l'utiliser. Il est rangé dans ton Drive avec la synchronisation, pour ne pas avoir à le ressaisir sur ton téléphone.</p>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Emploi du temps</h3>
    <div class="card form-card">
      <div class="tt-filters">
        <label class="field"><span>Filière</span><input data-shared-tt="filiere" value="${esc(tt.filiere)}"></label>
        <label class="field"><span>Option</span><input data-shared-tt="option" value="${esc(tt.option)}"></label>
        <label class="field"><span>Groupe de langue</span><input data-shared-tt="groupe" value="${esc(tt.groupe)}" inputmode="numeric"></label>
        <label class="field"><span>Groupe de TP</span><input data-shared-tt="groupeTP" value="${esc(tt.groupeTP || '')}" inputmode="numeric" placeholder="Tous"></label>
      </div>
      <button class="btn" data-action="import-edt">${icon('upload')}Importer un emploi du temps</button>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Notifications</h3>
    <div class="card form-card">
      <div class="setting-row">
        <div>${icon('bell')}<div><strong>Rappels et résumé du jour</strong><p>${notifStatus}</p></div></div>
        <label class="switch"><input type="checkbox" data-action="toggle-notif" ${notifOn ? 'checked' : ''} ${!notifSupported() || perm === 'denied' ? 'disabled' : ''}><i></i></label>
      </div>
      ${notifOn ? `<button class="btn" data-action="test-notif">${icon('bell')}Envoyer une notification de test</button>` : ''}
      <p class="fine">Quand l'application est complètement fermée, Android ne garantit pas l'heure exacte. Pour un rappel sûr, utilise « Rappel Google Agenda » dans une tâche.</p>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Rangement automatique</h3>
    <div class="card form-card">
      <div class="stats">
        <div><strong>${s.autoKept}</strong><span>propositions gardées</span></div>
        <div><strong>${s.autoFixed}</strong><span>corrections apprises</span></div>
        <div><strong>${totalAuto ? Math.round((s.autoKept / totalAuto) * 100) + '%' : '·'}</strong><span>de justesse</span></div>
      </div>
      <p class="fine">L'apprentissage se fait uniquement sur ton appareil. Astuce : écris <b>#nom</b> dans une tâche pour choisir le projet directement.</p>
      <button class="btn ghost danger" data-action="reset-model">Oublier ce qui a été appris</button>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Données</h3>
    <div class="card form-card">
      <div class="row-gap wrap">
        <button class="btn" data-action="export">${icon('download')}Exporter une sauvegarde</button>
        <label class="btn">${icon('upload')}Importer une sauvegarde<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
      <button class="btn ghost danger" data-action="wipe">${icon('trash')}Tout effacer sur cet appareil</button>
    </div>
  </section>

  <p class="version">Mon Organisateur · ${state.tasks.length} tâches · ${state.projects.length} projets · ${state.events.length} événements</p>`;
}
