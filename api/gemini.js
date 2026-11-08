// Relais vers Gemini. La clé reste sur le serveur Vercel (variable GEMINI_API_KEY) et n'est jamais envoyée au navigateur.
// L'accès est protégé par un mot de passe (variable APP_PASSWORD) que tu saisis une fois dans l'application.
// Durée maximale côté Vercel (voir aussi vercel.json). L'application garde sa propre marge plus bas.
export const config = { maxDuration: 300 };

// Modèles connus en dernier recours. Les noms changent souvent : le serveur demande donc aussi à Google
// la liste des modèles réellement disponibles pour ta clé.
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
const MAX_BODY = 4 * 1024 * 1024;
const MAX_TRIES = 5;

let discovered = null; // { at, list }
let lastGood = null; // dernier modèle qui a fonctionné, essayé en premier

const versionOf = (name) => Number((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);

async function discoverModels(key) {
  if (discovered && Date.now() - discovered.at < 60 * 60 * 1000) return discovered.list;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const list = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|embedding|exp|preview|thinking/i.test(n))
      // Version la plus récente d'abord ; à version égale, « flash » avant « flash-lite ».
      .sort((a, b) => versionOf(b) - versionOf(a) || Number(a.includes('lite')) - Number(b.includes('lite')) || a.length - b.length);
    discovered = { at: Date.now(), list };
    return list;
  } catch {
    return [];
  }
}

async function models(key) {
  const custom = (process.env.GEMINI_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
  const found = await discoverModels(key);
  return [...new Set([...custom, ...(lastGood ? [lastGood] : []), ...found, ...FALLBACK_MODELS])].slice(0, MAX_TRIES);
}

const TIMETABLE_PROMPT = (today, year) => `Tu lis l'emploi du temps d'une école d'ingénieurs (PDF ci-joint).
Date du jour : ${today}. Année universitaire : ${year}.
Renvoie UNIQUEMENT un tableau JSON. Chaque élément est un créneau :
{"date":"AAAA-MM-JJ","start":"HH:MM","end":"HH:MM","text":"texte exact de la case, sur une seule ligne"}
Règles :
- Une case qui contient plusieurs groupes ou options (Groupe 1, Groupe 2, SDD:, GI:, EDD:, Filière ...) donne un élément par groupe ou option, avec son texte exact.
- Une case fusionnée sur plusieurs créneaux donne un seul élément du début du premier créneau à la fin du dernier.
- Si la case précise une heure différente du créneau (ex. "9h - 10h"), utilise cette heure.
- N'invente rien. Ignore les cases vides.`;

// Délais selon la tâche. Lire un PDF d'emploi du temps est bien plus long que répondre à une question.
const LIMITS = {
  chat: { attemptMs: 45000, budgetMs: 100000, levels: ['low'] },
  timetable: { attemptMs: 140000, budgetMs: 270000, levels: ['minimal', 'low'] }, // sous les 300 s de Vercel
};

// Les modèles récents « réfléchissent » longtemps par défaut : on demande la réflexion la plus courte
// utile à la tâche. Si un modèle refuse un niveau, on essaie le suivant, puis sans réglage.
function thinkingFor(model, level) {
  const v = versionOf(model);
  if (v >= 3) return level ? { thinkingLevel: level } : null;
  if (v >= 2.5 && model.includes('flash')) return { thinkingBudget: 0 };
  return null;
}

async function attempt(key, model, body, level, attemptMs) {
  const thinking = thinkingFor(model, level);
  const payload = thinking
    ? { ...body, generationConfig: { ...(body.generationConfig || {}), thinkingConfig: thinking } }
    : body;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), attemptMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data, thinking };
  } catch (e) {
    if (e.name === 'AbortError') return { timeout: true };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const SLOW_MESSAGE = {
  chat: 'Gemini met trop de temps à répondre en ce moment. Réessaie dans un instant.',
  timetable: 'Gemini met trop de temps à lire ce PDF en ce moment. Réessaie dans quelques minutes, ou importe l\'Excel du semestre (lu directement sur ton appareil).',
};

async function callGemini(key, body, kind = 'chat') {
  const { attemptMs, budgetMs, levels } = LIMITS[kind] || LIMITS.chat;
  const started = Date.now();
  const failures = [];
  for (const model of await models(key)) {
    const left = budgetMs - (Date.now() - started);
    // Plus assez de temps pour un essai complet : on s'arrête avant que Vercel coupe.
    if (left < Math.min(attemptMs, 30000)) break;
    let r;
    for (const level of [...levels, null]) {
      r = await attempt(key, model, body, level, Math.min(attemptMs, left));
      // Niveau de réflexion refusé par ce modèle : on essaie le suivant.
      const rejected = !r.timeout && !r.res.ok && r.thinking && r.res.status === 400 && /think/i.test(r.data.error?.message || '');
      if (!rejected) break;
    }
    if (r.timeout) {
      failures.push({ model, status: 504, message: 'trop long' });
      continue;
    }
    const { res, data } = r;
    if (res.ok) {
      lastGood = model;
      const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') || '';
      return { ok: true, text, model };
    }
    failures.push({ model, status: res.status, message: data.error?.message || `Erreur ${res.status}` });
    if (lastGood === model) lastGood = null;
    // Clé refusée ou projet bloqué : inutile d'essayer d'autres modèles.
    if (res.status === 401 || res.status === 403) break;
  }
  const quota = failures.find((f) => f.status === 429);
  if (quota) return { ok: false, status: 429, message: quota.message };
  const real = failures.filter((f) => f.status !== 504);
  // Uniquement des lenteurs (ou rien d'essayé) : message clair.
  if (!real.length) return { ok: false, status: 504, message: SLOW_MESSAGE[kind] || SLOW_MESSAGE.chat };
  const last = real[real.length - 1];
  return { ok: false, status: last.status, message: `${last.message} (modèles essayés : ${failures.map((f) => f.model).join(', ')})` };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const password = process.env.APP_PASSWORD;
  if (!password || req.headers['x-app-password'] !== password) {
    return res.status(401).json({ error: 'Mot de passe de l\'assistant incorrect ou non configuré.' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Clé Gemini absente : ajoute GEMINI_API_KEY dans Vercel.' });

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (raw.length > MAX_BODY) return res.status(413).json({ error: 'Fichier trop volumineux.' });
  const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  let body;
  if (input.kind === 'timetable') {
    if (!input.pdf) return res.status(400).json({ error: 'PDF manquant.' });
    body = {
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: input.pdf } },
          { text: TIMETABLE_PROMPT(String(input.today || ''), String(input.year || '')) },
        ],
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    };
  } else if (input.kind === 'chat') {
    const messages = Array.isArray(input.messages) ? input.messages.slice(-12) : [];
    body = {
      system_instruction: { parts: [{ text: String(input.system || '').slice(0, 60000) }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 4000) }] })),
      generationConfig: input.json
        ? { temperature: 0.2, responseMimeType: 'application/json' }
        : { temperature: 0.4 },
    };
  } else {
    return res.status(400).json({ error: 'Requête inconnue.' });
  }

  try {
    const out = await callGemini(key, body, input.kind === 'timetable' ? 'timetable' : 'chat');
    if (out.ok) return res.status(200).json({ text: out.text, model: out.model });
    if (out.status === 429) return res.status(429).json({ error: 'Quota gratuit de Gemini atteint pour le moment. Réessaie plus tard.' });
    if (out.status === 504) return res.status(504).json({ error: out.message });
    return res.status(502).json({ error: `Gemini a répondu : ${out.message}` });
  } catch {
    return res.status(502).json({ error: 'Impossible de joindre Gemini.' });
  }
}
