// Configuration publique lue sur le serveur Vercel (identifiants d'application, jamais de secret).
let cache = null;

export async function getConfig() {
  if (cache) return cache;
  try {
    const res = await fetch('api/config', { cache: 'no-store' });
    cache = res.ok ? await res.json() : {};
  } catch {
    cache = {};
  }
  return cache;
}
