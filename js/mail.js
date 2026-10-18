// Mails en lecture seule : Gmail et Outlook. Les mails restent sur cet appareil et ne sont jamais envoyés à l'IA.
import { state, update, uid } from './store.js';
import { googleFetch, SCOPES, forgetGoogleToken } from './google.js';
import { connectMicrosoft, microsoftToken, forgetMicrosoft } from './microsoft.js';
import { findDates } from './parser.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, dueLabel, timeAgo } from './dates.js';
import { toast } from './toast.js';

const DAYS_BACK = 14;
const IMPORTANT_RE = /\b(urgent|important|deadline|date limite|[ée]ch[ée]ance|au plus tard|avant le|rappel|relance|convocation|examen|soutenance|rendu|livrable|entretien|rendez-vous|rdv|r[ée]union|action requise|[àa] valider|confirmation)\b/i;
const refreshing = new Set();

const decodeHtml = (s) => { const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; };

function parseFrom(raw) {
  const m = String(raw).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || m[2], email: m[2] } : { name: raw, email: raw };
}

function enrich(m) {
  const text = `${m.subject} ${m.snippet}`;
  const kw = text.match(IMPORTANT_RE);
  const dates = findDates(text, todayISO()).slice(0, 3);
  const reasons = [];
  if (m.flagged) reasons.push('Marqué important');
  if (kw) reasons.push(kw[0].toLowerCase());
  if (dates.length) reasons.push('date mentionnée');
  return { ...m, snippet: m.snippet.slice(0, 220), dates, reasons, important: !m.promo && reasons.length > 0 };
}

async function fetchGmail(acc, interactive) {
  const key = 'gmail:' + acc.email;
  const get = async (url) => (await googleFetch(key, SCOPES.gmail, acc.email, url, {}, interactive)).json();
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const list = await get(`${base}/messages?maxResults=40&q=${encodeURIComponent(`in:inbox newer_than:${DAYS_BACK}d`)}`);
  const msgs = await Promise.all((list.messages || []).map((x) =>
    get(`${base}/messages/${x.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`)));
  return msgs.map((m) => {
    const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    const labels = m.labelIds || [];
    const from = parseFrom(h.from || '');
    return enrich({
      id: m.id, accountId: acc.id, subject: h.subject || '(sans objet)', fromName: from.name, fromEmail: from.email,
      date: Number(m.internalDate), snippet: decodeHtml(m.snippet),
      link: `https://mail.google.com/mail/u/${encodeURIComponent(acc.email)}/#all/${m.threadId}`,
      unread: labels.includes('UNREAD'), flagged: labels.includes('IMPORTANT') || labels.includes('STARRED'),
      promo: labels.some((l) => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(l)),
    });
  });
}

async function fetchOutlook(acc) {
  const token = await microsoftToken(acc.email);
  const since = new Date(Date.now() - DAYS_BACK * 86400000).toISOString();
  const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=40'
    + '&$select=id,subject,from,receivedDateTime,bodyPreview,importance,flag,webLink,isRead,inferenceClassification'
    + `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$orderby=${encodeURIComponent('receivedDateTime desc')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erreur Outlook (${res.status})`);
  }
  return (await res.json()).value.map((m) => enrich({
    id: m.id, accountId: acc.id, subject: m.subject || '(sans objet)',
    fromName: m.from?.emailAddress?.name || '', fromEmail: m.from?.emailAddress?.address || '',
    date: Date.parse(m.receivedDateTime), snippet: (m.bodyPreview || '').replace(/\s+/g, ' '), link: m.webLink,
    unread: !m.isRead, flagged: m.importance === 'high' || m.flag?.flagStatus === 'flagged',
    promo: m.inferenceClassification === 'other',
  }));
}

