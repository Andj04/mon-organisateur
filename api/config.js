// Configuration publique de l'application. Aucun secret ici : ces identifiants sont faits pour être visibles.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID || '',
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
}
