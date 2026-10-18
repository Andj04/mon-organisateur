import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkbook, buildCandidates, dateFromSheetName } from '../js/timetable-parse.js';

// Grille d'exemple reprenant la structure de l'emploi du temps de l'école (indices à partir de 0).
const sheet = {
  name: '07 Déc-11 Déc',
  cells: {
    '1,1': 'S9 - 2026/2027',
    '3,1': '2026-10-26', '3,3': '2026-10-27', '3,5': '2026-10-28', '3,7': '2026-10-29', '3,9': '2026-10-30',
    '4,0': '8h30\nà\n10h15',
    '4,1': 'Estimation Statistique - P. Vanheeghe \nEn distanciel via M.S Teams',
    '4,7': 'Groupe 1 : ANG : S. Metlassy\nD001',
    '4,8': 'Groupe 7 : ANG : M. Benmammass - B003',
    '9,0': '14h00\nà\n15h45',
    '9,1': 'GI: Maintenance - Groupe 2 - salle info',
    '10,1': 'SDD: Travail en autonomie',
    '9,3': 'Filière Conseil : Problem Solving - D. Boehe',
    '9,5': 'Filière Manager: Leadership',
    '4,5': "9h - 10h -Enjeux de l'énergie -EXAMEN - Gymnase",
  },
  merges: [
    { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } }, { s: { r: 3, c: 3 }, e: { r: 3, c: 4 } }, { s: { r: 3, c: 5 }, e: { r: 3, c: 6 } },
    { s: { r: 3, c: 7 }, e: { r: 3, c: 8 } }, { s: { r: 3, c: 9 }, e: { r: 3, c: 10 } },
    { s: { r: 4, c: 0 }, e: { r: 8, c: 0 } }, { s: { r: 9, c: 0 }, e: { r: 12, c: 0 } },
    { s: { r: 4, c: 1 }, e: { r: 8, c: 2 } },
  ],
};

test("nom d'onglet vers date", () => {
  assert.equal(dateFromSheetName('07 Déc-11 Déc ( Filière 3)', 2026), '2026-12-07');
  assert.equal(dateFromSheetName('1 fév-5 fév.', 2026), '2027-02-01');
  assert.equal(dateFromSheetName('26-30 oct ( Filière 2)', 2026), '2026-10-26');
});

test('lecture de la grille, correction des dates et filtres', () => {
  const { slots, warnings } = parseWorkbook([sheet]);
  assert.equal(warnings.length, 1);
  const c = buildCandidates(slots, { filiere: 'Conseil', option: 'GI', groupe: '7', groupeTP: '' });
  const kept = c.filter((x) => x.keep).map((x) => `${x.date} ${x.start}-${x.end} ${x.title} @${x.location}`);
  assert.deepEqual(kept, [
    '2026-12-07 08:30-10:15 Estimation Statistique @Distanciel (Teams)',
    '2026-12-07 14:00-15:45 Maintenance (TP groupe 2) @salle info',
    '2026-12-08 14:00-15:45 Conseil · Problem Solving @',
    "2026-12-09 09:00-10:00 Enjeux de l'énergie · Examen @Gymnase",
    '2026-12-10 08:30-10:15 Anglais (groupe 7) @B003',
  ]);
  const tp = buildCandidates(slots, { filiere: 'Conseil', option: 'GI', groupe: '7', groupeTP: '1' });
  assert.equal(tp.find((x) => x.title.startsWith('Maintenance')).keep, false);
});