export async function refreshAccount(acc, interactive = false) {
  if (refreshing.has(acc.id)) return;
  refreshing.add(acc.id);
  update((s) => { s.mails[acc.id] = { ...(s.mails[acc.id] || {}), loading: true, error: '' }; }, { silent: true });
  try {
    const items = acc.type === 'gmail' ? await fetchGmail(acc, interactive) : await fetchOutlook(acc);
    update((s) => { s.mails[acc.id] = { items, fetchedAt: Date.now(), loading: false, error: '' }; }, { silent: true });
  } catch (e) {
    update((s) => {
      s.mails[acc.id] = { ...(s.mails[acc.id] || {}), loading: false, needAuth: Boolean(e.needAuth), error: e.needAuth ? 'Reconnexion nécessaire' : e.message };
    }, { silent: true });
    if (interactive && !e.needAuth) toast(e.message);
  } finally {
    refreshing.delete(acc.id);
  }
}

export function refreshAll(interactive = false, maxAgeMin = 20) {
  const jobs = [];
  for (const acc of state.accounts) {
    const box = state.mails[acc.id];
    if (interactive || !box?.fetchedAt || Date.now() - box.fetchedAt > maxAgeMin * 60000) jobs.push(refreshAccount(acc, interactive));
  }
  return Promise.all(jobs);
}

export function allMails() {
  return state.accounts.flatMap((a) => state.mails[a.id]?.items || []).sort((a, b) => b.date - a.date);
}

export const findMail = (id) => allMails().find((m) => m.id === id);

export function importantMails(days = 3) {
  const limit = Date.now() - days * 86400000;
  return allMails().filter((m) => m.important && m.date >= limit);
}

