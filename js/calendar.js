// Calendrier : vues jour, semaine et mois, fiche événement, envoi vers Google Agenda.
import { state } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, addDays, fmt, cap, weekday, fromISO, toISO, nowTime, WEEKDAYS_SHORT } from './dates.js';
import { eventsOn, getEvent, saveEvent, deleteEvent, getTask, updateTask } from './actions.js';
import { taskRow } from './views.js';
import { focusSoon, openSheet, closeSheet, openConfirm } from './sheets.js';
import { googleFetch, SCOPES } from './google.js';
import { toast } from './toast.js';

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_PX = 56;
const MODES = { jour: 'Jour', semaine: 'Semaine', mois: 'Mois' };

const mondayOf = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
const minutes = (t) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m; };
const wide = () => matchMedia('(min-width: 900px)').matches;

function tasksOn(date) {
  const today = todayISO();
  return state.tasks.filter((t) => !t.done && t.due && (t.due === date || (date === today && t.due < today)));
}

// Place les événements qui se chevauchent côte à côte.
function layout(events) {
  const timed = events.filter((e) => !e.allDay && e.start)
    .map((e) => ({ e, s: minutes(e.start), f: Math.max(minutes(e.end || e.start) || 0, minutes(e.start) + 30) }))
    .sort((a, b) => a.s - b.s || b.f - a.f);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let i = cols.findIndex((end) => end <= it.s);
      if (i === -1) { i = cols.length; cols.push(0); }
      cols[i] = it.f;
      it.col = i;
    }
    for (const it of cluster) out.push({ ...it, cols: cols.length });
    cluster = [];
  };
  for (const it of timed) {
    if (it.s >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.f);
  }
  if (cluster.length) flush();
  return out;
}

function eventBlock(it) {
  const top = ((it.s - START_HOUR * 60) / 60) * HOUR_PX;
  const height = Math.max(((it.f - it.s) / 60) * HOUR_PX - 3, 22);
  const e = it.e;
  return `
  <button class="ev ${e.source === 'edt' ? 'edt' : ''}" data-action="open-event" data-id="${e.id}"
    style="top:${top}px;height:${height}px;left:calc(${(it.col / it.cols) * 100}% + 2px);width:calc(${100 / it.cols}% - 4px)">
    <strong>${esc(e.title)}</strong>
    <span>${esc(e.start)}${e.end ? '–' + esc(e.end) : ''}${e.location ? ' · ' + esc(e.location) : ''}</span>
  </button>`;
}

function hoursColumn() {
  let h = '';
  for (let i = START_HOUR; i <= END_HOUR; i++) h += `<span style="top:${(i - START_HOUR) * HOUR_PX}px">${i}h</span>`;
  return `<div class="tl-hours">${h}</div>`;
}

function nowLine(date) {
  if (date !== todayISO()) return '';
  const m = minutes(nowTime());
  if (m < START_HOUR * 60 || m > END_HOUR * 60) return '';
  return `<i class="now-line" style="top:${((m - START_HOUR * 60) / 60) * HOUR_PX}px"></i>`;
}

function dayColumn(date) {
  const events = eventsOn(date);
  return `<div class="tl-col" data-date="${date}" style="height:${(END_HOUR - START_HOUR) * HOUR_PX}px">${layout(events).map(eventBlock).join('')}${nowLine(date)}</div>`;
}

function allDayRow(events) {
  const list = events.filter((e) => e.allDay || !e.start);
  return list.length ? `<div class="allday">${list.map((e) => `<button class="ev-chip" data-action="open-event" data-id="${e.id}">${esc(e.title)}</button>`).join('')}</div>` : '';
}

function dayView(date) {
  const events = eventsOn(date);
  const tasks = tasksOn(date);
  return `
  ${allDayRow(events)}
  ${tasks.length ? `<section class="group"><h3 class="group-title">Tâches<span class="count">${tasks.length}</span></h3><div class="card list">${tasks.map((t) => taskRow(t)).join('')}</div></section>` : ''}
  <div class="card timeline">${hoursColumn()}<div class="tl-cols">${dayColumn(date)}</div></div>`;
}

