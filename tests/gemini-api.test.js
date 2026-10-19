import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_PASSWORD = 'secret';
process.env.GEMINI_API_KEY = 'cle';

// Réponses simulées de Google : liste des modèles et résultat de chaque modèle.
let behaviour = {};
const tried = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/models?')) {
    return new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }));
  }
  const model = u.match(/models\/([^:]+):generateContent/)[1];
  tried.push(model);
  const b = behaviour[model] || { status: 404, message: 'no longer available' };
  if (b.status === 200) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'réponse de ' + model }] } }] }));
  return new Response(JSON.stringify({ error: { message: b.message } }), { status: b.status });
};

const { default: handler } = await import('../api/gemini.js');
const call = async () => {
  let out;
  const res = { status(c) { out = { code: c }; return this; }, json(d) { out.body = d; return this; }, setHeader() {} };
  await handler({ method: 'POST', headers: { 'x-app-password': 'secret' }, body: { kind: 'chat', system: 's', messages: [{ role: 'user', text: 'q' }] } }, res);
  return out;
};

test('modèle le plus récent d\'abord, bascule si quota atteint', async () => {
  behaviour = { 'gemini-3.5-flash': { status: 429, message: 'quota' }, 'gemini-3.5-flash-lite': { status: 200 } };
  tried.length = 0;
  const r = await call();
  assert.equal(r.code, 200);
  assert.equal(r.body.text, 'réponse de gemini-3.5-flash-lite');
  assert.deepEqual(tried, ['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  // Le modèle qui a marché est ensuite essayé en premier.
  tried.length = 0;
  await call();
  assert.equal(tried[0], 'gemini-3.5-flash-lite');
});

test('modèles retirés : message clair', async () => {
  behaviour = {};
  tried.length = 0;
  const r = await call();
  assert.equal(r.code, 502);
  assert.match(r.body.error, /modèles essayés/);
  assert.ok(!tried.includes('gemini-3.5-flash-image'));
});
