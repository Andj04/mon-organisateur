// Actions métier : projets, tâches, sous-tâches. Toute modification passe par ici.
import { state, update, uid } from './store.js';
import { learn, unlearn, forget, predict, CORRECTION_WEIGHT } from './classifier.js';
import { todayISO, addDays } from './dates.js';
import { nextDue, firstDue } from './recurrence.js';

export const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#64748b'];

export const getProject = (id) => state.projects.find((p) => p.id === id) || null;
export const getTask = (id) => state.tasks.find((t) => t.id === id) || null;
export const activeProjects = () => state.projects.filter((p) => !p.archived);

function touch(s, projectId) {
  const p = projectId && s.projects.find((x) => x.id === projectId);
  if (p) p.lastActivity = Date.now();
}

// ---- Projets ----
export function createProject({ name, description = '', color }) {
  const id = uid();
  update((s) => {
    s.projects.push({
      id,
      name: name.trim(),
      description: description.trim(),
      color: color || PROJECT_COLORS[s.projects.length % PROJECT_COLORS.length],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      archived: false,
      inactivityDays: 14,
    });
  });
  return id;
}

export function updateProject(id, patch) {
  update((s) => {
    const p = s.projects.find((x) => x.id === id);
    if (p) Object.assign(p, patch, { lastActivity: Date.now() });
  });
}

export function deleteProject(id) {
  update((s) => {
    s.projects = s.projects.filter((p) => p.id !== id);
    for (const t of s.tasks) if (t.projectId === id) { t.projectId = null; t.learned = null; }
    forget(s.model, id);
  }, { undoable: true });
}

// ---- Rangement automatique ----
export const suggestProject = (title) => predict(state.model, title, state.projects);

// ---- Tâches ----
// parsed : résultat de parseQuick. auto : projet proposé par le classifieur (ou null).
// projectId : projet final choisi (null = boîte de réception, undefined = celui écrit avec #).
export function createTask(parsed, { projectId, auto = null } = {}) {
  const id = uid();
  update((s) => {
    const finalProject = projectId !== undefined ? projectId : parsed.projectId ?? null;
    const corrected = auto && finalProject !== auto;
    const weight = corrected || parsed.projectId ? CORRECTION_WEIGHT : 1;
    if (auto && !corrected) s.stats.autoKept++;
    if (corrected) s.stats.autoFixed++;
    if (finalProject) learn(s.model, parsed.title, finalProject, weight);
    s.tasks.push({
      id,
      title: parsed.title,
      notes: '',
      projectId: finalProject,
      due: parsed.due,
      time: parsed.time,
      priority: parsed.priority || 0,
      recurrence: parsed.recurrence,
      subtasks: [],
      done: false,
      doneAt: null,
      autoAssigned: Boolean(auto && !corrected && finalProject),
      learned: finalProject ? { projectId: finalProject, weight } : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    touch(s, finalProject);
  });
  return id;
}

export function updateTask(id, patch) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    if ('recurrence' in patch && patch.recurrence && !t.due && !patch.due) {
      patch.due = firstDue(patch.recurrence, todayISO());
    }
    if ('title' in patch && t.learned && patch.title !== t.title) {
      unlearn(s.model, t.title, t.learned.projectId, t.learned.weight);
      learn(s.model, patch.title, t.learned.projectId, t.learned.weight);
    }
    Object.assign(t, patch, { updatedAt: Date.now() });
    touch(s, t.projectId);
  });
}

// Changement de projet à la main : c'est une correction, le classifieur en tient compte.
export function moveTask(id, projectId) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t || t.projectId === projectId) return;
    if (t.learned) unlearn(s.model, t.title, t.learned.projectId, t.learned.weight);
    if (t.autoAssigned) { s.stats.autoFixed++; s.stats.autoKept = Math.max(0, s.stats.autoKept - 1); }
    t.projectId = projectId;
    t.autoAssigned = false;
    t.learned = projectId ? { projectId, weight: CORRECTION_WEIGHT } : null;
    if (projectId) learn(s.model, t.title, projectId, CORRECTION_WEIGHT);
    t.updatedAt = Date.now();
    touch(s, projectId);
  });
}

// Terminer une tâche. Une tâche récurrente passe à sa prochaine occurrence.
export function completeTask(id) {
  let next = null;
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    const today = todayISO();
    s.log.push({ taskId: t.id, projectId: t.projectId, title: t.title, at: Date.now() });
    if (s.log.length > 2000) s.log = s.log.slice(-2000);
    if (t.recurrence) {
      next = nextDue(t, today);
      t.due = next;
      t.subtasks.forEach((st) => { st.done = false; });
      t.notified = null;
    } else {
      t.done = true;
      t.doneAt = Date.now();
    }
    t.updatedAt = Date.now();
    touch(s, t.projectId);
  }, { undoable: true });
  return next;
}

export function reopenTask(id) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = false;
    t.doneAt = null;
    t.updatedAt = Date.now();
    touch(s, t.projectId);
  });
}

export function deleteTask(id) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (t?.learned) unlearn(s.model, t.title, t.learned.projectId, t.learned.weight);
    s.tasks = s.tasks.filter((x) => x.id !== id);
  }, { undoable: true });
}

export function addSubtask(taskId, title) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t || !title.trim()) return;
    t.subtasks.push({ id: uid(), title: title.trim(), done: false });
    t.updatedAt = Date.now();
    touch(s, t.projectId);
  });
}

export function toggleSubtask(taskId, subId) {
  update((s) => {
    const st = s.tasks.find((x) => x.id === taskId)?.subtasks.find((x) => x.id === subId);
    if (!st) return;
    st.done = !st.done;
    touch(s, s.tasks.find((x) => x.id === taskId).projectId);
  });
}

export function deleteSubtask(taskId, subId) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    if (t) t.subtasks = t.subtasks.filter((x) => x.id !== subId);
  });
}

// Les tâches journalières non faites ne restent pas "en retard" : elles reviennent sur aujourd'hui.
export function rollDailyTasks() {
  const today = todayISO();
  const late = state.tasks.filter((t) => !t.done && t.recurrence?.freq === 'daily' && t.due && t.due < today);
  if (!late.length) return;
  update((s) => {
    for (const t of s.tasks) {
      if (!t.done && t.recurrence?.freq === 'daily' && t.due && t.due < today) {
        t.due = today;
        t.subtasks.forEach((st) => { st.done = false; });
      }
    }
  });
}

// ---- Sélections ----
export const openTasks = () => state.tasks.filter((t) => !t.done);
export const doneToday = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return state.log.filter((l) => l.at >= start.getTime());
};

export function sortTasks(list) {
  return [...list].sort((a, b) =>
    (a.due || '9999').localeCompare(b.due || '9999') ||
    (a.time || '99').localeCompare(b.time || '99') ||
    b.priority - a.priority ||
    a.createdAt - b.createdAt);
}

export function bucketOf(t, today = todayISO()) {
  if (!t.due) return 'nodate';
  if (t.due < today) return 'overdue';
  if (t.due === today) return 'today';
  if (t.due === addDays(today, 1)) return 'tomorrow';
  if (t.due <= addDays(today, 7)) return 'week';
  return 'later';
}
