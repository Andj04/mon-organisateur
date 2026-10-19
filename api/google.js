// Connexion Google longue durée. Le secret de l'application (GOOGLE_CLIENT_SECRET) reste sur le serveur :
// il sert à obtenir puis renouveler les autorisations sans que tu aies à te reconnecter.
// Accès protégé par le même mot de passe que l'assistant (APP_PASSWORD).
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const password = process.env.APP_PASSWORD;
  if (!password || req.headers['x-app-password'] !== password) {
    return res.status(401).json({ error: 'Mot de passe de l\'application incorrect ou absent (Réglages > Assistant).' });
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET manquant sur Vercel.' });

  const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let params;
  if (input.action === 'exchange' && input.code && input.redirectUri) {
    params = { grant_type: 'authorization_code', code: String(input.code), redirect_uri: String(input.redirectUri) };
  } else if (input.action === 'refresh' && input.refreshToken) {
    params = { grant_type: 'refresh_token', refresh_token: String(input.refreshToken) };
  } else {
    return res.status(400).json({ error: 'Requête inconnue.' });
  }

  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // invalid_grant : autorisation expirée ou retirée, il faut se reconnecter.
      return res.status(data.error === 'invalid_grant' ? 401 : 502).json({ error: data.error_description || data.error || 'Erreur Google', code: data.error });
    }
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token || null,
      scope: data.scope,
    });
  } catch {
    return res.status(502).json({ error: 'Impossible de joindre Google.' });
  }
}
