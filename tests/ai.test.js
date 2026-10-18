import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonArray, normalizeProposals } from '../js/ai-parse.js';

const mails = [{ id: 'm1' }, { id: 'm2' }];
const projects = [{ id: 'asso', name: 'Association conseil' }, { id: 'pfe', name: 'PFE' }];

test('réponse JSON entourée de balises', () => {
  assert.equal(parseJsonArray('```json\n[{"a":1}]\n```').length, 1);
  assert.deepEqual(parseJsonArray('pas du JSON'), []);
});

test('propositions filtrées et rattachées aux projets', () => {
  const list = normalizeProposals([
    { mailId: 'm1', title: 'Envoyer la proposition commerciale', due: '2026-10-24', time: '18:00', priority: 2, project: 'association conseil', reason: 'Le client attend' },
    { mailId: 'm1', title: 'Envoyer la proposition commerciale' }, // doublon
    { mailId: 'inconnu', title: 'Mail inventé' }, // mail non envoyé
    { mailId: 'm2', title: '', due: 'demain' }, // titre vide
    { mailId: 'm2', title: 'Répondre au jury', due: 'vendredi', priority: 9, project: 'Projet inexistant' },
  ], mails, projects);
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].projectId, list[0].due, list[0].time, list[0].priority], ['asso', '2026-10-24', '18:00', 2]);
  assert.deepEqual([list[1].projectId, list[1].due, list[1].priority], [null, null, 0]);
});
