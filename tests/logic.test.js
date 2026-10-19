import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from '../js/parser.js';
import { learn, unlearn, predict } from '../js/classifier.js';
import { nextDue } from '../js/recurrence.js';

// Dimanche 18 octobre 2026
const T = '2026-10-18';
const projects = [
  { id: 'asso', name: 'Association conseil', description: 'missions clients, bureau, recrutement' },
  { id: 'pfe', name: 'PFE', description: 'projet de fin d\'études, rapport, encadrant' },
  { id: 'cours', name: 'Cours', description: 'examens, révisions, devoirs' },
];

test('dates relatives et heure', () => {
  const p = parseQuick('Préparer la réunion demain 14h', projects, T);
  assert.equal(p.title, 'Préparer la réunion');
  assert.equal(p.due, '2026-10-19');
  assert.equal(p.time, '14:00');
});

test('jour de la semaine, priorité, #projet', () => {
  const p = parseQuick('Envoyer devis vendredi !! #asso', projects, T);
  assert.equal(p.title, 'Envoyer devis');
  assert.equal(p.due, '2026-10-23');
  assert.equal(p.priority, 2);
  assert.equal(p.projectId, 'asso');
});

test('date explicite et mois en lettres', () => {
  assert.equal(parseQuick('Rendu rapport 24/10', projects, T).due, '2026-10-24');
  assert.equal(parseQuick('Soutenance le 3 novembre à 9h30', projects, T).due, '2026-11-03');
  assert.equal(parseQuick('Soutenance le 3 novembre à 9h30', projects, T).time, '09:30');
  assert.equal(parseQuick('Payer loyer le 5', projects, T).due, '2026-11-05');
  assert.equal(parseQuick('Inscription 15/01', projects, T).due, '2027-01-15');
});

test('récurrences', () => {
  const d = parseQuick('Lire mes mails tous les jours', projects, T);
  assert.deepEqual(d.recurrence, { freq: 'daily', days: [] });
  assert.equal(d.due, T);
  assert.equal(d.title, 'Lire mes mails');
  const w = parseQuick('Réunion bureau chaque lundi et jeudi 18h', projects, T);
  assert.deepEqual(w.recurrence, { freq: 'weekly', days: [1, 4] });
  assert.equal(w.due, '2026-10-19');
  assert.equal(w.time, '18:00');
  assert.equal(w.title, 'Réunion bureau');
});

test('pas de faux positif sur un mot contenant demain', () => {
  const p = parseQuick('Relire le lendemain du séminaire', projects, T);
  assert.equal(p.due, null);
});

test('prochaine occurrence', () => {
  assert.equal(nextDue({ due: T, recurrence: { freq: 'daily', days: [] } }, T), '2026-10-19');
  assert.equal(nextDue({ due: '2026-10-19', recurrence: { freq: 'weekly', days: [1, 4] } }, T), '2026-10-22');
  assert.equal(nextDue({ due: '2026-10-12', recurrence: { freq: 'weekly', days: [1] } }, T), '2026-10-19');
});

test('rangement automatique : départ sur les descriptions, puis apprentissage', () => {
  const model = { words: {}, docs: {} };
  assert.equal(predict(model, 'Réviser examen de thermique', projects).projectId, 'cours');
  assert.equal(predict(model, 'Appeler le client pour la mission', projects).projectId, 'asso');
  assert.equal(predict(model, 'Acheter du pain', projects), null);
  // Correction : "Samsung" concerne l'association
  learn(model, 'Préparer présentation Samsung', 'asso', 3);
  assert.equal(predict(model, 'Relancer Samsung', projects).projectId, 'asso');
  // Changement d'avis
  unlearn(model, 'Préparer présentation Samsung', 'asso', 3);
  learn(model, 'Préparer présentation Samsung', 'pfe', 3);
  assert.equal(predict(model, 'Relancer Samsung', projects).projectId, 'pfe');
});

