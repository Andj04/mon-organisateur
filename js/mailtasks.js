// L'assistant repère dans tes mails les actions à faire et te propose des tâches, que tu valides.
// Ne sont envoyés que l'expéditeur, l'objet, la date et un court extrait de chaque mail.
import { state, update, local, appPassword } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, fmt, toISO, dueLabel } from './dates.js';
import { activeProjects, createTask, suggestProject } from './actions.js';
import { allMails } from './mail.js';
import { callAssistantApi } from './assistant.js';
import { parseJsonArray, normalizeProposals } from './ai-parse.js';
import { openSheet, closeSheet } from './sheets.js';
import { toast } from './toast.js';

const MAX_MAILS = 20;
const SNIPPET = 200;
const AUTO_INTERVAL = 2 * 60 * 60 * 1000; // analyse automatique au plus toutes les 2 heures

export const canReadMails = () => state.shared.prefs.mailConsent && Boolean(appPassword());

function eligibleMails() {
  const since = Date.now() - 7 * 86400000;
  const linked = new Set(state.tasks.map((t) => t.link).filter(Boolean));
  return allMails()
    .filter((m) => m.date >= since && !m.promo && !state.mailProposals.analyzed[m.id] && !linked.has(m.link))
    .slice(0, MAX_MAILS);
}

export const pendingProposals = () => state.mailProposals.items;

function prompt(mails) {
  const today = todayISO();
  const projects = activeProjects().map((p) => `- ${p.name}${p.description ? ' : ' + p.description : ''}`).join('\n') || '(aucun)';
  const list = mails.map((m) => `[${m.id}] De : ${m.fromName || m.fromEmail} | Objet : ${m.subject} | Reçu le : ${toISO(new Date(m.date))} | Extrait : ${m.snippet.slice(0, SNIPPET)}`).join('\n');
  return `Tu aides ${state.shared.name || 'un étudiant ingénieur'}, étudiant en dernière année d'école d'ingénieurs et président d'une association de conseil, à repérer dans ses mails les actions qu'il doit faire.
Date du jour : ${fmt(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${today}).
Ses projets :
${projects}

Pour chaque mail, décide s'il lui demande une action concrète (répondre, envoyer, préparer, rendre, s'inscrire, payer, confirmer, participer...).
Ignore les newsletters, publicités, notifications automatiques et mails purement informatifs.
Renvoie UNIQUEMENT un tableau JSON, vide s'il n'y a rien à faire :
[{"mailId":"identifiant entre crochets","title":"action courte, verbe à l'infinitif","due":"AAAA-MM-JJ ou null","time":"HH:MM ou null","priority":0 à 3,"project":"nom exact d'un projet ci-dessus ou null","reason":"pourquoi, en quelques mots"}]
N'invente aucune date : mets null si le mail n'en donne pas clairement.

MAILS :
${list}`;
}

// auto : lancement automatique (limité dans le temps, sans message d'erreur visible).
export async function analyzeMails({ auto = false } = {}) {
  if (!canReadMails() || state.mailProposals.running) return 0;
  const mp = state.mailProposals;
  if (auto && (!state.shared.prefs.autoMailTasks || (mp.lastRun && Date.now() - mp.lastRun < AUTO_INTERVAL))) return 0;
  const mails = eligibleMails();
  if (!mails.length) {
    if (!auto) toast('Aucun nouveau mail à analyser');
    return 0;
  }
  update((s) => { s.mailProposals.running = true; s.mailProposals.error = ''; }, { silent: true });
  try {
    const text = await callAssistantApi({ kind: 'chat', json: true, system: 'Tu réponds uniquement en JSON valide.', messages: [{ role: 'user', text: prompt(mails) }] });
    const found = normalizeProposals(parseJsonArray(text), mails, state.projects).map((p) => {
      const mail = mails.find((m) => m.id === p.mailId);
      return {
        ...p,
        projectId: p.projectId ?? suggestProject(p.title)?.projectId ?? null,
        mailSubject: mail.subject, from: mail.fromName || mail.fromEmail, link: mail.link || null,
        key: `${mail.id}-${Math.random().toString(36).slice(2, 7)}`,
      };
    });
    update((s) => {
      const limit = Date.now() - 30 * 86400000;
      for (const [id, at] of Object.entries(s.mailProposals.analyzed)) if (at < limit) delete s.mailProposals.analyzed[id];
      for (const m of mails) s.mailProposals.analyzed[m.id] = Date.now();
      s.mailProposals.items = [...s.mailProposals.items, ...found];
      s.mailProposals.lastRun = Date.now();
      s.mailProposals.running = false;
    }, { silent: true });
    if (!auto) toast(found.length ? `${found.length} tâche${found.length > 1 ? 's' : ''} proposée${found.length > 1 ? 's' : ''}` : 'Aucune action trouvée dans tes mails récents');
    if (!auto && found.length) openProposals();
    return found.length;
  } catch (e) {
    update((s) => { s.mailProposals.running = false; s.mailProposals.error = e.message; s.mailProposals.lastRun = Date.now(); }, { silent: true });
    if (!auto) toast(e.message);
    return 0;
  }
}

