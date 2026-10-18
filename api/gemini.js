// Relais vers Gemini. La clé reste sur le serveur Vercel (variable GEMINI_API_KEY) et n'est jamais envoyée au navigateur.
// L'accès est protégé par un mot de passe (variable APP_PASSWORD) que tu saisis une fois dans l'application.
export const config = { maxDuration: 60 };

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const MAX_BODY = 4 * 1024 * 1024;

function models() {
  const custom = (process.env.GEMINI_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([...custom, ...DEFAULT_MODELS])];
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
  let last = { status: 500, message: 'Erreur inconnue' };
  for (const model of models()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return { ok: true, text, model };
    }
    last = { status: res.status, message: data.error?.message || `Erreur ${res.status}` };
    // Quota atteint ou modèle indisponible : on essaie le modèle suivant.
    if (![429, 404, 503].includes(res.status)) break;
  }
  return { ok: false, ...last };
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