import { findDates } from '../js/parser.js';
import { mergeData } from '../js/merge.js';

test('dates repérées dans un mail', () => {
  const found = findDates('Rappel : rendu du livrable le 24/10 à 18h, réunion le 3 novembre. Ancien : 02/09.', T);
  assert.deepEqual(found.map((f) => [f.due, f.time]), [['2026-10-24', '18:00'], ['2026-11-03', null]]);
  assert.deepEqual(findDates('Merci pour hier', T), []);
});

test('fusion entre deux appareils', () => {
  const a = { savedAt: 10, tasks: [{ id: 't1', title: 'A', updatedAt: 5 }, { id: 't2', title: 'local', updatedAt: 9 }], deleted: {}, log: [{ taskId: 't1', at: 1 }], shared: { name: 'A' } };
  const b = { savedAt: 20, tasks: [{ id: 't1', title: 'A modifiée', updatedAt: 8 }, { id: 't3', title: 'distante', updatedAt: 3 }], deleted: { t2: 4 }, log: [{ taskId: 't1', at: 1 }, { taskId: 't3', at: 2 }], shared: { name: 'B' } };
  const m = mergeData(a, b);
  const titles = Object.fromEntries(m.tasks.map((t) => [t.id, t.title]));
  assert.equal(titles.t1, 'A modifiée');
  assert.equal(titles.t2, 'local'); // modifiée après la suppression : conservée
  assert.equal(titles.t3, 'distante');
  assert.equal(m.log.length, 2);
  assert.equal(m.shared.name, 'B');
  const c = mergeData(a, { ...b, deleted: { t2: Date.now() } });
  assert.equal(c.tasks.find((t) => t.id === 't2'), undefined);
});

test('fusion : conversations, comptes mail et coffre', () => {
  const a = {
    savedAt: 5,
    chats: Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i, updatedAt: i })),
    accounts: [{ id: 'x1', type: 'gmail', email: 'moi@gmail.com', createdAt: 1 }],
    vault: { appPassword: 'ancien', refresh: { 'gmail:moi@gmail.com': 'r1' }, updatedAt: 1 },
  };
  const b = {
    savedAt: 6,
    chats: Array.from({ length: 5 }, (_, i) => ({ id: 'b' + i, updatedAt: 100 + i })),
    accounts: [{ id: 'x2', type: 'gmail', email: 'moi@gmail.com', createdAt: 2 }],
    vault: { appPassword: 'nouveau', refresh: { drive: 'r2' }, updatedAt: 9 },
  };
  const m = mergeData(a, b);
  assert.equal(m.chats.length, 10);
  assert.equal(m.chats[0].id, 'b4');
  assert.equal(m.accounts.length, 1);
  assert.equal(m.vault.appPassword, 'nouveau');
  assert.deepEqual(m.vault.refresh, { 'gmail:moi@gmail.com': 'r1', drive: 'r2' });
});

import { migrate } from '../js/store.js';

test('synchro avec des données d\'une ancienne version', () => {
  const local = { savedAt: 1, shared: { name: 'Mathieu', prefs: { mailConsent: true, briefing: false } }, vault: { appPassword: 'p', refresh: {}, updatedAt: 1 } };
  const ancienRemote = { savedAt: 9, shared: { name: 'Mathieu', lastReview: '2026-10-12' } }; // ni prefs ni coffre
  const m = mergeData(local, ancienRemote);
  assert.deepEqual(m.shared.prefs, { mailConsent: true, briefing: false });
  assert.equal(m.shared.lastReview, '2026-10-12');
  const complet = migrate({ ...m, shared: { name: 'x' }, vault: undefined, chats: undefined });
  assert.equal(complet.shared.prefs.briefing, true); // valeur par défaut ajoutée
  assert.deepEqual(complet.vault.refresh, {});
  assert.deepEqual(complet.chats, []);
});