function weekView(date) {
  const monday = mondayOf(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const today = todayISO();
  if (wide()) {
    const show = days.filter((d, i) => i < 5 || eventsOn(d).length);
    return `
    <div class="card timeline week" style="--days:${show.length}">
      <div class="tl-head"><span></span>${show.map((d) => `<button class="tl-day ${d === today ? 'today' : ''}" data-action="cal-goto" data-mode="jour" data-date="${d}"><small>${WEEKDAYS_SHORT[weekday(d)]}</small><b>${fromISO(d).getDate()}</b></button>`).join('')}</div>
      <div class="tl-allday"><span></span>${show.map((d) => `<div>${allDayRow(eventsOn(d))}</div>`).join('')}</div>
      <div class="tl-body">${hoursColumn()}<div class="tl-cols">${show.map(dayColumn).join('')}</div></div>
    </div>`;
  }
  return `<div class="agenda">${days.map((d) => {
    const events = eventsOn(d);
    const tasks = tasksOn(d).filter((t) => t.due === d);
    if (!events.length && !tasks.length && weekday(d) % 6 === 0) return '';
    return `
    <section class="ag-day ${d === today ? 'today' : ''}">
      <button class="ag-date" data-action="cal-goto" data-mode="jour" data-date="${d}"><small>${WEEKDAYS_SHORT[weekday(d)]}</small><b>${fromISO(d).getDate()}</b></button>
      <div class="ag-items">
        ${events.map((e) => `<button class="ag-ev ${e.source === 'edt' ? 'edt' : ''}" data-action="open-event" data-id="${e.id}"><span class="ag-time">${e.allDay || !e.start ? 'Journée' : `${esc(e.start)}<small>${esc(e.end || '')}</small>`}</span><span class="ag-title">${esc(e.title)}${e.location ? `<small>${esc(e.location)}</small>` : ''}</span></button>`).join('')}
        ${tasks.map((t) => `<button class="ag-task" data-action="open-task" data-id="${t.id}">${icon('tasks')}${esc(t.title)}</button>`).join('')}
        ${!events.length && !tasks.length ? '<p class="ag-empty">Rien de prévu</p>' : ''}
      </div>
    </section>`;
  }).join('')}</div>`;
}

function monthView(date) {
  const first = toISO(new Date(fromISO(date).getFullYear(), fromISO(date).getMonth(), 1));
  const start = mondayOf(first);
  const month = fromISO(date).getMonth();
  const today = todayISO();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const rows = cells[35] && fromISO(cells[35]).getMonth() !== month ? cells.slice(0, 35) : cells;
  return `
  <div class="card month">
    <div class="m-head">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<span>${WEEKDAYS_SHORT[d]}</span>`).join('')}</div>
    <div class="m-grid">${rows.map((d) => {
      const events = eventsOn(d);
      const tasks = state.tasks.filter((t) => !t.done && t.due === d).length;
      return `
      <button class="m-cell ${fromISO(d).getMonth() !== month ? 'out' : ''} ${d === today ? 'today' : ''}" data-action="cal-goto" data-mode="jour" data-date="${d}">
        <b>${fromISO(d).getDate()}</b>
        <span class="m-evs">${events.slice(0, 3).map((e) => `<i class="${e.source === 'edt' ? 'edt' : ''}">${esc(e.title)}</i>`).join('')}${events.length > 3 ? `<em>+${events.length - 3}</em>` : ''}</span>
        ${tasks ? `<span class="m-task">${tasks}</span>` : ''}
      </button>`;
    }).join('')}</div>
  </div>`;
}

export function calendarView(mode = 'semaine', date = todayISO()) {
  if (!MODES[mode]) mode = 'semaine';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayISO();
  const step = mode === 'jour' ? 1 : mode === 'semaine' ? 7 : null;
  const prev = step ? addDays(date, -step) : toISO(new Date(fromISO(date).getFullYear(), fromISO(date).getMonth() - 1, 1));
  const next = step ? addDays(date, step) : toISO(new Date(fromISO(date).getFullYear(), fromISO(date).getMonth() + 1, 1));
  let title;
  if (mode === 'jour') title = cap(fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }));
  else if (mode === 'semaine') title = `Semaine du ${fmt(mondayOf(date), { day: 'numeric', month: 'short' })}`;
  else title = cap(fmt(date, { month: 'long', year: 'numeric' }));

  const body = mode === 'jour' ? dayView(date) : mode === 'semaine' ? weekView(date) : monthView(date);
  const empty = !state.events.length
    ? `<div class="card soon">${icon('upload')}<div><strong>Ton calendrier est vide</strong><p>Importe ton emploi du temps (Excel ou PDF) avec le bouton Importer.</p></div></div>` : '';
  return `
  <div class="page-head cal-head">
    <h1>Agenda</h1>
    <div class="row-gap">
      <button class="btn" data-action="import-edt">${icon('upload')}<span>Importer</span></button>
      <button class="btn primary" data-action="new-event" data-date="${date}">${icon('plus')}<span>Événement</span></button>
    </div>
  </div>
  <div class="cal-bar">
    <div class="segmented">${Object.entries(MODES).map(([k, l]) => `<button class="${k === mode ? 'on' : ''}" data-action="cal-goto" data-mode="${k}" data-date="${date}">${l}</button>`).join('')}</div>
    <div class="cal-nav">
      <button class="icon-btn" data-action="cal-goto" data-mode="${mode}" data-date="${prev}" aria-label="Précédent">${icon('back')}</button>
      <button class="btn ghost small" data-action="cal-goto" data-mode="${mode}" data-date="${todayISO()}">Aujourd'hui</button>
      <button class="icon-btn" data-action="cal-goto" data-mode="${mode}" data-date="${next}" aria-label="Suivant">${icon('next')}</button>
    </div>
  </div>
  <h2 class="cal-title">${esc(title)}</h2>
  ${empty}
  ${body}`;
}

// Place la vue jour/semaine sur l'heure actuelle (ou 8 h).
export function scrollCalendar() {
  const tl = document.querySelector('.timeline');
  if (!tl) return;
  const m = Math.max(minutes(nowTime()) - 60, 8 * 60);
  const y = ((Math.min(m, 17 * 60) - START_HOUR * 60) / 60) * HOUR_PX;
  const body = tl.querySelector('.tl-body') || tl;
  if (body.scrollHeight > body.clientHeight) body.scrollTop = y;
}

// ---------- Google Agenda ----------
async function gcalSave(body, existingId) {
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events' + (existingId ? `/${encodeURIComponent(existingId)}` : '');
  const res = await googleFetch('calendar', SCOPES.calendar, state.settings.driveEmail, url, {
    method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, true);
  return (await res.json()).id;
}

function gcalBody({ title, date, start, end, allDay, description, reminder = 30 }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timed = !allDay && start;
  const endTime = end || toTime(minutes(start) + 60);
  return {
    summary: title,
    description: description || 'Ajouté depuis Mon Organisateur',
    start: timed ? { dateTime: `${date}T${start}:00`, timeZone: tz } : { date },
    end: timed ? { dateTime: `${date}T${endTime}:00`, timeZone: tz } : { date: addDays(date, 1) },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: timed ? reminder : 9 * 60 }] },
  };
}

const toTime = (m) => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, '0')}:${String(Math.min(m, 1439) % 60).padStart(2, '0')}`;

