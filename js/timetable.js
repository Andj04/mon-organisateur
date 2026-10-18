// Import de l'emploi du temps : Excel (lu sur l'appareil) ou PDF (lu par Gemini), puis vérification avant validation.
import { state, update, local } from './store.js';
import { esc, normalize } from './text.js';
import { icon } from './icons.js';
import { fmt, cap, todayISO } from './dates.js';
import { parseWorkbook, buildCandidates } from './timetable-parse.js';
import { replaceImportedEvents } from './actions.js';
import { openSheet, closeSheet } from './sheets.js';
import { toast } from './toast.js';
import { callAssistantApi } from './assistant.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let review = null; // { candidates, removals, warnings, from, to, source }

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Impossible de charger le lecteur Excel. Vérifie ta connexion.'));
    document.head.appendChild(s);
  });
}

async function readExcel(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const cells = {};
    for (const key of Object.keys(ws)) {
      if (key.startsWith('!')) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      const cell = ws[key];
      cells[`${r},${c}`] = cell.t === 'n' ? cell.v : String(cell.v ?? cell.w ?? '');
    }
    return { name, cells, merges: ws['!merges'] || [] };
  });
  return parseWorkbook(sheets);
}

const toBase64 = (buf) => {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

async function readPdf(file) {
  if (file.size > 3 * 1024 * 1024) throw new Error('PDF trop lourd (3 Mo maximum).');
  const now = new Date();
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const year = `${start}/${start + 1}`;
  const text = await callAssistantApi({ kind: 'timetable', pdf: toBase64(await file.arrayBuffer()), today: todayISO(), year });
  let list;
  try { list = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('Gemini n\'a pas renvoyé un résultat lisible. Réessaie.'); }
  const slots = (Array.isArray(list) ? list : [])
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.text)
    .map((x) => ({ date: x.date, start: /^\d{2}:\d{2}$/.test(x.start) ? x.start : null, end: /^\d{2}:\d{2}$/.test(x.end) ? x.end : null, allDay: !x.start, text: String(x.text) }));
  if (!slots.length) throw new Error('Aucun cours trouvé dans ce PDF.');
  return { slots, warnings: ['Lecture faite par Gemini : vérifie bien les horaires avant de valider.'] };
}

const matchKey = (e) => `${e.date}|${e.start || ''}|${normalize(e.title).slice(0, 24)}`;

function prepare({ slots, warnings }, source) {
  const candidates = buildCandidates(slots, state.shared.timetable);
  const dates = candidates.map((c) => c.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  const existing = state.events.filter((e) => e.source === 'edt' && e.date >= from && e.date <= to);
  const existingKeys = new Map(existing.map((e) => [matchKey(e), e]));
  const keptKeys = new Set();
  for (const c of candidates) {
    c.checked = c.keep;
    c.status = existingKeys.has(matchKey(c)) ? 'same' : 'new';
    if (c.keep) keptKeys.add(matchKey(c));
  }
  // Un PDF lu par l'IA peut oublier une case : on ne retire rien sans ton accord.
  const removals = existing.filter((e) => !keptKeys.has(matchKey(e))).map((e) => ({ ...e, checked: source !== 'pdf' }));
  review = { candidates, removals, warnings, from, to, source, showAll: false };
}

// ---------- Affichage ----------
function filtersForm() {
  const f = state.shared.timetable;
  return `
  <div class="tt-filters">
    <label class="field"><span>Filière</span><input data-tt="filiere" value="${esc(f.filiere)}" placeholder="Conseil"></label>
    <label class="field"><span>Option</span><input data-tt="option" value="${esc(f.option)}" placeholder="GI"></label>
    <label class="field"><span>Groupe de langue</span><input data-tt="groupe" value="${esc(f.groupe)}" inputmode="numeric" placeholder="7"></label>
    <label class="field"><span>Groupe de TP (vide = tous)</span><input data-tt="groupeTP" value="${esc(f.groupeTP || '')}" inputmode="numeric" placeholder="1 ou 2"></label>
  </div>`;
}

function pickerHtml() {
  return `
  <div class="tt">
    <h2 class="sheet-title">Importer l'emploi du temps</h2>
    <p class="fine">Excel : lu directement sur ton appareil. PDF : envoyé à Gemini pour être lu (l'assistant doit être configuré). Dans les deux cas, tu vérifies tout avant de valider.</p>
    ${filtersForm()}
    <label class="dropzone">${icon('upload')}<strong>Choisir un fichier</strong><span>.xlsx ou .pdf</span>
      <input type="file" accept=".xlsx,.xls,.pdf,application/pdf" data-tt-file hidden></label>
    <div class="tt-status" aria-live="polite"></div>
  </div>`;
}

function reviewHtml() {
  const r = review;
  const kept = r.candidates.filter((c) => c.checked);
  const fresh = kept.filter((c) => c.status === 'new').length;
  const removed = r.removals.filter((x) => x.checked).length;
  const hidden = r.candidates.filter((c) => !c.keep).length;
  const shown = r.candidates.filter((c) => r.showAll || c.keep);
  const byDay = new Map();
  for (const c of shown) byDay.set(c.date, [...(byDay.get(c.date) || []), c]);
  for (const x of r.removals) byDay.set(x.date, [...(byDay.get(x.date) || []), { ...x, removal: true }]);
  const days = [...byDay.keys()].sort();

  const row = (c) => c.removal ? `
    <label class="tt-row removal">
      <input type="checkbox" data-rm="${c.id}" ${c.checked ? 'checked' : ''}>
      <span class="tt-time">${c.allDay ? 'Journée' : esc(c.start || '')}</span>
      <span class="tt-title">${c.checked ? `<s>${esc(c.title)}</s>` : esc(c.title)}</span><span class="badge-s del">${c.checked ? 'à retirer' : 'absent du fichier'}</span>
    </label>` : `
    <div class="tt-row ${c.keep ? '' : 'excluded'}">
      <input type="checkbox" data-cand="${c.key}" ${c.checked ? 'checked' : ''} aria-label="Garder ce cours">
      <span class="tt-time">${c.allDay ? 'Journée' : `${esc(c.start || '')}<small>${esc(c.end || '')}</small>`}</span>
      <span class="tt-title"><input data-title="${c.key}" value="${esc(c.title)}">${c.location ? `<small>${esc(c.location)}</small>` : ''}</span>
      ${c.keep ? (c.status === 'new' ? '<span class="badge-s new">nouveau</span>' : '') : `<span class="badge-s">${esc(c.reason)}</span>`}
    </div>`;

  return `
  <div class="tt">
    <h2 class="sheet-title">Vérifie avant de valider</h2>
    <div class="tt-summary">
      <div><strong>${kept.length}</strong><span>cours gardés</span></div>
      <div><strong>${fresh}</strong><span>nouveaux</span></div>
      <div><strong>${removed}</strong><span>retirés</span></div>
    </div>
    ${r.warnings.map((w) => `<p class="warn">${icon('alert')}${esc(w)}</p>`).join('')}
    <p class="fine">Du ${esc(fmt(r.from, { day: 'numeric', month: 'long' }))} au ${esc(fmt(r.to, { day: 'numeric', month: 'long', year: 'numeric' }))}. Décoche ce qui est faux, corrige un titre si besoin.${r.removals.length ? ' Les cours « absents du fichier » ne sont retirés que si tu les coches.' : ''}</p>
    ${hidden ? `<label class="tt-toggle"><input type="checkbox" data-tt-all ${r.showAll ? 'checked' : ''}> Afficher les ${hidden} cours écartés par tes filtres</label>` : ''}
    <div class="tt-days">
      ${days.map((d) => `<section class="tt-day"><h4>${esc(cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })))}</h4>${byDay.get(d).map(row).join('')}</section>`).join('')}
    </div>
    <div class="sheet-actions sticky">
      <button class="btn ghost" data-tt-back>Retour</button>
      <button class="btn primary" data-tt-ok>${icon('check')}Valider</button>
    </div>
  </div>`;
}

