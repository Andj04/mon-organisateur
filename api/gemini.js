// Relais vers Gemini. La clé reste sur le serveur Vercel (variable GEMINI_API_KEY) et n'est jamais envoyée au navigateur.
// L'accès est protégé par un mot de passe (variable APP_PASSWORD) que tu saisis une fois dans l'application.
export const config = { maxDuration: 60 };

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
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
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

async function callGemini(key, body) {
  const failures = [];
  for (const model of await models(key)) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      lastGood = model;
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return { ok: true, text, model };
    }
    failures.push({ model, status: res.status, message: data.error?.message || `Erreur ${res.status}` });
    if (lastGood === model) lastGood = null;
    // Clé refusée ou projet bloqué : inutile d'essayer d'autres modèles.
    if (res.status === 401 || res.status === 403) break;
  }
  const quota = failures.find((f) => f.status === 429);
  if (quota) return { ok: false, status: 429, message: quota.message };
  const last = failures[failures.length - 1] || { status: 500, message: 'Aucun modèle Gemini disponible.' };
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
    const out = await callGemini(key, body);
    if (out.ok) return res.status(200).json({ text: out.text, model: out.model });
    const message = out.status === 429
      ? 'Quota gratuit de Gemini atteint pour le moment. Réessaie plus tard.'
      : `Gemini a répondu : ${out.message}`;
    return res.status(out.status === 429 ? 429 : 502).json({ error: message });
  } catch {
    return res.status(502).json({ error: 'Impossible de joindre Gemini.' });
  }
}
