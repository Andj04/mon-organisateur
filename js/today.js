// Page "Aujourd'hui" : cours et événements du jour, tâches, relances, projets négligés, mails importants.
import { state } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, fmt, cap, addDays, nowTime, weekday } from './dates.js';
import { openTasks, doneToday, sortTasks, eventsOn, dueFollowups } from './actions.js';
import { section, empty, ring } from './views.js';
import { inactiveBlock, followupsBlock } from './extras.js';
import { importantMails, mailCard } from './mail.js';

function eventsBlock(today) {
  const events = eventsOn(today);
  const now = nowTime();
  if (!events.length) {
    const tomorrow = eventsOn(addDays(today, 1));
    const hint = state.events.length
      ? (tomorrow.length ? `Demain : ${tomorrow.length} événement${tomorrow.length > 1 ? 's' : ''}, à partir de ${tomorrow.find((e) => e.start)?.start || 'la journée'}.` : 'Aucun cours ni événement aujourd\'hui.')
      : 'Importe ton emploi du temps depuis l\'onglet Agenda.';
    return `<section class="group"><h3 class="group-title">Emploi du temps</h3><a class="card soon" href="#/agenda/jour/${today}">${icon('calendar')}<div><strong>Journée libre</strong><p>${esc(hint)}</p></div></a></section>`;
  }
  return `
  <section class="group">
    <h3 class="group-title">Emploi du temps<span class="count">${events.length}</span></h3>
    <div class="card list">${events.map((e) => {
      const past = e.end && e.end <= now;
      const live = e.start && e.start <= now && (!e.end || e.end > now);
      return `
      <button class="row-item ri-main ev-row ${past ? 'past' : ''} ${live ? 'live' : ''}" data-action="open-event" data-id="${e.id}">
        <span class="ev-time">${e.allDay || !e.start ? 'Journée' : `${esc(e.start)}<small>${esc(e.end || '')}</small>`}</span>
        <span><strong>${esc(e.title)}</strong>${e.location ? `<small>${esc(e.location)}</small>` : ''}</span>
        ${live ? '<em class="live-dot">En cours</em>' : ''}
      </button>`;
    }).join('')}</div>
  </section>`;
}

function mailsBlock() {
  if (!state.accounts.length) return '';
  const list = importantMails(3).filter((m) => m.unread).slice(0, 4);
  if (!list.length) return '';
  return `<section class="group"><h3 class="group-title">Mails importants<span class="count">${list.length}</span><a class="see-all" href="#/mails">Tout voir</a></h3><div class="mails">${list.map((m) => mailCard(m, { compact: true })).join('')}</div></section>`;
}

export function todayView() {
  const today = todayISO();
  const open = sortTasks(openTasks());
  const late = open.filter((t) => t.due && t.due < today);
  const now = open.filter((t) => t.due === today);
  const soon = open.filter((t) => t.due > today && t.due <= addDays(today, 7)).slice(0, 5);
  const done = doneToday().length;
  const total = done + now.length + late.length;
  const hour = new Date().getHours();
  const hello = hour >= 18 ? 'Bonsoir' : 'Bonjour';
  const name = state.shared.name ? ' ' + esc(state.shared.name) : '';
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const needReview = (weekday(today) === 0 || weekday(today) === 1 || weekday(today) === 5)
    && !(state.shared.lastReview && state.shared.lastReview >= addDays(monday, weekday(today) === 1 ? -7 : 0))
    && state.tasks.length > 0;

  let tasksBlock;
  if (!state.tasks.length && !state.projects.length) {
    tasksBlock = empty('sparkles', 'Bienvenue !',
      'Commence par créer tes projets, puis ajoute tes tâches. L\'application apprendra à les ranger toute seule.',
      `<div class="row-gap"><button class="btn primary" data-action="new-project">${icon('folder')}Créer un projet</button><button class="btn" data-action="quick-add">${icon('plus')}Ajouter une tâche</button></div>`);
  } else if (!late.length && !now.length) {
    tasksBlock = `<section class="group"><h3 class="group-title">Tâches</h3><div class="card soon">${icon('check')}<div><strong>Rien de prévu aujourd'hui</strong><p>Profites-en, ou avance sur une tâche à venir.</p></div></div></section>`;
  } else {
    tasksBlock = section('En retard', late, { cls: 'is-late' }) + section('À faire aujourd\'hui', now);
  }

  return `
  <div class="hero">
    <div>
      <p class="eyebrow">${esc(cap(fmt(today, { weekday: 'long', day: 'numeric', month: 'long' })))}</p>
      <h1>${hello}${name}</h1>
      <p class="sub">${total ? `${done} sur ${total} tâche${total > 1 ? 's' : ''} terminée${total > 1 ? 's' : ''} aujourd'hui` : 'Ta journée est libre pour l\'instant.'}</p>
    </div>
    ${ring(done, total)}
  </div>
  ${needReview ? `<a class="card nudge" href="#/revue">${icon('check')}<div><strong>C'est le moment de ta revue de la semaine</strong><p>5 minutes pour faire le point sur le retard, les blocages et les relances.</p></div>${icon('next')}</a>` : ''}
  ${eventsBlock(today)}
  ${tasksBlock}
  ${followupsBlock(dueFollowups(), 'Relances du jour')}
  ${mailsBlock()}
  ${inactiveBlock()}
  ${section('Dans les 7 prochains jours', soon)}`;
}