export function openTimetableImport() {
  review = null;
  openSheet(pickerHtml(), bind);
}

function bind(d) {
  const box = d.querySelector('.sheet-inner');
  const rerender = () => {
    const scroll = d.scrollTop;
    box.innerHTML = '<div class="grabber"></div>' + (review ? reviewHtml() : pickerHtml());
    d.scrollTop = scroll;
  };

  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.tt) {
      update((s) => { s.shared.timetable[t.dataset.tt] = t.value.trim(); });
      return;
    }
    if (t.matches('[data-tt-file]') && t.files[0]) {
      const file = t.files[0];
      const status = box.querySelector('.tt-status');
      status.innerHTML = `<p class="loading">${icon('repeat')}Lecture de « ${esc(file.name)} »…</p>`;
      try {
        const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
        prepare(isPdf ? await readPdf(file) : await readExcel(file), isPdf ? 'pdf' : 'excel');
        if (!review.candidates.length) throw new Error('Aucun cours trouvé dans ce fichier.');
        rerender();
      } catch (err) {
        status.innerHTML = `<p class="warn">${icon('alert')}${esc(err.message)}</p>`;
      }
      return;
    }
    if (t.dataset.cand) { review.candidates.find((c) => c.key === t.dataset.cand).checked = t.checked; rerender(); }
    if (t.dataset.rm) { review.removals.find((x) => x.id === t.dataset.rm).checked = t.checked; rerender(); }
    if (t.matches('[data-tt-all]')) { review.showAll = t.checked; rerender(); }
  });
  box.addEventListener('input', (e) => {
    if (e.target.dataset.title) review.candidates.find((c) => c.key === e.target.dataset.title).title = e.target.value;
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-tt-back]')) { review = null; rerender(); }
    if (e.target.closest('[data-tt-ok]')) {
      const r = review;
      const keepIds = new Set(r.removals.filter((x) => !x.checked).map((x) => x.id));
      const removeIds = state.events.filter((ev) => ev.source === 'edt' && ev.date >= r.from && ev.date <= r.to && !keepIds.has(ev.id)).map((ev) => ev.id);
      const events = r.candidates.filter((c) => c.checked).map((c) => ({
        title: c.title.trim() || 'Cours', date: c.date, start: c.start, end: c.end, allDay: c.allDay, location: c.location, notes: c.notes,
      }));
      replaceImportedEvents(r.from, r.to, events, removeIds);
      review = null;
      closeSheet();
      toast(`${events.length} cours ajoutés au calendrier`, { action: 'Annuler', undo: true });
    }
  });
}

export function hasAssistantPassword() {
  return Boolean(local.get('app-password'));
}
