// Tâches récurrentes : journalières ou hebdomadaires (un ou plusieurs jours).
import { addDays, weekday, WEEKDAYS, MONDAY_FIRST } from './dates.js';

// Première occurrence à partir d'aujourd'hui inclus.
export function firstDue(rec, today) {
  if (rec.freq === 'daily') return today;
  for (let i = 0; i < 7; i++) {
    const c = addDays(today, i);
    if (rec.days.includes(weekday(c))) return c;
  }
  return today;
}

// Occurrence suivante après avoir terminé la tâche.
export function nextDue(task, today) {
  const rec = task.recurrence;
  const base = task.due && task.due > today ? task.due : today;
  if (rec.freq === 'daily') return addDays(base, 1);
  const days = rec.days.length ? rec.days : [weekday(task.due || today)];
  for (let i = 1; i <= 7; i++) {
    const c = addDays(base, i);
    if (days.includes(weekday(c))) return c;
  }
  return addDays(base, 7);
}

export function recurrenceLabel(rec) {
  if (!rec) return '';
  if (rec.freq === 'daily') return 'Tous les jours';
  const days = MONDAY_FIRST.filter((d) => rec.days.includes(d));
  if (!days.length) return 'Chaque semaine';
  if (days.length === 7) return 'Tous les jours';
  return 'Chaque ' + days.map((d) => WEEKDAYS[d]).join(', ');
}
