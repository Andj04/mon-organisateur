// Lecture de l'emploi du temps de l'école (Excel) et tri des cours qui te concernent.
// Fonctions pures, sans dépendance au navigateur, pour pouvoir les tester.
import { normalize } from './text.js';

const pad = (n) => String(n).padStart(2, '0');
const SLOT_RE = /(\d{1,2})\s*h\s*(\d{2})?\s*(?:à|a|-)\s*(\d{1,2})\s*h\s*(\d{2})?/i;
const LEADING_TIME_RE = /^\s*(\d{1,2})\s*h\s*(\d{2})?\s*-\s*(\d{1,2})\s*h\s*(\d{2})?\s*-?\s*/i;
const ROOM_RE = /^(amphi\s*\d*|gymnase|[a-h]\d{3}|g\d{1,3}|salle\b.*)$/i;

// Une date Excel peut arriver en nombre de jours (format interne), en objet Date ou en texte AAAA-MM-JJ.
export function cellDate(v) {
  if (typeof v === 'number' && v > 40000 && v < 70000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

const hm = (h, m) => `${pad(Number(h))}:${pad(Number(m || 0))}`;

const MONTH_PREFIX = { jan: 1, fev: 2, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Date du lundi d'après le nom de l'onglet ("07 Déc-11 Déc", "26-30 oct", "1 fév-5 fév.").
export function dateFromSheetName(name, academicYear) {
  const n = normalize(name);
  const day = n.match(/\d{1,2}/);
  const month = n.match(/\b(janv?|fevr?|mars?|avr|mai|juin|juil|aout?|sept?|oct|nov|dec)[a-z]*\.?/);
  if (!day || !month || !academicYear) return null;
  const key = Object.keys(MONTH_PREFIX).find((k) => month[1].startsWith(k) || k.startsWith(month[1]));
  const m = MONTH_PREFIX[key];
  if (!m) return null;
  const y = m >= 8 ? academicYear : academicYear + 1;
  const d = Number(day[0]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const shiftISO = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const frDate = (iso) => iso.split('-').reverse().join('/');
const daysBetween = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// sheets : liste d'onglets. Renvoie { slots, warnings }.
export function parseWorkbook(sheets) {
  let academicYear = null;
  for (const sh of sheets) {
    for (const v of Object.values(sh.cells)) {
      const m = typeof v === 'string' && v.match(/(20\d{2})\s*\/\s*(20\d{2})/);
      if (m) { academicYear = Number(m[1]); break; }
    }
    if (academicYear) break;
  }
  const slots = [];
  const warnings = [];
  for (const sh of sheets) {
    const res = parseSheet(sh);
    if (!res.length) continue;
    const first = res.firstDay;
    const expected = dateFromSheetName(sh.name, academicYear);
    let shift = 0;
    if (first && expected && first !== expected) {
      shift = daysBetween(expected, first);
      warnings.push(`Onglet « ${sh.name.trim()} » : les dates écrites dans le fichier (${frDate(first)}) ne correspondent pas au nom de l'onglet. Dates corrigées au ${frDate(expected)}.`);
    }
    for (const x of res) slots.push(shift ? { ...x, date: shiftISO(x.date, shift) } : x);
  }
  slots.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  return { slots, warnings, academicYear };
}

// sheet : { name, cells: { "r,c": valeur }, merges: [{ s: { r, c }, e: { r, c } }] } (indices à partir de 0)
export function parseSheet(sheet) {
  const cells = sheet.cells;
  const mergeAt = new Map();
  for (const m of sheet.merges || []) mergeAt.set(`${m.s.r},${m.s.c}`, m);
  const rangeOf = (r, c) => mergeAt.get(`${r},${c}`) || { s: { r, c }, e: { r, c } };
  const entries = Object.entries(cells).map(([k, v]) => { const [r, c] = k.split(',').map(Number); return { r, c, v }; });

  // 1. Ligne des dates : celle qui contient au moins trois dates.
  const byRow = new Map();
  for (const e of entries) if (cellDate(e.v)) byRow.set(e.r, [...(byRow.get(e.r) || []), e]);
  const dateRow = [...byRow.entries()].filter(([, l]) => l.length >= 3).sort((a, b) => a[0] - b[0])[0];
  if (!dateRow) return [];
  const dayOfCol = new Map();
  for (const e of dateRow[1]) {
    const rg = rangeOf(e.r, e.c);
    for (let c = rg.s.c; c <= rg.e.c; c++) dayOfCol.set(c, cellDate(e.v));
  }
  const headerRow = dateRow[0];

  // 2. Créneaux horaires : première colonne, lignes sous les dates.
  const slots = entries
    .filter((e) => e.c === 0 && e.r > headerRow && typeof e.v === 'string' && SLOT_RE.test(e.v))
    .map((e) => {
      const m = e.v.match(SLOT_RE);
      const rg = rangeOf(e.r, e.c);
      return { r1: rg.s.r, r2: rg.e.r, start: hm(m[1], m[2]), end: hm(m[3], m[4]) };
    })
    .sort((a, b) => a.r1 - b.r1);
  if (!slots.length) return [];

  // 3. Chaque case remplie devient un cours, pour chaque jour qu'elle couvre.
  const out = [];
  out.firstDay = [...dayOfCol.values()].sort()[0] || null;
  for (const e of entries) {
    if (e.c === 0 || e.r <= headerRow || typeof e.v !== 'string') continue;
    let text = e.v.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (!text) continue;
    const rg = rangeOf(e.r, e.c);
    const over = slots.filter((s) => s.r1 <= rg.e.r && s.r2 >= rg.s.r);
    if (!over.length) continue;
    const days = [];
    for (let c = rg.s.c; c <= rg.e.c; c++) { const d = dayOfCol.get(c); if (d && !days.includes(d)) days.push(d); }
    if (!days.length) continue;
    let start = over[0].start;
    let end = over[over.length - 1].end;
    const lt = text.match(LEADING_TIME_RE);
    if (lt) { start = hm(lt[1], lt[2]); end = hm(lt[3], lt[4]); text = text.slice(lt[0].length).trim(); }
    const allDay = slots.length >= 3 && over.length === slots.length;
    for (const date of days) out.push({ date, start: allDay ? null : start, end: allDay ? null : end, allDay, text, sheet: sheet.name });
  }
  return out;
}

function titleAndPlace(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const parts = (lines[0] || '').split(/\s*-\s+|\s+-\s*/).map((p) => p.trim()).filter(Boolean);
  let title = parts[0] || '';
  if (parts.slice(1).some((p) => /examen/i.test(p))) title += ' · Examen';
  let location = '';
  for (const p of [...parts.slice(1), ...lines.slice(1)]) {
    if (ROOM_RE.test(p)) { location = p; break; }
    if (/distanciel|teams/i.test(p)) location = 'Distanciel (Teams)';
  }
  return { title, location };
}

// filters : { filiere: 'Conseil', option: 'GI', groupe: '7', groupeTP: '' }
export function classify(raw, filters) {
  const text = raw.trim();
  let m;
  if ((m = text.match(/^fili[eè]re\s+([^:]+?)\s*:\s*([\s\S]*)$/i))) {
    const name = m[1].trim();
    const keep = Boolean(filters.filiere) && normalize(name).startsWith(normalize(filters.filiere));
    const { title, location } = titleAndPlace(m[2]);
    return { keep, category: 'filiere', title: title ? `${name} · ${title}` : `Filière ${name}`, location, reason: keep ? '' : `Filière ${name}` };
  }
  if ((m = text.match(/^(SDD|GI|EDD)\s*:\s*(?:\1\s*:\s*)?([\s\S]*)$/i))) {
    const option = m[1].toUpperCase();
    let keep = option === String(filters.option || '').toUpperCase();
    const sub = m[2].match(/groupe\s*(\d+)/i);
    let reason = keep ? '' : `Option ${option}`;
    if (keep && sub && filters.groupeTP && sub[1] !== String(filters.groupeTP)) { keep = false; reason = `Groupe TP ${sub[1]}`; }
    const { title, location } = titleAndPlace(m[2]);
    const label = (title || option) + (sub ? ` (TP groupe ${sub[1]})` : '');
    return { keep, category: 'option', title: label, location, reason };
  }
  if ((m = text.match(/^groupe\s*(\d+)\s*:\s*(ANG|FR)\w*\s*:\s*([\s\S]*)$/i))) {
    const keep = m[1] === String(filters.groupe);
    const lang = m[2].toUpperCase() === 'ANG' ? 'Anglais' : 'Français';
    const { location } = titleAndPlace(m[3]);
    const room = location || (m[3].match(/\b([A-H]\d{3})\b/) || [])[1] || '';
    return { keep, category: 'langue', title: `${lang} (groupe ${m[1]})`, location: room, reason: keep ? '' : `Groupe ${m[1]}` };
  }
  const { title, location } = titleAndPlace(text);
  return { keep: true, category: 'commun', title: title || text, location, reason: '' };
}

export function buildCandidates(slots, filters) {
  return slots.map((s, i) => {
    const c = classify(s.text, filters);
    return { key: `c${i}`, date: s.date, start: s.start, end: s.end, allDay: Boolean(s.allDay), title: c.title, location: c.location, notes: s.text, keep: c.keep, reason: c.reason, category: c.category };
  });
}
