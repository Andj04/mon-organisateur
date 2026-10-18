// Panneaux (bas d'écran sur mobile, fenêtre centrée sur ordinateur) : ajout rapide, détail de tâche, projet.
import { state } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { parseQuick } from './parser.js';
import { dueLabel, WEEKDAYS_SHORT, MONDAY_FIRST, fmt, todayISO, toISO, weekday } from './dates.js';
import { recurrenceLabel } from './recurrence.js';
import {
  getTask, getProject, activeProjects, createTask, updateTask, moveTask, deleteTask, completeTask, reopenTask,
  addSubtask, toggleSubtask, deleteSubtask, suggestProject, createProject, updateProject, deleteProject, PROJECT_COLORS,
} from './actions.js';
import { projectDot, PRIORITY_LABELS } from './views.js';
import { toast } from './toast.js';

const dialog = () => document.getElementById('sheet');
let pushedHistory = false;

export function openSheet(html, onMount) {
  const d = dialog();
  d.innerHTML = `<div class="sheet-inner"><div class="grabber"></div>${html}</div>`;
  d.classList.remove('closing');
  if (!d.open) d.showModal();
  if (!pushedHistory) { history.pushState({ sheet: true }, ''); pushedHistory = true; }
  onMount?.(d);
}

function animateClose() {
  const d = dialog();
  if (!d.open) return;
  d.classList.add('closing');
  setTimeout(() => { d.close(); d.classList.remove('closing'); d.innerHTML = ''; d.onSheetClose?.(); d.onSheetClose = null; }, 180);
}

export function closeSheet() {
  animateClose();
  if (pushedHistory) { pushedHistory = false; history.back(); }
}

