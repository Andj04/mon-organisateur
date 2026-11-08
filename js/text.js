// Outils texte : normalisation, découpage en mots, échappement HTML.
export const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STOP = new Set((
  'le la les un une des de du d l et ou a au aux en dans sur sous pour par avec sans ce cet cette ces ' +
  'mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je tu il elle on nous vous ils elles ' +
  'me te se qui que quoi dont est sont etre avoir faire fait y ne pas plus moins tres tout tous toute toutes ' +
  'the of to and for'
).split(' '));

export function tokens(s) {
  return normalize(s || '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

// Lien vers un fil Gmail dans le bon compte. Corrige aussi l'ancienne forme (/mail/u/adresse%40.../),
// que Gmail ne reconnaissait pas.
export const gmailLink = (email, threadId) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${threadId}`;

export function fixMailLink(url) {
  const m = typeof url === 'string' && url.match(/^https:\/\/mail\.google\.com\/mail\/u\/([^/]*%40[^/]*)\/#all\/([\w-]+)$/);
  return m ? gmailLink(decodeURIComponent(m[1]), m[2]) : url;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