export async function pushTaskToGoogle(taskId) {
  const t = getTask(taskId);
  if (!t?.due) { toast('Ajoute d\'abord une échéance à la tâche.'); return; }
  try {
    const id = await gcalSave(gcalBody({ title: t.title, date: t.due, start: t.time, allDay: !t.time, description: 'Tâche de Mon Organisateur' }), t.gcalId);
    updateTask(taskId, { gcalId: id });
    toast(t.gcalId ? 'Mis à jour dans Google Agenda' : 'Ajouté à Google Agenda avec un rappel');
  } catch (e) {
    toast(e.message);
  }
}

async function pushEventToGoogle(id) {
  const e = getEvent(id);
  if (!e) return;
  try {
    const gid = await gcalSave(gcalBody({ ...e, description: [e.location, e.notes].filter(Boolean).join('\n') }), e.gcalId);
    saveEvent({ id, gcalId: gid });
    toast(e.gcalId ? 'Mis à jour dans Google Agenda' : 'Ajouté à Google Agenda');
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Fiche événement ----------
export function openEvent(id, prefill = {}) {
  const e = id ? getEvent(id) : { title: '', date: todayISO(), start: '', end: '', allDay: false, location: '', notes: '', ...prefill };
  if (!e) return;
  openSheet(`
    <form class="event-form" data-form="event">
      <h2 class="sheet-title">${id ? 'Événement' : 'Nouvel événement'}</h2>
      <label class="field"><span>Titre</span><input name="title" required value="${esc(e.title)}" placeholder="Réunion, cours, rendez-vous…" autocomplete="off"></label>
      <div class="ts-grid">
        <label class="field"><span>${icon('calendar')}Date</span><input type="date" name="date" required value="${esc(e.date)}"></label>
        <label class="field switch-field"><span>Toute la journée</span><label class="switch"><input type="checkbox" name="allDay" ${e.allDay ? 'checked' : ''}><i></i></label></label>
        <label class="field time-f"><span>${icon('clock')}Début</span><input type="time" name="start" value="${esc(e.start || '')}"></label>
        <label class="field time-f"><span>Fin</span><input type="time" name="end" value="${esc(e.end || '')}"></label>
      </div>
      <label class="field full"><span>Lieu</span><input name="location" value="${esc(e.location || '')}" placeholder="Salle, adresse, Teams…" autocomplete="off"></label>
      <label class="field full"><span>Notes</span><textarea name="notes" rows="2">${esc(e.notes || '')}</textarea></label>
      ${e.link ? `<a class="btn small ghost" href="${esc(e.link)}" target="_blank" rel="noopener">${icon('mail')}Voir le mail d'origine</a>` : ''}
      ${e.source === 'edt' ? '<p class="fine">Cours importé depuis ton emploi du temps.</p>' : ''}
      <div class="sheet-actions">
        ${id ? `<button type="button" class="btn ghost danger" data-ev-del>${icon('trash')}</button><button type="button" class="btn ghost" data-ev-gcal>${icon('calendar')}Google Agenda</button>` : '<button type="button" class="btn ghost" data-action="close-sheet">Annuler</button>'}
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`, (d) => {
    const form = d.querySelector('form');
    const syncAllDay = () => form.querySelectorAll('.time-f').forEach((f) => { f.hidden = form.allDay.checked; });
    syncAllDay();
    form.allDay.addEventListener('change', syncAllDay);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const allDay = form.allDay.checked || !form.start.value;
      saveEvent({
        ...(id ? { id } : { source: prefill.source || 'manuel', link: prefill.link || null }),
        title: form.title.value.trim(), date: form.date.value, allDay,
        start: allDay ? null : form.start.value, end: allDay ? null : (form.end.value || null),
        location: form.location.value.trim(), notes: form.notes.value,
      });
      closeSheet();
      toast(id ? 'Événement enregistré' : 'Événement ajouté');
    });
    d.querySelector('[data-ev-del]')?.addEventListener('click', () => openConfirm({
      title: 'Supprimer cet événement ?', text: e.title, confirm: 'Supprimer',
      onConfirm: () => { deleteEvent(id); toast('Événement supprimé', { action: 'Annuler', undo: true }); },
    }));
    d.querySelector('[data-ev-gcal]')?.addEventListener('click', () => pushEventToGoogle(id));
    if (!id) focusSoon(form.title);
  });
}

export const calendarHandlers = {
  'cal-goto': (el) => { location.hash = `#/agenda/${el.dataset.mode}/${el.dataset.date}`; },
  'open-event': (el) => openEvent(el.dataset.id),
  'new-event': (el) => openEvent(null, { date: el.dataset.date || todayISO() }),
};