export function initSheets() {
  const d = dialog();
  d.addEventListener('click', (e) => { if (e.target === d) closeSheet(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  window.addEventListener('popstate', () => { if (pushedHistory) { pushedHistory = false; animateClose(); } });
}

const autosize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };

// ---------- Ajout rapide ----------
export function openQuickAdd({ projectId } = {}) {
  let manual = projectId !== undefined ? projectId : undefined; // undefined = pas de choix manuel
  let current = null;

  openSheet(`
    <form class="quick-add" data-form="qa">
      <h2 class="sheet-title">Nouvelle tâche</h2>
      <textarea name="title" rows="1" placeholder="Que dois-tu faire ?" enterkeyhint="send" autocomplete="off"></textarea>
      <div class="qa-preview" id="qa-preview"></div>
      <p class="qa-label">Projet</p>
      <div class="chips wrap" id="qa-projects"></div>
      <details class="tips"><summary>Astuces de saisie</summary>
        <p><b>demain</b>, <b>vendredi</b>, <b>le 24</b>, <b>24/10</b>, <b>3 novembre</b> · <b>14h</b>, <b>9h30</b> · <b>!</b> <b>!!</b> <b>!!!</b> pour la priorité · <b>tous les jours</b>, <b>chaque lundi</b> · <b>#projet</b></p>
      </details>
      <div class="sheet-actions">
        <button type="button" class="btn ghost" data-action="close-sheet">Fermer</button>
        <button type="submit" class="btn primary">${icon('plus')}Ajouter</button>
      </div>
    </form>`, (d) => {
    const form = d.querySelector('form');
    const input = form.title;
    const preview = d.querySelector('#qa-preview');
    const projBox = d.querySelector('#qa-projects');

    const refresh = () => {
      const text = input.value.trim();
      const parsed = parseQuick(text, state.projects);
      const auto = text && !parsed.projectId ? suggestProject(parsed.title) : null;
      const selected = manual !== undefined ? manual : parsed.projectId ?? auto?.projectId ?? null;
      current = { parsed, auto, selected };

      const chips = [];
      if (parsed.due) chips.push(`<span class="pchip">${icon('calendar')}${esc(dueLabel(parsed.due))}</span>`);
      if (parsed.time) chips.push(`<span class="pchip">${icon('clock')}${esc(parsed.time.replace(':', 'h'))}</span>`);
      if (parsed.priority) chips.push(`<span class="pchip prio-${parsed.priority}">${icon('flag')}${PRIORITY_LABELS[parsed.priority]}</span>`);
      if (parsed.recurrence) chips.push(`<span class="pchip">${icon('repeat')}${esc(recurrenceLabel(parsed.recurrence))}</span>`);
      preview.innerHTML = chips.join('');

      const pChip = (id, label, dotHtml) => {
        const isAuto = manual === undefined && auto && auto.projectId === id && !parsed.projectId;
        return `<button type="button" class="chip ${selected === id ? 'on' : ''}" data-pick="${id ?? ''}">${dotHtml}${esc(label)}${isAuto ? icon('sparkles', 'auto') : ''}</button>`;
      };
      projBox.innerHTML = [pChip(null, 'Boîte de réception', icon('inbox')),
        ...activeProjects().map((p) => pChip(p.id, p.name, projectDot(p)))].join('');
    };

    input.addEventListener('input', () => { autosize(input); refresh(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    projBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      manual = b.dataset.pick || null;
      refresh();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      refresh();
      const { parsed, auto, selected } = current;
      createTask(parsed, { projectId: selected, auto: auto?.projectId ?? null });
      const p = getProject(selected);
      toast(`Ajoutée ${p ? 'dans ' + p.name : 'dans la boîte de réception'}${parsed.due ? ' · ' + dueLabel(parsed.due).toLowerCase() : ''}`);
      input.value = '';
      autosize(input);
      manual = projectId !== undefined ? projectId : undefined;
      refresh();
      input.focus();
    });
    refresh();
    setTimeout(() => input.focus(), 60);
  });
}

// ---------- Détail d'une tâche ----------
export function openTask(id) {
  const t = getTask(id);
  if (!t) return;
  openSheet(`<div class="task-sheet" data-task="${id}"></div>`, (d) => {
    const box = d.querySelector('.task-sheet');
    renderTaskSheet(box, id);
    bindTaskSheet(box, id);
  });
}

function renderTaskSheet(box, id) {
  const t = getTask(id);
  if (!t) return;
  const projects = activeProjects();
  const rec = t.recurrence;
  box.innerHTML = `
    <div class="ts-head">
      <button class="check big ${t.done ? 'is-done' : ''} prio-${t.priority}" data-ts="toggle" aria-label="${t.done ? 'Rouvrir' : 'Terminer'}">${icon('check')}</button>
      <textarea class="ts-title" data-field="title" rows="1" aria-label="Titre">${esc(t.title)}</textarea>
      <button class="icon-btn" data-action="close-sheet" aria-label="Fermer">${icon('x')}</button>
    </div>

    <div class="ts-grid">
      <label class="field"><span>${icon('folder')}Projet</span>
        <select data-field="projectId">
          <option value="">Boîte de réception</option>
          ${projects.map((p) => `<option value="${p.id}" ${p.id === t.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        ${t.autoAssigned ? `<small class="auto-note">${icon('sparkles')}Rangée automatiquement. Change le projet si besoin, l'application apprendra.</small>` : ''}
      </label>
      <label class="field"><span>${icon('calendar')}Échéance</span>
        <input type="date" data-field="due" value="${t.due || ''}"></label>
      <label class="field"><span>${icon('clock')}Heure</span>
        <input type="time" data-field="time" value="${t.time || ''}"></label>
      <div class="field full"><span>${icon('flag')}Priorité</span>
        <div class="segmented prio">${PRIORITY_LABELS.map((l, i) => `<button type="button" class="${t.priority === i ? 'on' : ''} p${i}" data-ts="prio" data-v="${i}">${l}</button>`).join('')}</div>
      </div>
      <div class="field full"><span>${icon('repeat')}Répétition</span>
        <div class="segmented">
          <button type="button" class="${!rec ? 'on' : ''}" data-ts="rec" data-v="none">Aucune</button>
          <button type="button" class="${rec?.freq === 'daily' ? 'on' : ''}" data-ts="rec" data-v="daily">Chaque jour</button>
          <button type="button" class="${rec?.freq === 'weekly' ? 'on' : ''}" data-ts="rec" data-v="weekly">Chaque semaine</button>
        </div>
        ${rec?.freq === 'weekly' ? `<div class="days">${MONDAY_FIRST.map((d) => `<button type="button" class="${rec.days.includes(d) ? 'on' : ''}" data-ts="day" data-v="${d}">${WEEKDAYS_SHORT[d]}</button>`).join('')}</div>` : ''}
      </div>
    </div>

    <div class="field full"><span>${icon('list')}Sous-tâches</span>
      <div class="subtasks">
        ${t.subtasks.map((s) => `
          <div class="subtask ${s.done ? 'is-done' : ''}">
            <button class="check small" data-ts="sub-toggle" data-v="${s.id}" aria-label="Cocher">${icon('check')}</button>
            <span>${esc(s.title)}</span>
            <button class="icon-btn small" data-ts="sub-del" data-v="${s.id}" aria-label="Supprimer">${icon('x')}</button>
          </div>`).join('')}
        <form class="sub-add" data-ts-form="sub">${icon('plus')}<input name="sub" placeholder="Ajouter une sous-tâche" autocomplete="off" enterkeyhint="done"></form>
      </div>
    </div>

    <label class="field full"><span>${icon('pencil')}Notes</span>
      <textarea data-field="notes" rows="3" placeholder="Détails, liens, contacts…">${esc(t.notes)}</textarea></label>

    <div class="ts-foot">
      <span class="fine">Créée le ${esc(fmt(toISO(new Date(t.createdAt)), { day: 'numeric', month: 'long' }))}</span>
      <button class="btn ghost danger" data-ts="delete">${icon('trash')}Supprimer</button>
    </div>`;
  box.querySelectorAll('textarea').forEach(autosize);
}

function bindTaskSheet(box, id) {
  const rerender = () => renderTaskSheet(box, id);
  let timer;
  box.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (e.target.tagName === 'TEXTAREA') autosize(e.target);
    if (f === 'title' || f === 'notes') {
      clearTimeout(timer);
      const value = e.target.value;
      timer = setTimeout(() => { if (f === 'notes' || value.trim()) updateTask(id, { [f]: f === 'title' ? value.trim() : value }); }, 300);
    }
  });
  box.addEventListener('change', (e) => {
    const f = e.target.dataset.field;
    if (f === 'projectId') { moveTask(id, e.target.value || null); rerender(); }
    else if (f === 'due') { updateTask(id, { due: e.target.value || null, notified: null }); }
    else if (f === 'time') { updateTask(id, { time: e.target.value || null, notified: null }); }
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ts]');
    if (!b) return;
    const t = getTask(id);
    const v = b.dataset.v;
    switch (b.dataset.ts) {
      case 'toggle':
        if (t.done) { reopenTask(id); rerender(); break; }
        { const next = completeTask(id); closeSheet(); toastDone(t, next); }
        break;
      case 'prio': updateTask(id, { priority: Number(v) }); rerender(); break;
      case 'rec':
        if (v === 'none') updateTask(id, { recurrence: null });
        else if (v === 'daily') updateTask(id, { recurrence: { freq: 'daily', days: [] } });
        else updateTask(id, { recurrence: { freq: 'weekly', days: [weekday(t.due || todayISO())] } });
        rerender();
        break;
      case 'day': {
        const d = Number(v);
        const days = t.recurrence.days.includes(d) ? t.recurrence.days.filter((x) => x !== d) : [...t.recurrence.days, d];
        if (days.length) updateTask(id, { recurrence: { freq: 'weekly', days } });
        rerender();
        break;
      }
      case 'sub-toggle': toggleSubtask(id, v); rerender(); break;
      case 'sub-del': deleteSubtask(id, v); rerender(); break;
      case 'delete':
        deleteTask(id);
        closeSheet();
        toast('Tâche supprimée', { action: 'Annuler', undo: true });
        break;
    }
  });
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.sub;
    if (!input.value.trim()) return;
    addSubtask(id, input.value);
    rerender();
    box.querySelector('.sub-add input')?.focus();
  });
}

export function toastDone(t, next) {
  toast(next ? `Bravo ! Prochaine fois : ${dueLabel(next).toLowerCase()}` : `« ${t.title} » terminée`, { action: 'Annuler', undo: true });
}

// ---------- Projet ----------
export function openProjectEditor(id, onCreated) {
  const p = id ? getProject(id) : null;
  let color = p?.color || PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length];
  openSheet(`
    <form class="project-form" data-form="project">
      <h2 class="sheet-title">${p ? 'Modifier le projet' : 'Nouveau projet'}</h2>
      <label class="field"><span>Nom</span><input name="name" required maxlength="60" value="${esc(p?.name || '')}" placeholder="Ex : Association, PFE, Stage…" autocomplete="off"></label>
      <label class="field"><span>Description</span><textarea name="description" rows="3" placeholder="De quoi s'agit-il ? Ces mots aident aussi le rangement automatique.">${esc(p?.description || '')}</textarea></label>
      <div class="field"><span>Couleur</span><div class="swatches">${PROJECT_COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'on' : ''}" style="--c:${c}" data-color="${c}" aria-label="Couleur ${c}"></button>`).join('')}</div></div>
      <div class="sheet-actions">
        ${p ? `<button type="button" class="btn ghost danger" data-del>${icon('trash')}Supprimer</button>` : '<button type="button" class="btn ghost" data-action="close-sheet">Annuler</button>'}
        <button type="submit" class="btn primary">${p ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>`, (d) => {
    const form = d.querySelector('form');
    d.querySelectorAll('textarea').forEach(autosize);
    form.addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') autosize(e.target); });
    form.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-color]');
      if (sw) {
        color = sw.dataset.color;
        form.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === sw));
      }
      if (e.target.closest('[data-del]')) {
        const n = state.tasks.filter((t) => t.projectId === id).length;
        openConfirm({
          title: `Supprimer « ${p.name} » ?`,
          text: n ? `Ses ${n} tâche${n > 1 ? 's' : ''} iront dans la boîte de réception.` : 'Ce projet ne contient aucune tâche.',
          confirm: 'Supprimer',
          onConfirm: () => { deleteProject(id); location.hash = '#/projets'; toast('Projet supprimé', { action: 'Annuler', undo: true }); },
        });
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      const data = { name, description: form.description.value.trim(), color };
      if (p) { updateProject(id, data); closeSheet(); toast('Projet enregistré'); }
      else { const newId = createProject(data); closeSheet(); toast(`Projet « ${name} » créé`); onCreated?.(newId); }
    });
    if (!p) setTimeout(() => form.name.focus(), 60);
  });
}

// ---------- Confirmation ----------
export function openConfirm({ title, text, confirm, onConfirm }) {
  openSheet(`
    <div class="confirm">
      <h2 class="sheet-title">${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="sheet-actions">
        <button class="btn ghost" data-action="close-sheet">Annuler</button>
        <button class="btn danger-fill" data-ok>${esc(confirm)}</button>
      </div>
    </div>`, (d) => {
    d.querySelector('[data-ok]').addEventListener('click', () => { closeSheet(); onConfirm(); });
  });
}
