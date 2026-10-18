// Saisie rapide : comprend dates, heures, priorités, récurrences et #projet écrits en français.
// Exemple : "Préparer la réunion asso demain 14h !! #asso"
import { todayISO, addDays, toISO, weekday, isValidDate, fromISO } from './dates.js';
import { normalize } from './text.js';
import { firstDue } from './recurrence.js';

const DAY_NAMES = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
const DAY_RE = '(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)';
const MONTHS = {
  janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};
const MONTH_RE = '(janvier|janv\\.?|f[ée]vrier|f[ée]vr?\\.?|mars|avril|avr\\.?|mai|juin|juillet|juil\\.?|ao[uû]t|septembre|sept\\.?|octobre|oct\\.?|novembre|nov\\.?|d[ée]cembre|d[ée]c\\.?)';
const PRE = "(?:(?:pour|avant|d'ici|d’ici|jusqu'(?:à|au)|jusqu’(?:à|au))\\s+)?(?:(?:le|ce|la)\\s+)?";
const END = '(?=[\\s,.;!?]|$)';

function guessYear(m, d, today) {
  const t = fromISO(today);
  let y = t.getFullYear();
  const candidate = toISO(new Date(y, m - 1, d));
  // Une date passée depuis plus de deux mois désigne sans doute l'année suivante.
  if ((fromISO(today) - fromISO(candidate)) / 86400000 > 60) y += 1;
  return y;
}

