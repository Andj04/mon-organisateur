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
