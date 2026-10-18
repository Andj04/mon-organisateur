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

import { parseAssistantReply, normalizeActions } from '../js/ai-parse.js';

test('réponse du chat en JSON ou en texte', () => {
  assert.deepEqual(parseAssistantReply('{"reply":"C\'est fait","actions":[{"type":"add_task","title":"A"}]}').actions.length, 1);
  assert.deepEqual(parseAssistantReply('Bonjour !'), { reply: 'Bonjour !', actions: [] });
});

test('actions du chat validées', () => {
  const acts = normalizeActions([
    { type: 'add_task', title: 'Réviser les stats', due: '2026-10-19', time: '18:00', priority: 2, project: 'pfe', recurrence: { freq: 'weekly', days: [1, 4, 9] } },
    { type: 'add_task', title: 'Sans date', due: 'demain', time: '25:00', project: 'Inconnu' },
    { type: 'add_event', title: 'Réunion bureau', date: '2026-10-22', start: '18:00', end: '19:30', location: 'B102' },
    { type: 'add_event', title: 'Événement sans date', date: null },
    { type: 'add_event', title: 'Soutenance', date: '2026-11-03', start: '10:00', end: '09:00' },
    { type: 'delete_all', title: 'Action inconnue' },
    { type: 'add_task', title: '' },
  ], projects);
  assert.equal(acts.length, 4);
  assert.deepEqual([acts[0].projectId, acts[0].due, acts[0].time, acts[0].recurrence.days], ['pfe', '2026-10-19', '18:00', [1, 4]]);
  assert.deepEqual([acts[1].due, acts[1].time, acts[1].projectId], [null, null, null]);
  assert.deepEqual([acts[2].type, acts[2].allDay, acts[2].end], ['event', false, '19:30']);
  assert.equal(acts[3].end, null); // fin avant le début : ignorée
});