export function parseQuick(input, projects = [], today = todayISO()) {
  let s = ' ' + input + ' ';
  const out = { due: null, time: null, priority: 0, recurrence: null, projectId: null };

  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  // #projet
  take(/\s#([\p{L}\p{N}_-]+)/u, (m) => {
    const tag = normalize(m[1]).replace(/[-_]/g, '');
    const p = projects.find((p) => !p.archived && normalize(p.name).replace(/[\s'-]/g, '').startsWith(tag));
    if (!p) return false;
    out.projectId = p.id;
  });

  // Priorité
  take(new RegExp('\\s!(haute|urgent|moyenne|basse)' + END, 'i'), (m) => {
    out.priority = { haute: 3, urgent: 3, moyenne: 2, basse: 1 }[m[1].toLowerCase()];
  }) || take(new RegExp('\\s(!{1,3})' + END), (m) => { out.priority = m[1].length; });

  // Récurrence
  take(new RegExp("\\s(?:tous les jours|chaque jour|quotidiennement|quotidien)" + END, 'i'), () => {
    out.recurrence = { freq: 'daily', days: [] };
  }) ||
  take(new RegExp(`\\s(?:chaque|tous les)\\s+(${DAY_RE}s?(?:\\s*(?:,|et)\\s*${DAY_RE}s?)*)` + END, 'i'), (m) => {
    const days = [...m[1].toLowerCase().matchAll(new RegExp(DAY_RE, 'g'))].map((x) => DAY_NAMES[x[0]]);
    out.recurrence = { freq: 'weekly', days: [...new Set(days)] };
  }) ||
  take(new RegExp('\\s(?:toutes les semaines|chaque semaine|hebdomadaire|hebdo)' + END, 'i'), () => {
    out.recurrence = { freq: 'weekly', days: [] };
  });

  // Heure : 14h, 14h30, 14:30, "à 9h"
  take(new RegExp('\\s(?:(?:à|a|vers)\\s+)?(\\d{1,2})\\s?(?:h|:)\\s?(\\d{2})?' + END, 'i'), (m) => {
    const h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (h > 23 || min > 59) return false;
    out.time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  });

  // Dates
  const setDue = (iso) => { out.due = iso; };
  take(new RegExp(`\\s${PRE}(?:aujourd'hui|aujourd’hui|auj|ce soir)` + END, 'i'), () => setDue(today)) ||
  take(new RegExp(`\\s${PRE}apr[eè]s[- ]demain` + END, 'i'), () => setDue(addDays(today, 2))) ||
  take(new RegExp(`\\s${PRE}demain` + END, 'i'), () => setDue(addDays(today, 1))) ||
  take(new RegExp(`\\s${PRE}(?:la\\s+)?semaine prochaine` + END, 'i'), () => {
    const wd = weekday(today);
    setDue(addDays(today, ((8 - wd) % 7) || 7));
  }) ||
  take(new RegExp(`\\s${PRE}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?` + END), (m) => {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : guessYear(mo, d, today);
    if (y < 100) y += 2000;
    if (!isValidDate(y, mo, d)) return false;
    setDue(toISO(new Date(y, mo - 1, d)));
  }) ||
  take(new RegExp(`\\s${PRE}(\\d{1,2})(?:er)?\\s+${MONTH_RE}(?:\\s+(\\d{4}))?` + END, 'i'), (m) => {
    const d = Number(m[1]);
    const mo = MONTHS[normalize(m[2]).replace('.', '')];
    const y = m[3] ? Number(m[3]) : guessYear(mo, d, today);
    if (!mo || !isValidDate(y, mo, d)) return false;
    setDue(toISO(new Date(y, mo - 1, d)));
  }) ||
  (!out.recurrence && take(new RegExp(`\\s${PRE}(${DAY_RE})(?:\\s+prochain)?` + END, 'i'), (m) => {
    const target = DAY_NAMES[m[1].toLowerCase()];
    const delta = ((target - weekday(today) + 7) % 7) || 7;
    setDue(addDays(today, delta));
  })) ||
  take(new RegExp(`\\s(?:pour|avant|d'ici|d’ici)?\\s*le\\s+(\\d{1,2})(?:er)?` + END, 'i'), (m) => {
    const d = Number(m[1]);
    const t = fromISO(today);
    let y = t.getFullYear();
    let mo = t.getMonth() + 1;
    if (d < t.getDate()) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    if (!isValidDate(y, mo, d)) return false;
    setDue(toISO(new Date(y, mo - 1, d)));
  });

  if (out.recurrence) {
    if (out.recurrence.freq === 'weekly' && !out.recurrence.days.length) {
      out.recurrence.days = [weekday(out.due || today)];
    }
    if (!out.due) out.due = firstDue(out.recurrence, today);
  }

  let title = s.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = title;
    title = title.replace(/[\s,]+(pour|avant|le|à|a|d'ici|d’ici|ce|cet|et)$/i, '').replace(/[\s,;-]+$/, '');
  } while (title !== prev);
  out.title = title || input.trim();
  return out;
}

// Repère les dates futures citées dans un texte (objet ou extrait de mail).
// Renvoie [{ due, time, label }] sans doublon, triées.
const FIND_DATE_RE = new RegExp(
  `(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?|(\\d{1,2})(?:er)?\\s+${MONTH_RE}(?:\\s+(\\d{4}))?|\\b(demain|apr[eè]s[- ]demain)\\b`,
  'gi',
);
const FIND_TIME_RE = /^[\s,]*(?:(?:à|a|de|dès|vers)\s+)?(\d{1,2})\s?(?:h|:)\s?(\d{2})?/i;

export function findDates(text, today = todayISO()) {
  const out = new Map();
  const horizon = addDays(today, 366);
  for (const m of String(text || '').matchAll(FIND_DATE_RE)) {
    let iso = null;
    if (m[1]) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      let y = m[3] ? Number(m[3]) : guessYear(mo, d, today);
      if (y < 100) y += 2000;
      if (mo >= 1 && mo <= 12 && isValidDate(y, mo, d)) iso = toISO(new Date(y, mo - 1, d));
    } else if (m[4]) {
      const d = Number(m[4]);
      const mo = MONTHS[normalize(m[5]).replace('.', '')];
      const y = m[6] ? Number(m[6]) : guessYear(mo, d, today);
      if (mo && isValidDate(y, mo, d)) iso = toISO(new Date(y, mo - 1, d));
    } else if (m[7]) {
      iso = addDays(today, /apr/i.test(m[7]) ? 2 : 1);
    }
    if (!iso || iso < today || iso > horizon) continue;
    const after = String(text).slice(m.index + m[0].length, m.index + m[0].length + 14);
    const tm = after.match(FIND_TIME_RE);
    let time = null;
    if (tm && Number(tm[1]) < 24 && Number(tm[2] || 0) < 60) time = `${String(tm[1]).padStart(2, '0')}:${String(tm[2] || '00').padStart(2, '0')}`;
    const key = iso + (time || '');
    if (!out.has(key)) out.set(key, { due: iso, time, label: m[0].trim() });
  }
  return [...out.values()].sort((a, b) => (a.due + (a.time || '')).localeCompare(b.due + (b.time || '')));
}