// ---------- Validation ----------
function proposalsHtml() {
  const items = pendingProposals();
  const projects = activeProjects();
  if (!items.length) {
    return `<h2 class="sheet-title">Tâches proposées</h2><p class="fine">Aucune proposition en attente.</p>
      <div class="sheet-actions"><span></span><button class="btn" data-action="close-sheet">Fermer</button></div>`;
  }
  const count = items.filter((p) => p.checked).length;
  return `
  <h2 class="sheet-title">Tâches proposées par l'assistant</h2>
  <p class="fine">${icon('sparkles')}Coche celles que tu veux garder et corrige si besoin. Elles iront dans tes tâches, avec un lien vers le mail.</p>
  <div class="proposals">${items.map((p) => `
    <div class="proposal card ${p.checked ? '' : 'off'}" data-key="${esc(p.key)}">
      <label class="pr-head"><input type="checkbox" data-pr="checked" ${p.checked ? 'checked' : ''}><input class="pr-title" data-pr="title" value="${esc(p.title)}" aria-label="Titre de la tâche"></label>
      <p class="pr-src">${icon('mail')}${esc(p.from)} · ${esc(p.mailSubject)}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">voir le mail</a>` : ''}</p>
      ${p.reason ? `<p class="pr-reason">${esc(p.reason)}</p>` : ''}
      <div class="pr-fields">
        <label class="field"><span>Échéance</span><input type="date" data-pr="due" value="${esc(p.due || '')}"></label>
        <label class="field"><span>Projet</span><select data-pr="projectId"><option value="">Boîte de réception</option>${projects.map((x) => `<option value="${x.id}" ${x.id === p.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      </div>
    </div>`).join('')}</div>
  <div class="sheet-actions sticky">
    <button class="btn ghost" data-pr-reject>Tout ignorer</button>
    <button class="btn primary" data-pr-ok ${count ? '' : 'disabled'}>${icon('check')}Créer ${count} tâche${count > 1 ? 's' : ''}</button>
  </div>`;
}

export function openProposals() {
  openSheet(`<div class="pr-box">${proposalsHtml()}</div>`, (d) => {
    const box = d.querySelector('.pr-box');
    const rerender = () => { box.innerHTML = proposalsHtml(); };
    const setField = (el) => {
      const key = el.closest('[data-key]')?.dataset.key;
      const field = el.dataset.pr;
      update((s) => {
        const p = s.mailProposals.items.find((x) => x.key === key);
        if (!p) return;
        p[field] = field === 'checked' ? el.checked : (el.value || null);
      }, { silent: true });
    };
    box.addEventListener('input', (e) => { if (e.target.dataset.pr === 'title') setField(e.target); });
    box.addEventListener('change', (e) => {
      if (!e.target.dataset.pr) return;
      setField(e.target);
      if (e.target.dataset.pr === 'checked') rerender();
    });
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-pr-reject]')) {
        update((s) => { s.mailProposals.items = []; }, { silent: true });
        closeSheet();
        toast('Propositions ignorées');
      }
      if (e.target.closest('[data-pr-ok]')) {
        const chosen = pendingProposals().filter((p) => p.checked && p.title?.trim());
        for (const p of chosen) {
          const auto = suggestProject(p.title)?.projectId ?? null;
          createTask(
            { title: p.title.trim(), due: p.due, time: p.time, priority: p.priority, recurrence: null, projectId: null },
            { projectId: p.projectId || null, auto, link: p.link, notes: `Mail de ${p.from} : « ${p.mailSubject} »` },
          );
        }
        update((s) => { s.mailProposals.items = []; }, { silent: true });
        toast(`${chosen.length} tâche${chosen.length > 1 ? 's' : ''} ajoutée${chosen.length > 1 ? 's' : ''}`);
        closeSheet(() => { location.hash = '#/taches'; });
      }
    });
  });
}

// Carte affichée sur Aujourd'hui et sur la page Mails.
export function proposalsCard() {
  const n = pendingProposals().length;
  const mp = state.mailProposals;
  if (mp.running) return `<div class="card nudge">${icon('sparkles')}<div><strong>L'assistant lit tes mails…</strong><p>Objet, expéditeur et court extrait uniquement.</p></div></div>`;
  if (!n) return '';
  const first = pendingProposals().slice(0, 2).map((p) => `${esc(p.title)}${p.due ? ` (${esc(dueLabel(p.due).toLowerCase())})` : ''}`).join(' · ');
  return `<button class="card nudge" data-action="open-proposals">${icon('sparkles')}<div><strong>${n} tâche${n > 1 ? 's' : ''} proposée${n > 1 ? 's' : ''} depuis tes mails</strong><p>${first}${n > 2 ? '…' : ''}</p></div>${icon('next')}</button>`;
}

export const mailTasksHandlers = {
  'open-proposals': () => openProposals(),
  'analyze-mails': () => analyzeMails(),
};