async function addGmail() {
  const tmpKey = 'gmail:nouveau';
  const res = await googleFetch(tmpKey, SCOPES.gmail, '', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', {}, true);
  const email = (await res.json()).emailAddress.toLowerCase();
  // Le jeton obtenu est rangé sous le nom du compte.
  const all = JSON.parse(localStorage.getItem('mo-gtokens') || '{}');
  all['gmail:' + email] = all[tmpKey];
  delete all[tmpKey];
  localStorage.setItem('mo-gtokens', JSON.stringify(all));
  return email;
}

async function addAccount(type) {
  try {
    const email = type === 'gmail' ? await addGmail() : await connectMicrosoft();
    if (state.accounts.some((a) => a.type === type && a.email === email)) {
      toast(`${email} est déjà connecté`);
    } else {
      update((s) => { s.accounts.push({ id: uid(), type, email }); }, { silent: true });
      toast(`${email} connecté`);
    }
    const acc = state.accounts.find((a) => a.type === type && a.email === email);
    refreshAccount(acc, true);
  } catch (e) {
    toast(e.message);
  }
}

async function reconnect(acc) {
  try {
    if (acc.type === 'outlook') await connectMicrosoft(acc.email);
    await refreshAccount(acc, true);
  } catch (e) { toast(e.message); }
}

function removeAccount(id) {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return;
  if (acc.type === 'gmail') forgetGoogleToken('gmail:' + acc.email); else forgetMicrosoft(acc.email);
  update((s) => { s.accounts = s.accounts.filter((a) => a.id !== id); delete s.mails[id]; }, { silent: true });
  toast('Compte déconnecté');
}

// ---------- Affichage ----------
export function mailCard(m, { compact = false } = {}) {
  const acc = state.accounts.find((a) => a.id === m.accountId);
  return `
  <article class="mail ${m.unread ? 'unread' : ''}">
    <div class="mail-head">
      <span class="mail-from">${esc(m.fromName || m.fromEmail)}</span>
      <span class="mail-when">${esc(timeAgo(m.date))}</span>
    </div>
    <div class="mail-subject">${esc(m.subject)}</div>
    ${compact ? '' : `<p class="mail-snippet">${esc(m.snippet)}</p>`}
    ${m.reasons.length ? `<div class="mail-tags">${m.reasons.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}${acc && state.accounts.length > 1 ? `<span class="tag muted">${esc(acc.email.split('@')[0])}</span>` : ''}</div>` : ''}
    ${m.dates.length ? `<div class="mail-dates">${m.dates.map((d, i) => `<button class="pchip" data-action="mail-event" data-id="${esc(m.id)}" data-i="${i}">${icon('calendar')}${esc(dueLabel(d.due))}${d.time ? ' ' + esc(d.time.replace(':', 'h')) : ''}${icon('plus')}</button>`).join('')}</div>` : ''}
    <div class="mail-actions">
      <button class="btn small" data-action="mail-task" data-id="${esc(m.id)}">${icon('tasks')}Tâche</button>
      <button class="btn small" data-action="mail-followup" data-id="${esc(m.id)}">${icon('clock')}Relance</button>
      ${m.link ? `<a class="btn small ghost" href="${esc(m.link)}" target="_blank" rel="noopener">${icon('mail')}Ouvrir</a>` : ''}
    </div>
  </article>`;
}

let filter = 'important';
// Contenu ajouté en haut de la page (propositions de tâches), fourni par l'application.
let extraTop = () => '';
export function setMailsTop(fn) { extraTop = fn; }

export function mailsView() {
  const accounts = state.accounts;
  const accRow = accounts.map((a) => {
    const box = state.mails[a.id] || {};
    const status = box.loading ? 'Actualisation…' : box.error ? esc(box.error) : box.fetchedAt ? `À jour ${esc(timeAgo(box.fetchedAt))}` : '';
    return `
    <div class="account">
      <span class="acc-ic ${a.type}">${a.type === 'gmail' ? 'G' : 'O'}</span>
      <div class="acc-main"><strong>${esc(a.email)}</strong><small class="${box.error ? 'err' : ''}">${status}</small></div>
      ${box.needAuth ? `<button class="btn small primary" data-action="mail-reconnect" data-id="${a.id}">Reconnecter</button>` : ''}
      <button class="icon-btn small" data-action="mail-remove" data-id="${a.id}" aria-label="Déconnecter ${esc(a.email)}">${icon('x')}</button>
    </div>`;
  }).join('');

  const list = allMails().filter((m) => filter === 'all' || m.important);
  return `
  <div class="page-head">
    <h1>Mails</h1>
    ${accounts.length ? `<div class="row-gap">${state.settings.mailConsent ? `<button class="btn" data-action="analyze-mails">${icon('sparkles')}<span>Proposer des tâches</span></button>` : ''}<button class="btn" data-action="mail-refresh">${icon('repeat')}<span>Actualiser</span></button></div>` : ''}
  </div>
  ${extraTop()}
  <section class="group">
    <div class="card form-card">
      ${accRow || '<p class="fine">Connecte tes boîtes mail en lecture seule. Les mails restent sur cet appareil et ne sont jamais envoyés à l\'assistant.</p>'}
      <div class="row-gap wrap">
        <button class="btn" data-action="mail-add" data-type="gmail">${icon('plus')}Gmail</button>
        <button class="btn" data-action="mail-add" data-type="outlook">${icon('plus')}Outlook</button>
      </div>
    </div>
  </section>
  ${accounts.length ? `
  <div class="segmented" style="margin-bottom:16px">
    <button class="${filter === 'important' ? 'on' : ''}" data-action="mail-filter" data-key="important">Importants</button>
    <button class="${filter === 'all' ? 'on' : ''}" data-action="mail-filter" data-key="all">Tous (${DAYS_BACK} j)</button>
  </div>
  ${list.length ? `<div class="mails">${list.map((m) => mailCard(m)).join('')}</div>` : `<div class="empty">${icon('mail', 'empty-ic')}<h3>Aucun mail ${filter === 'important' ? 'important' : ''}</h3><p>Actualise pour récupérer les derniers mails.</p></div>`}` : ''}`;
}

export const mailHandlers = {
  'mail-add': (el) => addAccount(el.dataset.type),
  'mail-refresh': () => refreshAll(true),
  'mail-reconnect': (el) => { const a = state.accounts.find((x) => x.id === el.dataset.id); if (a) reconnect(a); },
  'mail-remove': (el) => removeAccount(el.dataset.id),
  'mail-filter': (el) => { filter = el.dataset.key; update(() => {}, { silent: true }); },
};
